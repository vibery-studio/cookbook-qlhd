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
 */
import { PERMISSIONS } from "@runway/rbac";
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
  revokePermissionsStmt,
  roleExists,
  updateRoleCasStmt,
} from "../dao/role-write-dao";
import { invalidatePrincipalCache } from "../dao/session-cache";
import { normalizeLabel } from "../domain/role-label";
import { generateUlid } from "../utils/id";

export const CUSTOM_ROLE_LIMIT = 50;

export interface RoleAdminDeps {
  db: Db;
  kv: KVNamespace;
  now: () => number; // unix seconds
}

export type LockedReason = "system" | "own_role" | "admin" | null;

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
  can: { edit: boolean; delete: boolean };
  locked_reason: LockedReason;
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

/** `locked_reason` precedence: admin > own_role > system (PLAN-06 R-5). */
function toView(role: RoleDetailDto, actor: Actor): RoleView {
  const locked: LockedReason =
    role.name === "admin" ? "admin" : actor.roleIds.has(role.id) ? "own_role" : role.isSystem ? "system" : null;
  const writer = actor.permissions.has("roles:write");
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
      edit: writer && (locked === null || locked === "system"),
      delete: writer && locked === null,
    },
    locked_reason: locked,
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

async function purgeHolders(deps: RoleAdminDeps, roleId: string): Promise<void> {
  const userIds = await listUserIdsOfRole(deps.db, roleId);
  await Promise.all(userIds.map((id) => invalidatePrincipalCache(deps.kv, id)));
}

// ------------------------------- list --------------------------------------

export async function listRolesFor(db: Db, actorId: string): Promise<{ items: RoleView[]; catalog: string[] }> {
  const [roles, actor] = await Promise.all([listRoleDetails(db), loadActor(db, actorId)]);
  return { items: roles.map((r) => toView(r, actor)), catalog: [...PERMISSIONS] };
}

// ------------------------------- create ------------------------------------

export type CreateRoleResult =
  | { kind: "ok"; role: RoleView }
  | { kind: "duplicate" }
  | { kind: "role-limit" }
  | Forbidden;

export async function createRole(
  deps: RoleAdminDeps,
  input: { actorId: string; label: string; description?: string; permissions: string[]; ip: string | null },
): Promise<CreateRoleResult> {
  const { db } = deps;
  const actor = await loadActor(db, input.actorId);
  const target = "role:new";
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
    // Refused inside the batch: the limit filled up, or the caller lost a code meanwhile.
    const now2 = await loadActor(db, actor.id);
    const lost = missingFrom(input.permissions, now2.permissions);
    if (lost.length > 0) return deny(db, { actorId: actor.id, target, rule: "grant_not_held", permissions: lost, ip: input.ip });
    return { kind: "role-limit" };
  }
  const role = await findRoleDetail(db, id);
  if (role === null) throw new Error("role vanished right after create");
  return { kind: "ok", role: toView(role, actor) };
}

// ------------------------------- patch -------------------------------------

export type PatchRoleResult =
  | { kind: "ok"; role: RoleView }
  | { kind: "not-found" }
  | { kind: "stale" }
  | { kind: "duplicate" }
  | Forbidden;

export async function patchRole(
  deps: RoleAdminDeps,
  input: {
    actorId: string;
    roleId: string;
    expectedVersion: number;
    label?: string;
    description?: string;
    permissions?: string[];
    ip: string | null;
  },
): Promise<PatchRoleResult> {
  const { db } = deps;
  const target = `role:${input.roleId}`;
  const role = await findRoleDetail(db, input.roleId);
  if (role === null) return { kind: "not-found" };
  const actor = await loadActor(db, input.actorId);
  const denyAs = (rule: RoleGuardRule, permissions?: string[]) =>
    deny(db, { actorId: actor.id, target, rule, permissions, ip: input.ip });

  if (role.name === "admin") return denyAs("admin_role");
  if (actor.roleIds.has(role.id)) return denyAs("own_role");
  const old = new Set(role.permissions);
  const next = input.permissions === undefined ? old : new Set(input.permissions);
  const added = [...next].filter((k) => !old.has(k)).sort();
  const removed = [...old].filter((k) => !next.has(k)).sort();
  const missing = missingFrom(added, actor.permissions);
  if (missing.length > 0) return denyAs("grant_not_held", missing);
  if (role.version !== input.expectedVersion) return { kind: "stale" };

  const label = input.label?.normalize("NFC");
  const description = input.description === undefined ? undefined : input.description === "" ? null : input.description;
  const changed: string[] = [];
  if (label !== undefined && label !== role.label) changed.push("label");
  if (description !== undefined && description !== role.description) changed.push("description");

  const now = deps.now();
  const guard = editGuard({ roleId: role.id, expectedVersion: input.expectedVersion, actorId: actor.id, added });
  const pre: BatchItem<"sqlite">[] = [];
  if (removed.length > 0) pre.push(revokePermissionsStmt(db, { roleId: role.id, keys: removed, when: guard }));
  if (added.length > 0) pre.push(grantPermissionsStmt(db, { roleId: role.id, keys: added, actorId: actor.id, when: guard }));
  const audit = (action: string, metadata: Record<string, unknown>) =>
    pre.push(auditWhenStmt(db, { actor: actor.id, action, target, metadata, ip: input.ip, ts: now, when: guard }));
  if (added.length > 0 || removed.length > 0) audit("role.permissions_changed", { name: role.name, label: role.label, added, removed });
  if (changed.length > 0) audit("role.updated", { name: role.name, label: label ?? role.label, changed });
  // The CAS write goes LAST: every statement above saw the role still at expected_version.
  const stmts = asBatch([
    ...pre,
    updateRoleCasStmt(db, {
      roleId: role.id,
      expectedVersion: input.expectedVersion,
      actorId: actor.id,
      added,
      label,
      labelKey: label === undefined ? undefined : normalizeLabel(label),
      description,
      now,
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
    if (nowRole.version !== input.expectedVersion) return { kind: "stale" };
    const nowActor = await loadActor(db, actor.id);
    if (nowActor.roleIds.has(role.id)) return denyAs("own_role");
    const lost = missingFrom(added, nowActor.permissions);
    if (lost.length > 0) return denyAs("grant_not_held", lost);
    return { kind: "stale" };
  }

  if (added.length > 0 || removed.length > 0) await purgeHolders(deps, role.id);
  const fresh = await findRoleDetail(db, role.id);
  if (fresh === null) return { kind: "not-found" };
  return { kind: "ok", role: toView(fresh, actor) };
}

// ------------------------------- delete ------------------------------------

export type DeleteRoleResult =
  | { kind: "ok" }
  | { kind: "not-found" }
  | { kind: "stale" }
  | { kind: "role-in-use"; holders: number }
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
  if (role.holders > 0) return { kind: "role-in-use", holders: role.holders };
  if (role.version !== input.expectedVersion) return { kind: "stale" };

  const now = deps.now();
  const guard = deleteGuard({ roleId: role.id, expectedVersion: input.expectedVersion });
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
    deleteRoleCasStmt(db, { roleId: role.id, expectedVersion: input.expectedVersion }),
  ]);
  const deleted = res[2];
  if (deleted.length > 0) return { kind: "ok" };

  // Refused inside the batch: someone was given the role, or it changed / went away meanwhile.
  const nowRole = await findRoleDetail(db, role.id);
  if (nowRole === null) return { kind: "not-found" };
  if (nowRole.holders > 0) return { kind: "role-in-use", holders: nowRole.holders };
  return { kind: "stale" };
}
