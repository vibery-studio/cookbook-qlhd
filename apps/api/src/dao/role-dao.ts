/**
 * Role DAO. Reads roles + writes user_roles assignments. Returns DTOs only.
 * Callers (admin-service) are responsible for cache invalidation after
 * mutating user_roles — this DAO does not touch KV.
 *
 * `INSERT OR IGNORE` on `user_roles` makes assignRole idempotent: repeat
 * calls with the same (userId, roleId) do not error, just no-op.
 */
import { and, asc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { permissions, rolePermissions, roles, userRoles } from "../db/schema";

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

export interface RoleWithPermissionsDto {
  name: string;
  description: string | null;
  permissions: string[];
}

/** Every role with its permission keys — one join query; roles and keys sorted by name. */
export async function listRolesWithPermissions(db: Db): Promise<RoleWithPermissionsDto[]> {
  const rows = await db
    .select({ name: roles.name, description: roles.description, key: permissions.key })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .orderBy(asc(roles.name), asc(permissions.key));
  const out = new Map<string, RoleWithPermissionsDto>();
  for (const r of rows) {
    let item = out.get(r.name);
    if (!item) {
      item = { name: r.name, description: r.description, permissions: [] };
      out.set(r.name, item);
    }
    if (r.key !== null) item.permissions.push(r.key);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Unexecuted builders for `db.batch` (C-01-004).
// ---------------------------------------------------------------------------

/** Grant `roleName` to the user (INSERT…SELECT from roles); `when` makes it conditional. */
export function grantRoleByNameStmt(db: Db, input: { userId: string; roleName: string; when?: SQL }) {
  const cond = input.when ? sql` AND ${input.when}` : sql``;
  return db
    .insert(userRoles)
    .select(
      sql`SELECT ${input.userId}, r.id FROM roles r WHERE r.name = ${input.roleName}${cond}`,
    )
    .returning({ userId: userRoles.userId });
}

/**
 * Drop every role of the user except `keepRoleName` — but only once the kept
 * role is really held (so a refused grant never leaves a user role-less).
 */
export function dropOtherRolesStmt(db: Db, input: { userId: string; keepRoleName: string }) {
  return db.delete(userRoles).where(
    and(
      eq(userRoles.userId, input.userId),
      ne(
        userRoles.roleId,
        sql`(SELECT id FROM roles WHERE name = ${input.keepRoleName})`,
      ),
      sql`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${input.userId} AND r.name = ${input.keepRoleName})`,
    ),
  );
}

/** Predicate: the user holds `roleName` right now (batch dependency). */
export function userHasRole(userId: string, roleName: string): SQL {
  return sql`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${userId} AND r.name = ${roleName})`;
}
