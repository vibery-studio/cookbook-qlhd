/**
 * auth-service — orchestrates the DAO layer + packages/auth primitives +
 * emailPort into the five public flows the blueprint ships:
 *
 *   signup  → creates user (pending), stores verification token hash,
 *             enqueues verify-email
 *   verify  → CAS-consumes the verification token, flips user active
 *   login   → password verify, issues access JWT + refresh cookie, caches
 *             the principal in KV
 *   refresh → CAS-rotates the refresh token, detects replay → nukes chain
 *   logout  → inserts jti into revocation list, revokes refresh
 *
 * NO route-level concerns here (cookies, HTTP status codes, Problem
 * envelopes). Handlers translate these outcomes to responses.
 */

import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  REFRESH_TOKEN_BYTES,
  signAccessToken,
  VERIFICATION_TOKEN_BYTES,
  verifyPassword,
} from "@runway/auth";
import type { Bindings } from "../env";
import type { EmailPort } from "../ports/email-port";
import { generateUlid } from "../utils/id";
import {
  createUser,
  findUserByEmail,
  findUserPasswordHashByEmail,
  updateUserStatus,
} from "../dao/user-dao";
import {
  consumeVerificationToken,
  insertVerificationToken,
} from "../dao/verification-token-dao";
import {
  insertRefreshToken,
  revokeRefreshToken,
  revokeUserRefreshChain,
  rotateRefreshToken,
} from "../dao/refresh-token-dao";
import { revokeJti } from "../dao/jwt-revocation-dao";
import { invalidatePrincipalCache } from "../dao/session-cache";
import type { Db } from "../db/client";
import { writeAuditEvent } from "../dao/audit-dao";
import { createAuditLogger } from "../observability/logger";

// -------------------------- TTL constants ---------------------------------
const VERIFY_TTL_SECONDS = 24 * 60 * 60; // 24h
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const ACCESS_TTL_SECONDS = 120; // 2 min — short so revocation propagates fast

// -------------------------- Result shapes ---------------------------------

export type SignupResult =
  | { kind: "ok"; userId: string }
  | { kind: "duplicate-email" }
  | { kind: "weak-password" };

export type VerifyResult =
  | { kind: "ok"; userId: string }
  | { kind: "invalid-or-used" };

export interface AuthTokens {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

export type LoginResult =
  | { kind: "ok"; userId: string; tokens: AuthTokens }
  | { kind: "invalid-credentials" }
  | { kind: "not-verified" }
  | { kind: "disabled" };

export type RefreshResult =
  | { kind: "ok"; userId: string; tokens: AuthTokens }
  | { kind: "invalid" }
  | { kind: "reuse-detected"; userId: string };

export type LogoutResult = { kind: "ok" };

// -------------------------- Deps container --------------------------------

export interface AuthServiceDeps {
  db: Db;
  kv: KVNamespace;
  email: EmailPort;
  now: () => number; // unix seconds; injectable for tests
  env: Bindings;
}

// -------------------------- Helpers ---------------------------------------

async function issueTokens(
  deps: AuthServiceDeps,
  userId: string,
): Promise<AuthTokens> {
  const now = deps.now();
  const jti = generateUlid();

  const accessToken = await signAccessToken({
    secret: deps.env.JWT_SECRET,
    ttlSeconds: ACCESS_TTL_SECONDS,
    sub: userId,
    jti,
    now,
  });

  const refreshRaw = generateOpaqueToken(REFRESH_TOKEN_BYTES);
  const refreshHash = hashToken(refreshRaw, deps.env.TOKEN_PEPPER);
  const refreshExpiresAt = now + REFRESH_TTL_SECONDS;

  await insertRefreshToken(deps.db, {
    tokenHash: refreshHash,
    userId,
    expiresAt: refreshExpiresAt,
    createdAt: now,
  });

  return {
    accessToken,
    accessExpiresAt: now + ACCESS_TTL_SECONDS,
    refreshToken: refreshRaw,
    refreshExpiresAt,
  };
}

// -------------------------- Public flows ----------------------------------

/**
 * `signup` is intentionally sparse — the route validates password
 * length/complexity via Zod before we get here; this function trusts the
 * caller supplied a policy-conformant password.
 */
export async function signup(
  deps: AuthServiceDeps,
  input: { email: string; password: string; verifyUrlBase: string },
): Promise<SignupResult> {
  const existing = await findUserByEmail(deps.db, input.email);
  if (existing !== null) {
    return { kind: "duplicate-email" };
  }

  const now = deps.now();
  const userId = generateUlid();
  const passwordHash = await hashPassword(input.password);

  await createUser(deps.db, {
    id: userId,
    email: input.email,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  const verifyRaw = generateOpaqueToken(VERIFICATION_TOKEN_BYTES);
  const verifyHash = hashToken(verifyRaw, deps.env.TOKEN_PEPPER);

  await insertVerificationToken(deps.db, {
    tokenHash: verifyHash,
    userId,
    purpose: "verify_email",
    expiresAt: now + VERIFY_TTL_SECONDS,
    createdAt: now,
  });

  // Fire-and-log email — if the queue swallows it, the Cron sweeper (Phase 7)
  // catches unverified users >15m old. auth-service does NOT block on this.
  const verifyUrl = `${input.verifyUrlBase}?token=${encodeURIComponent(verifyRaw)}`;
  await deps.email.send({
    template: "verify-email",
    to: input.email,
    props: { userName: input.email, verifyUrl },
  });

  return { kind: "ok", userId };
}

export async function verifyEmail(
  deps: AuthServiceDeps,
  input: { rawToken: string },
): Promise<VerifyResult> {
  const now = deps.now();
  const tokenHash = hashToken(input.rawToken, deps.env.TOKEN_PEPPER);

  const consumed = await consumeVerificationToken(deps.db, tokenHash, now, "verify_email");
  if (consumed === null) return { kind: "invalid-or-used" };

  if (consumed.purpose === "verify_email") {
    await updateUserStatus(deps.db, consumed.userId, "active", now);
    // Bust cached principal so `/me` reflects `status=active` next hit.
    await invalidatePrincipalCache(deps.kv, consumed.userId);
  }
  // password_reset purpose is handled by a separate flow (Phase 5 future) —
  // for now the CAS consume returns the userId; caller decides next step.

  return { kind: "ok", userId: consumed.userId };
}

/**
 * Constant-time-ish login. Both branches (unknown email vs wrong password)
 * incur the scrypt cost so timing doesn't reveal which side missed. We
 * feed a dummy hash string when the user doesn't exist so `verifyPassword`
 * does the same amount of work.
 *
 * Precomputed dummy hash: scrypt of an empty string under OWASP 2024
 * params. Constant expression baked at module load so the CPU cost is
 * only paid on first login attempt after cold start.
 */
const DUMMY_HASH_PROMISE = hashPassword("dummy-for-timing-safety");

export async function login(
  deps: AuthServiceDeps,
  input: { email: string; password: string; ip?: string | null },
): Promise<LoginResult> {
  const userRow = await findUserPasswordHashByEmail(deps.db, input.email);

  // Fetch user status separately for the pending/disabled decision, but
  // ONLY after the password check to avoid revealing account states.
  let ok: boolean;
  if (userRow === null) {
    // Do the same amount of work as the real path so timing doesn't split.
    const dummyHash = await DUMMY_HASH_PROMISE;
    await verifyPassword(input.password, dummyHash);
    ok = false;
  } else {
    ok = await verifyPassword(input.password, userRow.passwordHash);
  }

  if (!ok || userRow === null) return { kind: "invalid-credentials" };

  // Now check status. We've already established credentials, so it's safe
  // to reveal not-verified / disabled.
  const user = await findUserByEmail(deps.db, input.email);
  if (user === null) return { kind: "invalid-credentials" }; // race — vanished
  if (user.status === "pending") return { kind: "not-verified" };
  if (user.status === "disabled") return { kind: "disabled" };

  const tokens = await issueTokens(deps, user.id);
  // auth.login lands in D1 before the login response (write errors are swallowed inside).
  await writeAuditEvent(deps.db, {
    actor: user.id,
    action: "auth.login",
    target: `user:${user.id}`,
    ip: input.ip ?? null,
  });
  return { kind: "ok", userId: user.id, tokens };
}

export async function refresh(
  deps: AuthServiceDeps,
  input: { rawRefreshToken: string },
): Promise<RefreshResult> {
  const now = deps.now();
  const oldHash = hashToken(input.rawRefreshToken, deps.env.TOKEN_PEPPER);

  // Generate the new token first — we need its hash for the CAS UPDATE.
  const newRaw = generateOpaqueToken(REFRESH_TOKEN_BYTES);
  const newHash = hashToken(newRaw, deps.env.TOKEN_PEPPER);

  const outcome = await rotateRefreshToken(deps.db, oldHash, newHash, now);

  if (outcome.kind === "not-found") return { kind: "invalid" };

  if (outcome.kind === "reuse-detected") {
    // Nuke the whole chain — every active refresh for this user is now
    // suspect. All the user's devices/tabs will be forced back through
    // /auth/login. Also bust the KV principal cache so any in-flight
    // access-token-authorized request that races this can't succeed via
    // stale cached principal on next auth-middleware pass.
    //
    // Security-critical audit event — SYNC so the record survives an
    // isolate death and lands in Logpush before the response returns.
    const audit = createAuditLogger({ ctx: undefined, db: deps.db });
    audit(
      {
        actor: outcome.userId,
        action: "auth.refresh.reuse_detected",
        target: `user:${outcome.userId}`,
        metadata: { chain_root: outcome.chainRoot },
      },
      { sync: true },
    );
    await audit.flush();
    await revokeUserRefreshChain(deps.db, outcome.userId, now);
    await invalidatePrincipalCache(deps.kv, outcome.userId);
    return { kind: "reuse-detected", userId: outcome.userId };
  }

  // Happy path — old row already revoked in the same atomic UPDATE.
  // Insert the new refresh row + issue a new access token.
  const refreshExpiresAt = now + REFRESH_TTL_SECONDS;
  await insertRefreshToken(deps.db, {
    tokenHash: newHash,
    userId: outcome.userId,
    expiresAt: refreshExpiresAt,
    createdAt: now,
  });

  const jti = generateUlid();
  const accessToken = await signAccessToken({
    secret: deps.env.JWT_SECRET,
    ttlSeconds: ACCESS_TTL_SECONDS,
    sub: outcome.userId,
    jti,
    now,
  });

  return {
    kind: "ok",
    userId: outcome.userId,
    tokens: {
      accessToken,
      accessExpiresAt: now + ACCESS_TTL_SECONDS,
      refreshToken: newRaw,
      refreshExpiresAt,
    },
  };
}

export async function logout(
  deps: AuthServiceDeps,
  input: {
    accessJti: string | null;
    accessExpiresAt: number | null;
    userId: string;
    rawRefreshToken: string | null;
  },
): Promise<LogoutResult> {
  const now = deps.now();

  if (input.accessJti !== null && input.accessExpiresAt !== null) {
    await revokeJti(deps.db, {
      jti: input.accessJti,
      userId: input.userId,
      reason: "logout",
      revokedAt: now,
      expiresAt: input.accessExpiresAt,
    });
  }

  if (input.rawRefreshToken !== null) {
    const refreshHash = hashToken(input.rawRefreshToken, deps.env.TOKEN_PEPPER);
    await revokeRefreshToken(deps.db, refreshHash, now);
  }

  await invalidatePrincipalCache(deps.kv, input.userId);
  return { kind: "ok" };
}

// -------------------------- Constants export ------------------------------

export const AUTH_TTL = {
  ACCESS_SECONDS: ACCESS_TTL_SECONDS,
  REFRESH_SECONDS: REFRESH_TTL_SECONDS,
  VERIFY_SECONDS: VERIFY_TTL_SECONDS,
} as const;
