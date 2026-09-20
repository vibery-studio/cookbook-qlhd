/**
 * DAO functions return DTOs only. Never re-export drizzle row types from
 * this file. See docs/dao-pattern.md for the discipline.
 *
 * Application-level cascade: D1 `PRAGMA foreign_keys` is not reliably
 * persistent across HTTP-fronted statements, so parent-child cleanup is
 * enforced here via `db.batch([...])` — dependent rows are deleted before
 * the parent, all in one atomic batch.
 */
import { eq } from "drizzle-orm";
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
