/**
 * Role DAO. Reads roles + writes user_roles assignments. Returns DTOs only.
 * Callers (admin-service) are responsible for cache invalidation after
 * mutating user_roles — this DAO does not touch KV.
 *
 * `INSERT OR IGNORE` on `user_roles` makes assignRole idempotent: repeat
 * calls with the same (userId, roleId) do not error, just no-op.
 */
import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
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

/** SPEC-06 §3.2 role row (caller-independent part; `can`/`locked_reason` are computed by the service). */
export interface RoleDetailDto {
  id: string;
  name: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  version: number;
  holders: number;
  permissions: string[];
}

/**
 * Roles with their permission keys and holder counts — one join query + one grouped count (no N+1).
 * `roleId` narrows to one role. Order: system roles first, then by name; keys sorted.
 */
export async function listRoleDetails(db: Db, roleId?: string): Promise<RoleDetailDto[]> {
  const where = roleId === undefined ? undefined : eq(roles.id, roleId);
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: roles.id,
        name: roles.name,
        label: roles.label,
        description: roles.description,
        isSystem: roles.isSystem,
        version: roles.version,
        key: permissions.key,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(where)
      .orderBy(desc(roles.isSystem), asc(roles.name), asc(permissions.key)),
    db
      .select({ roleId: userRoles.roleId, n: count() })
      .from(userRoles)
      .where(roleId === undefined ? undefined : eq(userRoles.roleId, roleId))
      .groupBy(userRoles.roleId),
  ]);
  const holders = new Map(counts.map((r) => [r.roleId, r.n]));
  const out = new Map<string, RoleDetailDto>();
  for (const r of rows) {
    let item = out.get(r.id);
    if (!item) {
      item = {
        id: r.id,
        name: r.name,
        label: r.label ?? r.name,
        description: r.description,
        isSystem: r.isSystem === 1,
        version: r.version,
        holders: holders.get(r.id) ?? 0,
        permissions: [],
      };
      out.set(r.id, item);
    }
    if (r.key !== null) item.permissions.push(r.key);
  }
  return [...out.values()];
}

export async function findRoleDetail(db: Db, roleId: string): Promise<RoleDetailDto | null> {
  return (await listRoleDetails(db, roleId))[0] ?? null;
}

/** Ids of the roles the user carries — read from D1 (SPEC-06 §3.2: never from the principal cache). */
export async function listRoleIdsForUser(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.roleId);
}

/** Number of custom (`is_system = 0`) roles — the ≤ 50 limit (SPEC-06 §3.1). */
export async function countCustomRoles(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(roles).where(eq(roles.isSystem, 0));
  return row?.n ?? 0;
}

/** Users carrying the role (cache purge after a permission change, FR-7). */
export async function listUserIdsOfRole(db: Db, roleId: string): Promise<string[]> {
  const rows = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, roleId));
  return rows.map((r) => r.userId);
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

// ---------------------------------------------------------------------------
// FIX-05: Giám đốc = owner. Predicates read `user_roles` (permanent; a JIT grant is never in `user_roles`).
// ---------------------------------------------------------------------------

/** The owner role: its holders alone assign roles carrying `roles:write` and approve changes to `admin`. */
export const OWNER_ROLE = "giam_doc";

/** Predicate: the user (bound id or column reference) carries the owner role right now. */
export function userIsOwnerSql(userId: SQL | string): SQL {
  return sql`EXISTS (SELECT 1 FROM user_roles owr JOIN roles owrl ON owrl.id = owr.role_id WHERE owr.user_id = ${userId} AND owrl.name = ${OWNER_ROLE})`;
}

/** Predicate: the role named `roleName` grants `key` right now. */
export function roleNameGrantsKeySql(roleName: string, key: string): SQL {
  return sql`EXISTS (SELECT 1 FROM roles gkr JOIN role_permissions gkrp ON gkrp.role_id = gkr.id JOIN permissions gkp ON gkp.id = gkrp.permission_id WHERE gkr.name = ${roleName} AND gkp.key = ${key})`;
}

/** Predicate: someone (any status) carries the owner role. */
function anyOwnerSql(): SQL {
  return sql`EXISTS (SELECT 1 FROM user_roles aor JOIN roles aorl ON aorl.id = aor.role_id WHERE aorl.name = ${OWNER_ROLE})`;
}

/**
 * R3 guard for a write that gives `roleName` to someone: the role does not carry `roles:write`, or the actor is an
 * owner, or — bootstrap — the role is `giam_doc` and nobody carries it yet (the first Giám đốc is invited by the
 * admin). Put it in the WHERE of the batch's first write (never check-then-write alone).
 */
export function ownerMayAssignSql(actorId: string, roleName: string): SQL {
  const bootstrap = roleName === OWNER_ROLE ? sql` OR NOT ${anyOwnerSql()}` : sql``;
  return sql`(NOT ${roleNameGrantsKeySql(roleName, "roles:write")} OR ${userIsOwnerSql(actorId)}${bootstrap})`;
}

/**
 * Guard for changing the role of `userId`: they do not carry the owner role, or the actor is an owner — so a
 * non-owner cannot remove the Giám đốc (which would also reopen the bootstrap above).
 */
export function ownerMayReassignSql(actorId: string, userId: string): SQL {
  return sql`(NOT ${userIsOwnerSql(userId)} OR ${userIsOwnerSql(actorId)})`;
}
