/**
 * DAO functions return DTOs only. Never re-export drizzle row types from
 * this file. See docs/dao-pattern.md for the discipline.
 *
 * Consume uses an atomic compare-and-swap: a single
 * `UPDATE ... WHERE used_at IS NULL AND expires_at > ? RETURNING`
 * statement (`.returning()` via drizzle's D1 driver) instead of a
 * read-then-write. `rows.length === 0` collapses "never existed",
 * "expired", and "already used" into one `null` outcome — deliberately:
 * leaking which case occurred hands an attacker probing token space free
 * oracle information.
 */
import { and, eq, gt, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { verificationTokens } from "../db/schema";

export type VerificationPurpose = "verify_email" | "password_reset" | "invite";

export interface VerificationTokenDto {
  tokenHash: string;
  userId: string;
  purpose: VerificationPurpose;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

export interface ConsumeResult {
  userId: string;
  purpose: VerificationPurpose;
}

export interface CreateVerificationTokenInput {
  tokenHash: string;
  userId: string;
  purpose: VerificationPurpose;
  expiresAt: number;
  createdAt: number;
}

type VerificationTokenRow = typeof verificationTokens.$inferSelect;

/** Converts a drizzle `verification_tokens` row into the public DTO. Never exported. */
function toDto(row: VerificationTokenRow): VerificationTokenDto {
  return {
    tokenHash: row.tokenHash,
    userId: row.userId,
    purpose: row.purpose as VerificationPurpose,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

export async function insertVerificationToken(
  db: Db,
  input: CreateVerificationTokenInput,
): Promise<void> {
  await db.insert(verificationTokens).values({
    tokenHash: input.tokenHash,
    userId: input.userId,
    purpose: input.purpose,
    expiresAt: input.expiresAt,
    usedAt: null,
    createdAt: input.createdAt,
  });
}

/**
 * ATOMIC CAS CONSUME. One `UPDATE ... WHERE used_at IS NULL AND
 * expires_at > ? RETURNING user_id, purpose` statement — never
 * read-then-write, never delete-then-insert. Returns `null` if the token
 * doesn't exist, is expired, or is already used; callers must not attempt
 * to distinguish those cases from the return value alone.
 */
export async function consumeVerificationToken(
  db: Db,
  tokenHash: string,
  now: number,
  purpose: VerificationPurpose,
): Promise<ConsumeResult | null> {
  // `purpose` in the CAS: an invite token posted to /auth/verify must not be burned (SPEC-01).
  const rows = await db
    .update(verificationTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(verificationTokens.tokenHash, tokenHash),
        eq(verificationTokens.purpose, purpose),
        isNull(verificationTokens.usedAt),
        gt(verificationTokens.expiresAt, now),
      ),
    )
    .returning({ userId: verificationTokens.userId, purpose: verificationTokens.purpose });

  const row = rows[0];
  if (!row) return null;
  return { userId: row.userId, purpose: row.purpose as VerificationPurpose };
}

export async function findVerificationTokenByHash(
  db: Db,
  tokenHash: string,
): Promise<VerificationTokenDto | null> {
  const row = await db.query.verificationTokens.findFirst({
    where: eq(verificationTokens.tokenHash, tokenHash),
  });
  return row ? toDto(row) : null;
}

// ---------------------------------------------------------------------------
// Invite tokens (C-01-004). Unexecuted builders for `db.batch`.
// ---------------------------------------------------------------------------

export function insertInviteTokenStmt(db: Db, input: Omit<CreateVerificationTokenInput, "purpose">) {
  return db.insert(verificationTokens).values({
    tokenHash: input.tokenHash,
    userId: input.userId,
    purpose: "invite",
    expiresAt: input.expiresAt,
    usedAt: null,
    createdAt: input.createdAt,
  });
}

/** Re-invite: the token row exists only if the user is still `pending` (CAS). */
export function insertInviteTokenIfPendingStmt(
  db: Db,
  input: Omit<CreateVerificationTokenInput, "purpose"> & { when?: SQL },
) {
  return db
    .insert(verificationTokens)
    .select(
      sql`SELECT ${input.tokenHash}, u.id, 'invite', ${input.expiresAt}, NULL, ${input.createdAt} FROM users u WHERE u.id = ${input.userId} AND u.status = 'pending' AND ${input.when ?? sql`1 = 1`}`,
    )
    .returning({ tokenHash: verificationTokens.tokenHash });
}

/** Mark every other unused invite token of the user as used (old links die). */
export function invalidateOtherInviteTokensStmt(
  db: Db,
  input: { userId: string; exceptHash: string; now: number },
) {
  return db
    .update(verificationTokens)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(verificationTokens.userId, input.userId),
        eq(verificationTokens.purpose, "invite"),
        isNull(verificationTokens.usedAt),
        ne(verificationTokens.tokenHash, input.exceptHash),
      ),
    );
}

/** CAS consume restricted to purpose 'invite'; RETURNING user_id (0 rows = invalid/used/expired). */
export function consumeInviteTokenStmt(db: Db, tokenHash: string, now: number) {
  return db
    .update(verificationTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(verificationTokens.tokenHash, tokenHash),
        eq(verificationTokens.purpose, "invite"),
        isNull(verificationTokens.usedAt),
        gt(verificationTokens.expiresAt, now),
      ),
    )
    .returning({ userId: verificationTokens.userId });
}

/** Predicate: this invite token was consumed at `now` (dependency for the rest of the batch). */
export function inviteConsumedAt(tokenHash: string, now: number) {
  return sql`EXISTS (SELECT 1 FROM verification_tokens WHERE token_hash = ${tokenHash} AND purpose = 'invite' AND used_at = ${now})`;
}
