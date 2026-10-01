/**
 * role-admin-service — SPEC-06 §3.3: list / create / patch / delete roles. No Hono, no HTTP: typed outcomes only.
 *
 * Guards, in this order (PLAN-06 R-5): `admin_role` (DEC-2: `admin` immutable through the API) → `system_role`
 * (DELETE only) → `own_role` (never edit/delete a role you carry) → `grant_not_held` (added codes ⊆ the caller's).
 * The caller's roles and permissions are read from D1 in this request, never from the principal cache (≤ 60s old).
 * Each business 403 writes one `permission.denied` row (`metadata {rule, permission: "roles:write"}`) first.
 *
 * Every write is ONE `db.batch` (role-write-dao): guards are repeated in SQL, so a race never slips through;
 * a refused batch writes nothing, the service re-reads to classify 404 / stale / 403.
 * After a permission change commits, the principal cache of every holder is purged (FR-7, DEC-4; R-1: fine for
 * a small team, > ~900 holders needs batching via waitUntil).
 *
 * SPEC-07: SoD on create (R-9: before grant_not_held, repeated in the INSERT's WHERE); PATCH edits label/description
 * only (DEC-1 — permission sets change through role-change-service); an open change request locks PATCH/DELETE
 * (409 `request-pending`, DEC-4, repeated as `NOT EXISTS` in the batch guard). `GET /roles` adds `pending_request`,
 * `can.request`, `request_locked_reason` (R-10).
 */
import { PERMISSIONS } from "@runway/rbac";
import { and, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../db/client";
import { writeAuditEvent } from "../dao/audit-dao";
import { isUniqueViolation } from "../dao/customer-dao";
import { listPermissionKeysForUser } from "../dao/permission-dao";
import {
  countCustomRoles,
  findRoleDetail,
  listRoleDetails,
  listRoleIdsForUser,
  listUserIdsOfRole,
  type RoleDetailDto,
} from "../dao/role-dao";
import {
  auditWhenStmt,
  deleteGuard,
  deleteRoleCasStmt,
  deleteRolePermissionsStmt,
  editGuard,
  grantPermissionsStmt,
  insertCustomRoleStmt,
  roleExists,
  updateRoleCasStmt,
} from "../dao/role-write-dao";
import { eligibleApproverSql, holds, listOpenRequests, openRequestSql, type ChangeRequestRowDto } from "../dao/role-change-dao";
import { invalidatePrincipalCache } from "../dao/session-cache";
import { listSodPairs } from "../dao/sod-dao";
import { normalizeLabel } from "../domain/role-label";
import { sodViolations } from "../domain/sod";
import { generateUlid } from "../utils/id";

export const CUSTOM_ROLE_LIMIT = 50;

export interface RoleAdminDeps {
  db: Db;
  kv: KVNamespace;
  now: () => number; // unix seconds
}

export type LockedReason = "system" | "own_role" | "admin" | null;
/** SPEC-07 (PLAN-07 R-10): why the caller cannot send a permission change request. */
export type RequestLockedReason = "request_pending" | "no_approver" | null;

export interface PendingRequestSummary {
  id: string;
  added: string[];
  removed: string[];
  requested_by_name: string | null;
  expires_at: number;
}

/** SPEC-06 §3.2 `Role`, computed for one caller. */
export interface RoleView {
  id: string;
  name: string;
  label: string;
  description: string | null;
  is_system: boolean;
  version: number;
  holders: number;
  permissions: string[];
  can: { edit: boolean; delete: boolean; request: boolean };
  locked_reason: LockedReason;
  request_locked_reason: RequestLockedReason;
  pending_request: PendingRequestSummary | null;
}

export type RoleGuardRule = "admin_role" | "system_role" | "own_role" | "grant_not_held";

export type Forbidden = { kind: "forbidden"; rule: RoleGuardRule; permissions?: string[] };

interface Actor {
  id: string;
  roleIds: Set<string>;
  permissions: Set<string>;
}

async function loadActor(db: Db, actorId: string): Promise<Actor> {
  const [roleIds, perms] = await Promise.all([listRoleIdsForUser(db, actorId), listPermissionKeysForUser(db, actorId)]);
  return { id: actorId, roleIds: new Set(roleIds), permissions: new Set(perms) };
}

/** Caller-independent extras of a role (SPEC-07): its open request, and whether anyone else could approve. */
interface RequestContext {
  pending: ChangeRequestRowDto | undefined;
  /** Someone ≠ caller, active, permanent roles:write, no JIT (weakest form — PLAN-07 §2b `no_approver`). */
  hasApprover: boolean;
}

/**
 * `locked_reason` precedence: admin > own_role > system (PLAN-06 R-5). SPEC-07: an open request locks the role
 * (`can` all false, `request_pending`); `no_approver` only when it is the one reason the caller cannot request.
 */
function toView(role: RoleDetailDto, actor: Actor, ctx: RequestContext): RoleView {
  const locked: LockedReason =
    role.name === "admin" ? "admin" : actor.roleIds.has(role.id) ? "own_role" : role.isSystem ? "system" : null;
  const writer = actor.permissions.has("roles:write");
  const pending = ctx.pending;
  const open = writer && (locked === null || locked === "system");
  const edit = open && pending === undefined;
  const request_locked_reason: RequestLockedReason =
    pending !== undefined ? "request_pending" : open && !ctx.hasApprover ? "no_approver" : null;
  return {
    id: role.id,
    name: role.name,
    label: role.label,
    description: role.description,
    is_system: role.isSystem,
    version: role.version,
    holders: role.holders,
    permissions: role.permissions,
    can: {
      edit,
      delete: edit && locked === null,
      request: edit && ctx.hasApprover,
    },
    locked_reason: locked,
    request_locked_reason,
    pending_request:
      pending === undefined
        ? null
        : {
            id: pending.id,
            added: pending.added,
            removed: pending.removed,
            requested_by_name: pending.requestedByName,
            expires_at: pending.expiresAt,
          },
  };
}

async function deny(
  db: Db,
  input: { actorId: string; target: string; rule: RoleGuardRule; permissions?: string[]; ip: string | null },
): Promise<Forbidden> {
  await writeAuditEvent(db, {
    actor: input.actorId,
    action: "permission.denied",
    target: input.target,
    metadata: { rule: input.rule, permission: "roles:write" },
    ip: input.ip,
  });
  return input.permissions === undefined
    ? { kind: "forbidden", rule: input.rule }
    : { kind: "forbidden", rule: input.rule, permissions: input.permissions };
}

const missingFrom = (keys: Iterable<string>, held: Set<string>): string[] => [...keys].filter((k) => !held.has(k)).sort();

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

function asBatch(items: BatchItem<"sqlite">[]): Batch {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error("empty batch");
  return [first, ...rest];
}

/** Purge the principal cache of every holder of the role (after its permission set changed). */
export async function purgeHolders(deps: RoleAdminDeps, roleId: string): Promise<void> {
  const userIds = await listUserIdsOfRole(deps.db, roleId);
  await Promise.all(userIds.map((id) => invalidatePrincipalCache(deps.kv, id)));
}

// ------------------------------- list --------------------------------------

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** One query each: roles, the caller, open requests, "anyone else could approve" — no N+1. */
export async function listRolesFor(
  db: Db,
  actorId: string,
  now: number = nowSeconds(),
): Promise<{ items: RoleView[]; catalog: string[] }> {
  const [roles, actor, open, hasApprover] = await Promise.all([
    listRoleDetails(db),
    loadActor(db, actorId),
    listOpenRequests(db, { now }),
    holds(db, eligibleApproverSql({ requesterId: actorId, now })),
  ]);
  const byRole = new Map(open.map((r) => [r.roleId, r]));
  return {
    items: roles.map((r) => toView(r, actor, { pending: byRole.get(r.id), hasApprover })),
    catalog: [...PERMISSIONS],
  };
}

/** One role as `actorId` sees it (approve response), or null. */
export async function roleViewFor(db: Db, actorId: string, roleId: string, now: number = nowSeconds()): Promise<RoleView | null> {
  const [role, actor, open, hasApprover] = await Promise.all([
    findRoleDetail(db, roleId),
    loadActor(db, actorId),
    listOpenRequests(db, { now, roleIds: [roleId] }),
    holds(db, eligibleApproverSql({ requesterId: actorId, now })),
  ]);
  return role === null ? null : toView(role, actor, { pending: open[0], hasApprover });
}

// ------------------------------- create ------------------------------------

/** SPEC-07 FR-2: the proposed set holds both codes of these declared pairs. */
export type SodConflict = { kind: "sod-conflict"; pairs: [string, string][] };

export type CreateRoleResult =
  | { kind: "ok"; role: RoleView }
  | { kind: "duplicate" }
  | { kind: "role-limit" }
  | SodConflict
  | Forbidden;

export async function createRole(
  deps: RoleAdminDeps,
  input: { actorId: string; label: string; description?: string; permissions: string[]; ip: string | null },
): Promise<CreateRoleResult> {
  const { db } = deps;
  const actor = await loadActor(db, input.actorId);
  const target = "role:new";
  // SoD BEFORE grant_not_held (PLAN-07 R-9): pairs are public (GET /sod-pairs), nothing leaks.
  const conflict = sodViolations(input.permissions, await listSodPairs(db));
  if (conflict.length > 0) return { kind: "sod-conflict", pairs: conflict };
  const missing = missingFrom(input.permissions, actor.permissions);
  if (missing.length > 0) return deny(db, { actorId: actor.id, target, rule: "grant_not_held", permissions: missing, ip: input.ip });
  if ((await countCustomRoles(db)) >= CUSTOM_ROLE_LIMIT) return { kind: "role-limit" };

  const id = generateUlid();
  const name = `r_${id.toLowerCase()}`;
  const label = input.label.normalize("NFC");
  const description = input.description === undefined || input.description === "" ? null : input.description;
  const now = deps.now();
  const exists = roleExists(id);
  const stmts: Batch = [
    insertCustomRoleStmt(db, {
      id,
      name,
      label,
      labelKey: normalizeLabel(label),
      description,
      now,
      actorId: actor.id,
      permissions: input.permissions,
      limit: CUSTOM_ROLE_LIMIT,
    }),
  ];
  if (input.permissions.length > 0) {
    stmts.push(grantPermissionsStmt(db, { roleId: id, keys: input.permissions, actorId: actor.id, when: exists }));
  }
  stmts.push(
    auditWhenStmt(db, {
      actor: actor.id,
      action: "role.created",
      target: `role:${id}`,
      metadata: { name, label, permissions: [...input.permissions].sort() },
      ip: input.ip,
      ts: now,
      when: exists,
    }),
  );

  let inserted: unknown;
  try {
    inserted = (await db.batch(stmts))[0];
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "duplicate" };
    throw err;
  }
  if (!Array.isArray(inserted) || inserted.length === 0) {
    // Refused inside the batch: a pair was declared, the caller lost a code, or the limit filled up meanwhile.
    const lateConflict = sodViolations(input.permissions, await listSodPairs(db));
    if (lateConflict.length > 0) return { kind: "sod-conflict", pairs: lateConflict };
    const now2 = await loadActor(db, actor.id);
    const lost = missingFrom(input.permissions, now2.permissions);
    if (lost.length > 0) return deny(db, { actorId: actor.id, target, rule: "grant_not_held", permissions: lost, ip: input.ip });
    return { kind: "role-limit" };
  }
  const role = await roleViewFor(db, actor.id, id, now);
  if (role === null) throw new Error("role vanished right after create");
  return { kind: "ok", role };
}

// ------------------------------- patch -------------------------------------

export type PatchRoleResult =
  | { kind: "ok"; role: RoleView }
  | { kind: "not-found" }
  | { kind: "stale" }
  | { kind: "duplicate" }
  | { kind: "request-pending" }
  | Forbidden;

/**
 * Label / description only (SPEC-07 DEC-1: permission changes are change requests). Order: 404 → admin_role →
 * own_role → request-pending (DEC-4, repeated as `NOT EXISTS` in the batch guard) → stale.
 */
export async function patchRole(
  deps: RoleAdminDeps,
  input: {
    actorId: string;
    roleId: string;
    expectedVersion: number;
    label?: string;
    description?: string;
    ip: string | null;
  },
): Promise<PatchRoleResult> {
  const { db } = deps;
  const target = `role:${input.roleId}`;
  const now = deps.now();
  const role = await findRoleDetail(db, input.roleId);
  if (role === null) return { kind: "not-found" };
  const actor = await loadActor(db, input.actorId);
  const denyAs = (rule: RoleGuardRule) => deny(db, { actorId: actor.id, target, rule, ip: input.ip });

  if (role.name === "admin") return denyAs("admin_role");
  if (actor.roleIds.has(role.id)) return denyAs("own_role");
  if (await holds(db, openRequestSql(role.id, now))) return { kind: "request-pending" };
  if (role.version !== input.expectedVersion) return { kind: "stale" };

  const label = input.label?.normalize("NFC");
  const description = input.description === undefined ? undefined : input.description === "" ? null : input.description;
  const changed: string[] = [];
  if (label !== undefined && label !== role.label) changed.push("label");
  if (description !== undefined && description !== role.description) changed.push("description");

  const notLocked = sql`NOT ${openRequestSql(role.id, now)}`;
  const guard = and(editGuard({ roleId: role.id, expectedVersion: input.expectedVersion, actorId: actor.id, added: [] }), notLocked)!;
  const pre: BatchItem<"sqlite">[] = [];
  if (changed.length > 0) {
    pre.push(
      auditWhenStmt(db, {
        actor: actor.id,
        action: "role.updated",
        target,
        metadata: { name: role.name, label: label ?? role.label, changed },
        ip: input.ip,
        ts: now,
        when: guard,
      }),
    );
  }
  // The CAS write goes LAST: every statement above saw the role still at expected_version.
  const stmts = asBatch([
    ...pre,
    updateRoleCasStmt(db, {
      roleId: role.id,
      expectedVersion: input.expectedVersion,
      actorId: actor.id,
      added: [],
      label,
      labelKey: label === undefined ? undefined : normalizeLabel(label),
      description,
      now,
      also: notLocked,
    }),
  ]);

  let updated: unknown;
  try {
    const res = await db.batch(stmts);
    updated = res[res.length - 1];
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "duplicate" };
    throw err;
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    const nowRole = await findRoleDetail(db, role.id);
    if (nowRole === null) return { kind: "not-found" };
    const nowActor = await loadActor(db, actor.id);
    if (nowActor.roleIds.has(role.id)) return denyAs("own_role");
    if (await holds(db, openRequestSql(role.id, deps.now()))) return { kind: "request-pending" };
    return { kind: "stale" };
  }

  const fresh = await roleViewFor(db, actor.id, role.id, now);
  if (fresh === null) return { kind: "not-found" };
  return { kind: "ok", role: fresh };
}

// ------------------------------- delete ------------------------------------

export type DeleteRoleResult =
  | { kind: "ok" }
  | { kind: "not-found" }
  | { kind: "stale" }
  | { kind: "role-in-use"; holders: number }
  | { kind: "request-pending" }
  | Forbidden;

export async function deleteRole(
  deps: RoleAdminDeps,
  input: { actorId: string; roleId: string; expectedVersion: number; ip: string | null },
): Promise<DeleteRoleResult> {
  const { db } = deps;
  const target = `role:${input.roleId}`;
  const role = await findRoleDetail(db, input.roleId);
  if (role === null) return { kind: "not-found" };
  const actor = await loadActor(db, input.actorId);
  const denyAs = (rule: RoleGuardRule) => deny(db, { actorId: actor.id, target, rule, ip: input.ip });

  if (role.name === "admin") return denyAs("admin_role");
  if (role.isSystem) return denyAs("system_role");
  if (actor.roleIds.has(role.id)) return denyAs("own_role");
  const now = deps.now();
  if (await holds(db, openRequestSql(role.id, now))) return { kind: "request-pending" };
  if (role.holders > 0) return { kind: "role-in-use", holders: role.holders };
  if (role.version !== input.expectedVersion) return { kind: "stale" };

  const notLocked = sql`NOT ${openRequestSql(role.id, now)}`;
  const guard = and(deleteGuard({ roleId: role.id, expectedVersion: input.expectedVersion }), notLocked)!;
  const res = await db.batch([
    auditWhenStmt(db, {
      actor: actor.id,
      action: "role.deleted",
      target,
      metadata: { name: role.name, label: role.label },
      ip: input.ip,
      ts: now,
      when: guard,
    }),
    deleteRolePermissionsStmt(db, { roleId: role.id, when: guard }),
    deleteRoleCasStmt(db, { roleId: role.id, expectedVersion: input.expectedVersion, also: notLocked }),
  ]);
  const deleted = res[2];
  if (deleted.length > 0) return { kind: "ok" };

  // Refused inside the batch: someone was given the role, or it changed / went away meanwhile.
  const nowRole = await findRoleDetail(db, role.id);
  if (nowRole === null) return { kind: "not-found" };
  if (await holds(db, openRequestSql(role.id, deps.now()))) return { kind: "request-pending" };
  if (nowRole.holders > 0) return { kind: "role-in-use", holders: nowRole.holders };
  return { kind: "stale" };
}
