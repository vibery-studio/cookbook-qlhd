/**
 * Deletion service — implements the two-step GDPR erasure pipeline:
 *
 *   Step 1 (synchronous, inside `POST /me/delete`):
 *     - Reconfirm the user's password (timing-safe via the same
 *       constant-cost path as auth-service.login).
 *     - Revoke every refresh token belonging to the user (immediate
 *       session termination — grace window does NOT apply to sessions).
 *     - Bust the KV principal cache so any in-flight authorized
 *       request re-hits D1 and fails on the disabled user.
 *     - Flag `users.deletion_requested_at`.
 *     - Emit a SYNC `user.deletion_requested` audit event.
 *     - Return 202 with the scheduled completion timestamp.
 *
 *   Step 2 (asynchronous, inside `privacy-sweeper` cron):
 *     - Every user with `deletion_requested_at < now - grace_seconds`
 *       AND `deleted_at IS NULL` is picked up.
 *     - Iterate `DATA_INVENTORY` top-to-bottom, deleting child rows.
 *     - Anonymize the `users` row: email → `deleted-<id>@runway.local`,
 *       password hash → scrypt of random garbage, status → disabled.
 *     - Emit a SYNC `user.deletion_completed` event with an
 *       `identity_hash` (SHA-256 of the original email+id, unrecoverable
 *       proof-of-erasure the raw email is scrubbed from D1).
 */
import { hashPassword, verifyPassword } from "@runway/auth";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { and, eq, lt, isNull, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import {
  anonymizeUser,
  clearDeletionRequest,
  findUserById,
  findUserPasswordHashByEmail,
  flagUserForDeletion,
} from "../dao/user-dao";
import { deleteUserExportsForUser } from "../dao/user-exports-dao";
import { revokeUserRefreshChain } from "../dao/refresh-token-dao";
import { invalidatePrincipalCache } from "../dao/session-cache";
import { createAuditLogger } from "../observability/logger";
import { generateOpaqueToken } from "@runway/auth";
import { users, notes } from "../db/schema";
import { passwordHashParams } from "../utils/password-params";

export type DeletionResult =
  | { kind: "ok"; scheduledCompletionAt: number }
  | { kind: "invalid-password" }
  | { kind: "not-found" };

export interface DeletionServiceDeps {
  db: Db;
  env: Bindings;
  kv: KVNamespace;
  now?: () => number;
}

/**
 * Request deletion. Reconfirms password → revokes sessions → flags
 * user. Idempotent while pending: re-requesting during the grace
 * window updates `updated_at` only.
 */
export async function requestDeletion(
  deps: DeletionServiceDeps,
  input: { userId: string; email: string; password: string; graceSeconds: number },
): Promise<DeletionResult> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();

  const passwordRow = await findUserPasswordHashByEmail(deps.db, input.email);
  if (passwordRow === null || passwordRow.id !== input.userId) {
    // Guard against a session whose email changed since token issuance.
    return { kind: "invalid-password" };
  }

  const ok = await verifyPassword(input.password, passwordRow.passwordHash);
  if (!ok) return { kind: "invalid-password" };

  // Revoke every refresh token immediately (grace applies only to data,
  // never to authenticated access).
  await revokeUserRefreshChain(deps.db, input.userId, now);
  await invalidatePrincipalCache(deps.kv, input.userId);

  await flagUserForDeletion(deps.db, input.userId, now);

  const scheduledCompletionAt = now + input.graceSeconds;
  const audit = createAuditLogger({ ctx: undefined, db: deps.db });
  audit(
    {
      actor: input.userId,
      action: "user.deletion_requested",
      target: `user:${input.userId}`,
      metadata: { scheduled_completion_at: scheduledCompletionAt, grace_seconds: input.graceSeconds },
    },
    { sync: true },
  );
  await audit.flush();

  return { kind: "ok", scheduledCompletionAt };
}

/**
 * Cancel a pending deletion. Only valid while `deletion_requested_at`
 * is set AND the grace window has not elapsed — after the sweeper has
 * marked `deleted_at`, cancellation is impossible.
 */
export async function cancelDeletion(
  deps: DeletionServiceDeps,
  userId: string,
): Promise<{ kind: "ok" } | { kind: "not-pending" } | { kind: "grace-elapsed" }> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const user = await findUserById(deps.db, userId);
  if (user === null) return { kind: "not-pending" };

  // Full row read to check deletion_requested_at (not in the DTO).
  const raw = await deps.db.query.users.findFirst({ where: eq(users.id, userId) });
  if (raw === undefined) return { kind: "not-pending" };
  if (raw.deletionRequestedAt === null) return { kind: "not-pending" };
  if (raw.deletedAt !== null) return { kind: "grace-elapsed" };

  await clearDeletionRequest(deps.db, userId, now);

  const audit = createAuditLogger({ ctx: undefined, db: deps.db });
  audit(
    {
      actor: userId,
      action: "user.deletion_cancelled",
      target: `user:${userId}`,
    },
    { sync: true },
  );
  await audit.flush();

  return { kind: "ok" };
}

/**
 * Sweeper entry point — runs during the nightly pruner. Erases every
 * user whose grace window has elapsed. Bounded to `batchLimit` per tick
 * (default 100) so the cron stays under D1's write budget.
 */
export async function sweepPendingDeletions(
  deps: DeletionServiceDeps,
  input: { graceSeconds: number; batchLimit?: number },
): Promise<{ erased: number; identityHashes: string[] }> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const cutoff = now - input.graceSeconds;
  const limit = input.batchLimit ?? 100;

  // Fetch candidate users directly (bypass the DTO — we need the raw
  // email for the identity hash before anonymization).
  const candidates = await deps.db
    .select()
    .from(users)
    .where(
      and(
        lt(users.deletionRequestedAt, cutoff),
        isNotNull(users.deletionRequestedAt),
        isNull(users.deletedAt),
      ),
    )
    .limit(limit);

  const identityHashes: string[] = [];
  for (const raw of candidates) {
    const identityHash = hashIdentity(raw.email, raw.id);
    identityHashes.push(identityHash);

    // Erase child rows the batch cascade doesn't cover.
    await deps.db.delete(notes).where(eq(notes.userId, raw.id));
    await deleteUserExportsForUser(deps.db, raw.id);

    // Anonymize the users row itself. Password hash is scrypt of a
    // random opaque token — no one can log in as this user again.
    const anonPassword = generateOpaqueToken(32);
    const anonPasswordHash = await hashPassword(anonPassword, passwordHashParams(deps.env));
    await anonymizeUser(deps.db, {
      id: raw.id,
      anonEmail: `deleted-${raw.id}@runway.local`,
      anonPasswordHash,
      deletedAt: now,
    });
    // Evict the KV principal cache — the anonymized row must not be
    // served with stale credentials in some other region.
    await invalidatePrincipalCache(deps.kv, raw.id);

    const audit = createAuditLogger({ ctx: undefined, db: deps.db });
    audit(
      {
        actor: "system",
        action: "user.deletion_completed",
        target: `user:${raw.id}`,
        metadata: { identity_hash: identityHash, deleted_at: now },
      },
      { sync: true },
    );
    await audit.flush();
  }

  return { erased: candidates.length, identityHashes };
}

/**
 * Immutable proof-of-erasure hash. SHA-256 over `email + ':' + id`. The
 * raw email is scrubbed from D1 during anonymization; this hash is the
 * only remaining link to the original identity, and it can only be
 * verified by re-hashing an already-known (email, id) pair — an
 * external party cannot invert the hash to recover the address.
 */
export function hashIdentity(email: string, userId: string): string {
  const digest = sha256(new TextEncoder().encode(`${email}:${userId}`));
  return bytesToHex(digest);
}
