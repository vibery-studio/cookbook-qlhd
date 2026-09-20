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
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { verificationTokens } from "../db/schema";

export type VerificationPurpose = "verify_email" | "password_reset";

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
): Promise<ConsumeResult | null> {
  const rows = await db
    .update(verificationTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(verificationTokens.tokenHash, tokenHash),
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
