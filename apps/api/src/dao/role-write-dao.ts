/**
 * Role-admin write DAO (SPEC-06 §3.3, FR-2..FR-5, FR-8). Pure `(db, input)` builders — NOTHING here executes.
 * The service puts them in ONE `db.batch` (a D1 transaction, statements run in order).
 *
 * Batch shape: every dependent statement (permission DELETE/INSERT, audit rows) is placed BEFORE the CAS write on
 * `roles` and guarded by the same predicate ("the role is still at `expected_version` and the guards hold"). Inside
 * the transaction nothing else writes, so the predicate reads the same state for every statement; the CAS write is
 * last, so a guard `version = expected + 1` (which a concurrent winner could also satisfy) is never needed.
 * The grant guard (`grant_not_held`) is repeated in SQL: the actor must hold every added code via `user_roles`
 * at batch time, so losing a code between the service's read and the batch inserts nothing.
 */
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, rolePermissions, roles } from "../db/schema";
import { deepScrub } from "../observability/logger";
import { generateUlid } from "../utils/id";
import { sodClearSql } from "./sod-dao";

const keyList = (keys: readonly string[]): SQL => sql.join(keys.map((k) => sql`${k}`), sql`, `);

/** The actor holds EVERY one of `keys` right now through their roles (true for an empty list). */
export function actorHoldsAll(actorId: string, keys: readonly string[]): SQL {
  if (keys.length === 0) return sql`1 = 1`;
  return sql`(SELECT COUNT(DISTINCT ap.key) FROM user_roles aur JOIN role_permissions arp ON arp.role_id = aur.role_id JOIN permissions ap ON ap.id = arp.permission_id WHERE aur.user_id = ${actorId} AND ap.key IN (${keyList(keys)})) = ${keys.length}`;
}

/** The actor holds the permission named by `keyExpr` (a column reference such as `p.key`). */
function actorHoldsKey(actorId: string, keyExpr: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM user_roles hur JOIN role_permissions hrp ON hrp.role_id = hur.role_id JOIN permissions hp ON hp.id = hrp.permission_id WHERE hur.user_id = ${actorId} AND hp.key = ${keyExpr})`;
}

/** The actor carries the role. */
export function actorCarriesRole(actorId: string, roleId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM user_roles cur WHERE cur.user_id = ${actorId} AND cur.role_id = ${roleId})`;
}

export function roleExists(roleId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM roles xr WHERE xr.id = ${roleId})`;
}

/**
 * PATCH guard: role still at `expectedVersion`, not `admin` (DEC-2), the actor does not carry it (own_role) and
 * holds every added code (grant_not_held).
 */
export function editGuard(input: { roleId: string; expectedVersion: number; actorId: string; added: readonly string[] }): SQL {
  return sql`EXISTS (SELECT 1 FROM roles er WHERE er.id = ${input.roleId} AND er.version = ${input.expectedVersion} AND er.name <> 'admin') AND NOT ${actorCarriesRole(input.actorId, input.roleId)} AND ${actorHoldsAll(input.actorId, input.added)}`;
}

/** DELETE guard: custom role, still at `expectedVersion`, nobody carries it. */
export function deleteGuard(input: { roleId: string; expectedVersion: number }): SQL {
  return sql`EXISTS (SELECT 1 FROM roles dr WHERE dr.id = ${input.roleId} AND dr.version = ${input.expectedVersion} AND dr.is_system = 0) AND NOT EXISTS (SELECT 1 FROM user_roles dur WHERE dur.role_id = ${input.roleId})`;
}

/**
 * New custom role, inserted only while there are fewer than `limit` custom roles, the actor holds every
 * requested code, and the set holds both codes of no declared SoD pair (SPEC-07 FR-2 — repeated here so a pair
 * declared concurrently cannot slip in). `label_key` UNIQUE refuses a duplicate label (whole batch rolls back).
 * RETURNING id → 0 rows = refused.
 */
export function insertCustomRoleStmt(
  db: Db,
  input: {
    id: string;
    name: string;
    label: string;
    labelKey: string;
    description: string | null;
    now: number;
    actorId: string;
    permissions: readonly string[];
    limit: number;
  },
) {
  // Column order = table order: id, name, description, label, label_key, is_system, version, created_at, updated_at.
  return db
    .insert(roles)
    .select(
      sql`SELECT ${input.id}, ${input.name}, ${input.description}, ${input.label}, ${input.labelKey}, 0, 1, ${input.now}, ${input.now} WHERE (SELECT COUNT(*) FROM roles lr WHERE lr.is_system = 0) < ${input.limit} AND ${actorHoldsAll(input.actorId, input.permissions)} AND ${sodClearSql(input.permissions)}`,
    )
    .returning({ id: roles.id });
}

/**
 * Grant `keys` to the role — each code only when `when` holds AND the actor holds that code right now
 * (race-safe `grant_not_held`). `keys` must be non-empty. RETURNING → rows actually inserted.
 */
export function grantPermissionsStmt(db: Db, input: { roleId: string; keys: readonly string[]; actorId: string; when: SQL }) {
  return db
    .insert(rolePermissions)
    .select(
      sql`SELECT ${input.roleId}, p.id FROM permissions p WHERE p.key IN (${keyList(input.keys)}) AND ${input.when} AND ${actorHoldsKey(input.actorId, sql`p.key`)}`,
    )
    .returning({ permissionId: rolePermissions.permissionId });
}

/** Revoke `keys` from the role when `when` holds. `keys` must be non-empty. */
export function revokePermissionsStmt(db: Db, input: { roleId: string; keys: readonly string[]; when: SQL }) {
  return db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, input.roleId),
        sql`${rolePermissions.permissionId} IN (SELECT rk.id FROM permissions rk WHERE rk.key IN (${keyList(input.keys)}))`,
        input.when,
      ),
    );
}

/** Every grant of the role, when `when` holds (role delete). */
export function deleteRolePermissionsStmt(db: Db, input: { roleId: string; when: SQL }) {
  return db.delete(rolePermissions).where(and(eq(rolePermissions.roleId, input.roleId), input.when));
}

/**
 * CAS edit of the role row: label/label_key/description, `version + 1`. Same guards as `editGuard`, inline.
 * RETURNING version → 0 rows = refused (classify by re-reading: 404 / stale / 403).
 */
export function updateRoleCasStmt(
  db: Db,
  input: {
    roleId: string;
    expectedVersion: number;
    actorId: string;
    added: readonly string[];
    label?: string;
    labelKey?: string;
    description?: string | null;
    now: number;
    /** Extra predicate (SPEC-07 DEC-4: no pending change request on the role). */
    also?: SQL;
  },
) {
  return db
    .update(roles)
    .set({
      ...(input.label !== undefined && { label: input.label, labelKey: input.labelKey }),
      ...(input.description !== undefined && { description: input.description }),
      version: sql`${roles.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(roles.id, input.roleId),
        eq(roles.version, input.expectedVersion),
        ne(roles.name, "admin"),
        sql`NOT ${actorCarriesRole(input.actorId, input.roleId)}`,
        actorHoldsAll(input.actorId, input.added),
        input.also,
      ),
    )
    .returning({ version: roles.version });
}

/** CAS delete of a custom role nobody carries. RETURNING id → 0 rows = refused. */
export function deleteRoleCasStmt(db: Db, input: { roleId: string; expectedVersion: number; also?: SQL }) {
  return db
    .delete(roles)
    .where(
      and(
        eq(roles.id, input.roleId),
        eq(roles.version, input.expectedVersion),
        eq(roles.isSystem, 0),
        sql`NOT EXISTS (SELECT 1 FROM user_roles hu WHERE hu.role_id = ${input.roleId})`,
        input.also,
      ),
    )
    .returning({ id: roles.id });
}

/** Audit row inserted only when `when` holds (same batch as the change it records). */
export function auditWhenStmt(
  db: Db,
  input: {
    actor: string | null;
    action: string;
    target: string;
    metadata: Record<string, unknown>;
    ip: string | null;
    ts: number;
    when: SQL;
  },
) {
  const metadata = JSON.stringify(deepScrub(input.metadata));
  return db
    .insert(auditEvents)
    .select(
      sql`SELECT ${generateUlid()}, ${input.ts}, ${input.actor}, ${input.action}, ${input.target}, ${metadata}, ${input.ip} WHERE ${input.when}`,
    );
}
