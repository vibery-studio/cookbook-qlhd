/**
 * auth middleware — parses the `runway_at` access cookie, verifies the
 * JWT, checks the `jti` blocklist, loads the principal from KV (falling
 * back to D1 on miss), and attaches it to `c.set("principal", ...)`.
 *
 * ORDER MATTERS: install this AFTER `request-id` + `logger` (so the log
 * line has a `principal_id` field to populate) and BEFORE any route that
 * expects `c.get("principal")` to exist.
 *
 * On failure, throws `HTTPException(401)` with a Problem+JSON body so the
 * global error handler emits the canonical envelope.
 */

import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { Context, MiddlewareHandler } from "hono";
import { verifyAccessToken } from "@runway/auth";
import type { Bindings } from "../env";
import type { Principal, Variables } from "../openapi";
import { isJtiRevoked } from "../dao/jwt-revocation-dao";
import { getCachedPrincipal, setCachedPrincipal } from "../dao/session-cache";
import { findUserById } from "../dao/user-dao";
import { getDb } from "../db/client";
import { problem, ProblemType, PROBLEM_TYPE_BASE } from "../dto/error";

export const ACCESS_COOKIE_NAME = "runway_at";
export const REFRESH_COOKIE_NAME = "runway_rt";

type Env = { Bindings: Bindings; Variables: Variables };

/**
 * Per-isolate LRU for jti revocation checks. Keeps hot access tokens off
 * D1 for 60 seconds per jti. Sized generously since access tokens have
 * 120s TTL — the LRU can't outlive the tokens themselves.
 *
 * `Map` preserves insertion order in ES2015+, so we can evict oldest by
 * deleting the first key.
 */
const JTI_LRU_MAX = 512;
const JTI_LRU_TTL_MS = 60_000;
const jtiCheckCache = new Map<string, { revoked: boolean; expiresAt: number }>();

function checkJtiCached(jti: string, revoked: boolean, now: number): void {
  if (jtiCheckCache.size >= JTI_LRU_MAX) {
    const oldest = jtiCheckCache.keys().next().value;
    if (oldest !== undefined) jtiCheckCache.delete(oldest);
  }
  jtiCheckCache.set(jti, { revoked, expiresAt: now + JTI_LRU_TTL_MS });
}

function readJtiCached(jti: string, now: number): boolean | null {
  const entry = jtiCheckCache.get(jti);
  if (entry === undefined) return null;
  if (entry.expiresAt <= now) {
    jtiCheckCache.delete(jti);
    return null;
  }
  return entry.revoked;
}

/**
 * Test-only helper — clears the per-isolate jti LRU. Auth integration
 * tests need this between test cases when they exercise revocation.
 */
export function _resetJtiCache(): void {
  jtiCheckCache.clear();
}

function unauthorized(c: Context<Env>, detail: string): never {
  throw new HTTPException(401, {
    res: c.json(
      problem(401, "Unauthorized", ProblemType.Unauthorized, {
        type: `${PROBLEM_TYPE_BASE}/${ProblemType.Unauthorized}`,
        detail,
        instance: c.req.path,
        request_id: c.get("requestId"),
      }),
      401,
    ),
  });
}

async function loadPrincipal(
  c: Context<Env>,
  userId: string,
): Promise<Principal | null> {
  const kv = c.env.SESSIONS;
  const cached = await getCachedPrincipal(kv, userId);
  if (cached !== null) {
    return {
      id: cached.id,
      permissions: cached.permissions,
    };
  }

  const db = getDb(c.env);
  const user = await findUserById(db, userId);
  if (user === null) return null;
  if (user.status === "disabled") return null;

  // Phase 6 (RBAC) fills real roles + permissions. For Phase 5, principals
  // exist but have no permissions — /admin/* endpoints will 403 anyone
  // until RBAC lands and seeds roles.
  const principal: Principal = { id: user.id, permissions: [] };

  await setCachedPrincipal(kv, {
    id: principal.id,
    roles: [],
    permissions: [...principal.permissions],
  });

  return principal;
}

/**
 * Attaches the authenticated principal to context, or throws 401.
 *
 * Also stashes `accessJti` + `accessExp` on context so the logout handler
 * can insert the jti into `jwt_revocations` without re-parsing the cookie.
 */
export function requireAuth(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const raw = getCookie(c, ACCESS_COOKIE_NAME);
    if (raw === undefined) unauthorized(c, "missing access cookie");

    const nowSeconds = Math.floor(Date.now() / 1000);
    let claims;
    try {
      claims = await verifyAccessToken(raw, c.env.JWT_SECRET, nowSeconds);
    } catch {
      unauthorized(c, "invalid or expired access token");
    }

    const nowMs = Date.now();
    const cached = readJtiCached(claims.jti, nowMs);
    const revoked =
      cached !== null ? cached : await isJtiRevoked(getDb(c.env), claims.jti);
    if (cached === null) checkJtiCached(claims.jti, revoked, nowMs);
    if (revoked) unauthorized(c, "access token revoked");

    const principal = await loadPrincipal(c, claims.sub);
    if (principal === null) unauthorized(c, "principal not found or disabled");

    c.set("principal", principal);
    c.set("accessJti", claims.jti);
    c.set("accessExp", claims.exp);

    await next();
  };
}

// Extend Variables typing (module augmentation happens where routes
// import — TS surfaces these when they call `c.get("accessJti")`).
declare module "hono" {
  interface ContextVariableMap {
    accessJti?: string;
    accessExp?: number;
  }
}
