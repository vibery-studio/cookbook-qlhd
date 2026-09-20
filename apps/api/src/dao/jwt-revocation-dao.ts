/**
 * DAO functions return DTOs only. Never re-export drizzle row types from
 * this file. See docs/dao-pattern.md for the discipline.
 *
 * `jwt_revocations` is the `jti` blocklist checked on every auth middleware
 * pass. The hot-path lookup (`isJtiRevoked`) is a single primary-key SELECT
 * — no joins, no scans. Middleware layers a per-isolate LRU (5min TTL) on
 * top of this DAO so repeat requests bearing the same JWT don't hit D1 every
 * time; that cache lives in `middleware/auth.ts`, not here.
 */
import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { jwtRevocations } from "../db/schema";

export interface JwtRevocationDto {
  jti: string;
  userId: string;
  reason: string;
  revokedAt: number;
  expiresAt: number;
}

export interface RevokeJtiInput {
  jti: string;
  userId: string;
  reason: "logout" | "admin_disable" | "password_reset";
  revokedAt: number;
  expiresAt: number;
}

export async function revokeJti(db: Db, input: RevokeJtiInput): Promise<void> {
  await db.insert(jwtRevocations).values({
    jti: input.jti,
    userId: input.userId,
    reason: input.reason,
    revokedAt: input.revokedAt,
    expiresAt: input.expiresAt,
  });
}

/**
 * Single primary-key lookup — MUST stay fast, this runs on every auth
 * middleware pass that misses the middleware's per-isolate LRU.
 */
export async function isJtiRevoked(db: Db, jti: string): Promise<boolean> {
  const row = await db.query.jwtRevocations.findFirst({
    where: eq(jwtRevocations.jti, jti),
    columns: { jti: true },
  });
  return row !== undefined;
}

/**
 * Called by the Phase 10 pruner cron. Deletes rows whose original JWT
 * `expiresAt` has already passed — the token is unusable regardless of the
 * revocation entry, so the row is safe to drop. Returns the count deleted.
 */
export async function pruneExpiredJtiRevocations(db: Db, now: number): Promise<number> {
  const rows = await db
    .delete(jwtRevocations)
    .where(lt(jwtRevocations.expiresAt, now))
    .returning({ jti: jwtRevocations.jti });

  return rows.length;
}
