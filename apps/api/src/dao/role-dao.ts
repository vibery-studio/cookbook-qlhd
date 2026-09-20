/**
 * Role DAO. Reads roles + writes user_roles assignments. Returns DTOs only.
 * Callers (admin-service) are responsible for cache invalidation after
 * mutating user_roles — this DAO does not touch KV.
 *
 * `INSERT OR IGNORE` on `user_roles` makes assignRole idempotent: repeat
 * calls with the same (userId, roleId) do not error, just no-op.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { roles, userRoles } from "../db/schema";

export interface RoleDto {
  id: string;
  name: string;
  description: string | null;
}

export async function findRoleByName(db: Db, name: string): Promise<RoleDto | null> {
  const row = await db.query.roles.findFirst({ where: eq(roles.name, name) });
  return row ?? null;
}

export async function listRoleNamesForUser(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.name);
}

/**
 * Idempotent assignment. Returns `true` if a new row was inserted,
 * `false` if the pair already existed.
 */
export async function assignRoleToUser(
  db: Db,
  input: { userId: string; roleId: string },
): Promise<boolean> {
  // drizzle's onConflictDoNothing lets D1 skip the write when the PK
  // (userId, roleId) is already present. `.returning()` gives us the
  // inserted rows so we can distinguish "new grant" from "already had".
  const rows = await db
    .insert(userRoles)
    .values({ userId: input.userId, roleId: input.roleId })
    .onConflictDoNothing()
    .returning({ userId: userRoles.userId });
  return rows.length === 1;
}

export async function revokeRoleFromUser(
  db: Db,
  input: { userId: string; roleId: string },
): Promise<boolean> {
  const rows = await db
    .delete(userRoles)
    .where(
      and(
        eq(userRoles.userId, input.userId),
        eq(userRoles.roleId, input.roleId),
      ),
    )
    .returning({ userId: userRoles.userId });
  return rows.length === 1;
}

export async function findRolesByNames(db: Db, names: readonly string[]): Promise<RoleDto[]> {
  if (names.length === 0) return [];
  const rows = await db.select().from(roles).where(inArray(roles.name, names));
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description }));
}
