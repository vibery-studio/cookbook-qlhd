/**
 * DAO functions return DTOs only. Never re-export drizzle row types from
 * this file. See docs/dao-pattern.md for the discipline.
 *
 * Rotation uses an atomic compare-and-swap: a single
 * `UPDATE ... WHERE revoked_at IS NULL RETURNING` statement guards both
 * attacker replay and honest concurrent-tab races. On `changes === 0` we
 * fall back to a plain SELECT (no CAS guard) purely to classify the
 * failure — never to decide whether to write.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { refreshTokens } from "../db/schema";

export interface RefreshTokenDto {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  revokedAt: number | null;
  replacedByHash: string | null;
  createdAt: number;
}

export interface CreateRefreshTokenInput {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

export type RotateOutcome =
  | { kind: "ok"; userId: string; expiresAt: number }
  | { kind: "reuse-detected"; userId: string; chainRoot: string }
  | { kind: "not-found" };

type RefreshTokenRow = typeof refreshTokens.$inferSelect;

/** Converts a drizzle `refresh_tokens` row into the public DTO. Never exported. */
function toDto(row: RefreshTokenRow): RefreshTokenDto {
  return {
    tokenHash: row.tokenHash,
    userId: row.userId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedByHash: row.replacedByHash,
    createdAt: row.createdAt,
  };
}

export async function insertRefreshToken(db: Db, input: CreateRefreshTokenInput): Promise<void> {
  await db.insert(refreshTokens).values({
    tokenHash: input.tokenHash,
    userId: input.userId,
    expiresAt: input.expiresAt,
    revokedAt: null,
    replacedByHash: null,
    createdAt: input.createdAt,
  });
}

/**
 * There is no `previous_hash` column — only the forward `replaced_by_hash`
 * link — so we can't walk toward the original ancestor. Instead, walk
 * forward from the reused (already-revoked) token the attacker/racer
 * presented to the deepest still-recorded descendant, and report that as
 * `chainRoot`: the newest token minted off the reused one, i.e. the token
 * a legitimate rotation already issued and which must now be treated as
 * compromised too.
 */
async function findChainRoot(db: Db, startHash: string): Promise<string> {
  let currentHash = startHash;
  // Bound the walk defensively — a chain should never be unbounded, but
  // guard against an accidental cycle from corrupted data.
  for (let i = 0; i < 10_000; i++) {
    const row = await db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, currentHash),
    });
    if (!row || !row.replacedByHash) return currentHash;
    currentHash = row.replacedByHash;
  }
  return currentHash;
}

/**
 * ATOMIC CAS ROTATE.
 *
 * 1. `UPDATE refresh_tokens SET revoked_at=?, replaced_by_hash=? WHERE
 *    token_hash=? AND revoked_at IS NULL RETURNING user_id, expires_at`.
 * 2. `rows.length === 1` -> `{kind:"ok", userId, expiresAt}`.
 * 3. `rows.length === 0` -> SELECT the row by hash with NO revoked_at
 *    filter, purely to classify (never to decide whether to write):
 *    - no row at all -> `{kind:"not-found"}`
 *    - row exists and is NOT revoked -> a racing rotate against the same
 *      hash won between our UPDATE and this SELECT (self-race on a
 *      different old hash than we expected); treat as not-found since we
 *      have no evidence of malicious reuse.
 *    - row exists, revoked, `replaced_by_hash` set, and revocation is
 *      within the honest-race window (`SELF_RACE_WINDOW_SECONDS`) -> two
 *      concurrent honest tabs rotated the same cookie; the winner already
 *      minted a new chain. Return `not-found` so the loser gets 401 but
 *      the winner's session survives. NEVER escalate to reuse-detected in
 *      this window — chain-nuke on a legitimate double-refresh would kill
 *      the winner's brand-new tokens.
 *    - row exists, revoked, outside the race window OR no `replaced_by_hash`
 *      -> REUSE DETECTED. Walk the `replaced_by_hash` chain to find the
 *      deepest still-recorded descendant and return it as `chainRoot`.
 *      Caller (auth-service) calls `revokeUserRefreshChain` to nuke every
 *      token for the user.
 */
const SELF_RACE_WINDOW_SECONDS = 3;

export async function rotateRefreshToken(
  db: Db,
  oldHash: string,
  newHash: string,
  now: number,
): Promise<RotateOutcome> {
  const rows = await db
    .update(refreshTokens)
    .set({ revokedAt: now, replacedByHash: newHash })
    .where(and(eq(refreshTokens.tokenHash, oldHash), isNull(refreshTokens.revokedAt)))
    .returning({ userId: refreshTokens.userId, expiresAt: refreshTokens.expiresAt });

  const updated = rows[0];
  if (updated) {
    return { kind: "ok", userId: updated.userId, expiresAt: updated.expiresAt };
  }

  const existing = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, oldHash),
  });

  if (!existing) {
    return { kind: "not-found" };
  }

  if (existing.revokedAt === null) {
    // Racing self against a concurrent writer that hasn't committed yet —
    // no CAS evidence of reuse; treat as not-found rather than escalate.
    return { kind: "not-found" };
  }

  // Honest-race guard: if the revocation happened within
  // SELF_RACE_WINDOW_SECONDS AND a replaced_by_hash is set (i.e., the
  // winner already minted a successor), this is two-tabs-simultaneously,
  // not attacker replay. Return not-found so the loser gets 401 without
  // wiping the winner's chain.
  if (
    existing.replacedByHash !== null &&
    now - existing.revokedAt <= SELF_RACE_WINDOW_SECONDS
  ) {
    return { kind: "not-found" };
  }

  const chainRoot = await findChainRoot(db, oldHash);
  return { kind: "reuse-detected", userId: existing.userId, chainRoot };
}

/**
 * Bulk-revoke every non-revoked refresh token for a user. Called after
 * reuse detection or logout-everywhere. Returns the count of rows revoked.
 */
export async function revokeUserRefreshChain(db: Db, userId: string, now: number): Promise<number> {
  const rows = await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ tokenHash: refreshTokens.tokenHash });

  return rows.length;
}

/**
 * Logout: revoke a specific refresh token by hash. Returns `true` if a row
 * was updated, `false` if the hash didn't exist or was already revoked.
 */
export async function revokeRefreshToken(db: Db, tokenHash: string, now: number): Promise<boolean> {
  const rows = await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
    .returning({ tokenHash: refreshTokens.tokenHash });

  return rows.length > 0;
}

export async function findRefreshTokenByHash(db: Db, tokenHash: string): Promise<RefreshTokenDto | null> {
  const row = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
  return row ? toDto(row) : null;
}
