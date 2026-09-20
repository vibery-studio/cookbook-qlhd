/**
 * Permission DAO. The hot-path query is `listPermissionKeysForUser` — a
 * three-table join (user_roles → role_permissions → permissions) executed
 * on session-cache miss inside the auth middleware. Result is a deduped
 * string[] which the middleware converts to `Set<Permission>` for O(1)
 * `can()` checks.
 *
 * Also exposes lookups by permission key (used by admin routes that
 * assign granular permissions — v1 only grants by role, but keeping the
 * function shape stable avoids churn when v2 lands per-user grants).
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { permissions, rolePermissions, userRoles } from "../db/schema";

export interface PermissionDto {
  id: string;
  key: string;
}

export async function findPermissionByKey(db: Db, key: string): Promise<PermissionDto | null> {
  const row = await db.query.permissions.findFirst({
    where: eq(permissions.key, key),
  });
  return row ?? null;
}

export async function findPermissionsByKeys(
  db: Db,
  keys: readonly string[],
): Promise<PermissionDto[]> {
  if (keys.length === 0) return [];
  const rows = await db
    .select()
    .from(permissions)
    .where(inArray(permissions.key, keys));
  return rows.map((r) => ({ id: r.id, key: r.key }));
}

/**
 * Hot path: join user_roles → role_permissions → permissions. Runs once
 * per session-cache miss (5min TTL) and every login. Returns unique
 * permission keys as a string[] (KV cache stores this form; middleware
 * hydrates to Set at request entry).
 */
export async function listPermissionKeysForUser(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.key);
}
