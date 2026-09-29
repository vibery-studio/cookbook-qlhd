/**
 * DAO functions return DTOs only. Never re-export drizzle row types from
 * this file. See docs/dao-pattern.md for the discipline.
 *
 * Application-level cascade: D1 `PRAGMA foreign_keys` is not reliably
 * persistent across HTTP-fronted statements, so parent-child cleanup is
 * enforced here via `db.batch([...])` — dependent rows are deleted before
 * the parent, all in one atomic batch.
 */
import { asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { jwtRevocations, refreshTokens, users, userRoles, verificationTokens } from "../db/schema";

/** The only shape callers of this module ever see for a user. */
export interface UserDto {
  id: string;
  email: string;
  status: "pending" | "active" | "disabled";
  verifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Insert shape — id/timestamps are caller-controlled (ULID + clock). */
export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
}

/** Minimum shape needed by the auth service to verify a login attempt. */
export interface UserPasswordHashDto {
  id: string;
  passwordHash: string;
}

type UserRow = typeof users.$inferSelect;

/** Converts a drizzle `users` row into the public DTO. Never exported. */
function toDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    status: row.status as UserDto["status"],
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createUser(db: Db, input: CreateUserInput): Promise<UserDto> {
  const rows = await db
    .insert(users)
    .values({
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      status: "pending",
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error("createUser: INSERT ... RETURNING returned no row");
  }
  return toDto(row);
}

export async function findUserById(db: Db, id: string): Promise<UserDto | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  return row ? toDto(row) : null;
}

export async function findUserByEmail(db: Db, email: string): Promise<UserDto | null> {
  const row = await db.query.users.findFirst({ where: eq(users.email, email) });
  return row ? toDto(row) : null;
}

/**
 * Auth-only lookup. Returns just enough to verify a password — never the
 * full `UserDto`, and callers must not persist or log the hash.
 */
export async function findUserPasswordHashByEmail(
  db: Db,
  email: string,
): Promise<UserPasswordHashDto | null> {
  const row = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!row) return null;
  return { id: row.id, passwordHash: row.passwordHash };
}

export async function updateUserStatus(
  db: Db,
  id: string,
  status: UserDto["status"],
  now: number,
): Promise<UserDto | null> {
  const [row] = await db
    .update(users)
    .set({ status, updatedAt: now })
    .where(eq(users.id, id))
    .returning();

  return row ? toDto(row) : null;
}

/**
 * Flag a user for scheduled erasure (Phase 3). Idempotent: re-requesting
 * during grace updates `updated_at` only. The privacy sweeper reads
 * `deletion_requested_at` + a configured grace window; sessions are
 * revoked by the caller BEFORE this flag flips.
 */
export async function flagUserForDeletion(
  db: Db,
  id: string,
  now: number,
): Promise<void> {
  await db
    .update(users)
    .set({ deletionRequestedAt: now, updatedAt: now })
    .where(eq(users.id, id));
}

/**
 * Clear the pending-deletion flag. Valid ONLY while the grace window
 * has not yet elapsed — the deletion route enforces the window check.
 */
export async function clearDeletionRequest(db: Db, id: string, now: number): Promise<void> {
  await db
    .update(users)
    .set({ deletionRequestedAt: null, updatedAt: now })
    .where(eq(users.id, id));
}

/**
 * Record a completed export request (`/me/export` handler side).
 */
export async function stampLastExport(db: Db, id: string, now: number): Promise<void> {
  await db.update(users).set({ lastExportAt: now, updatedAt: now }).where(eq(users.id, id));
}

/**
 * Anonymize a user row + delete every dependent record (Phase 3
 * sweeper's completion step). Preserves the row as immutable proof of
 * erasure. `anonEmail` MUST be caller-supplied and unique
 * (`deleted-<id>@runway.local` is the convention).
 */
export async function anonymizeUser(
  db: Db,
  input: {
    id: string;
    anonEmail: string;
    anonPasswordHash: string;
    deletedAt: number;
  },
): Promise<void> {
  await db.batch([
    db.delete(userRoles).where(eq(userRoles.userId, input.id)),
    db.delete(verificationTokens).where(eq(verificationTokens.userId, input.id)),
    db.delete(refreshTokens).where(eq(refreshTokens.userId, input.id)),
    db.delete(jwtRevocations).where(eq(jwtRevocations.userId, input.id)),
    db
      .update(users)
      .set({
        email: input.anonEmail,
        passwordHash: input.anonPasswordHash,
        displayName: null,
        status: "disabled",
        deletedAt: input.deletedAt,
        deletionRequestedAt: null,
        updatedAt: input.deletedAt,
      })
      .where(eq(users.id, input.id)),
  ]);
}

/**
 * Cursor for the sweeper: users whose `deletion_requested_at` is
 * older than `cutoff` and are not yet `deleted_at`-stamped.
 */
export async function findUsersReadyForErasure(
  db: Db,
  cutoff: number,
  limit: number,
): Promise<UserDto[]> {
  const rows = await db
    .select()
    .from(users)
    .limit(limit);
  return rows
    .filter(
      (r) =>
        r.deletionRequestedAt !== null &&
        r.deletionRequestedAt < cutoff &&
        r.deletedAt === null,
    )
    .map(toDto);
}

/**
 * Cursor-paginate users by ULID (lexicographic → creation-time-ordered).
 * `cursor` is the last id from the previous page (exclusive). `limit` is
 * the page size. Fetches `limit + 1` under the hood to compute
 * `next_cursor` without an extra round trip: if we got the extra row,
 * pop it and return its predecessor as `next_cursor`; else `null`.
 */
export async function listUsersPaginated(
  db: Db,
  input: { cursor?: string; limit: number },
): Promise<{ items: UserDto[]; next_cursor: string | null }> {
  const rows = await db
    .select()
    .from(users)
    .where(input.cursor !== undefined ? gt(users.id, input.cursor) : undefined)
    .orderBy(asc(users.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  return { items: page.map(toDto), next_cursor: nextCursor };
}

/**
 * Application-level cascade (D1 has no reliable FK enforcement across
 * HTTP-fronted statements — Red Team F11). Deletes every dependent row
 * BEFORE the parent `users` row, all inside one atomic `db.batch([...])`.
 */
export async function deleteUser(db: Db, id: string): Promise<void> {
  await db.batch([
    db.delete(userRoles).where(eq(userRoles.userId, id)),
    db.delete(verificationTokens).where(eq(verificationTokens.userId, id)),
    db.delete(refreshTokens).where(eq(refreshTokens.userId, id)),
    db.delete(jwtRevocations).where(eq(jwtRevocations.userId, id)),
    db.delete(users).where(eq(users.id, id)),
  ]);
}
