/**
 * Four-eyes permission change requests (SPEC-07 FR-2..4, FR-11, DEC-1..4, DEC-7, DEC-14; PLAN-07 §2b, R-2, R-5,
 * R-9, R-12). No Hono, no HTTP: typed outcomes only.
 *
 * Every guard about a person reads D1 (`user_roles`, `jit_grants`), never the principal cache. Each business 403
 * writes one `permission.denied` row first. Each write is ONE `db.batch` whose guards are repeated in SQL; a refused
 * batch writes nothing and the service re-reads to classify in the §2b order.
 *
 * Approve batch (R-2, mirrors C-06-003 "dependent statements first, CAS last"): the FIRST statement is the
 * `role.change_approved` audit row, inserted only when the full guard G holds (G is evaluated before anything in the
 * batch writes). Every later statement keys on that row's id (a marker unique to this batch), so the batch's own
 * revoke cannot flip G half-way (e.g. approving the removal of `roles:write` from the approver's own role).
 * Order: audit approved (G) → revoke (M) → grant (M, requester still holds each code) → audit permissions_changed (M)
 * → request CAS `pending → approved` (M) → `roles.version` CAS (M ∧ version = base_version) LAST.
 */
import type { BatchItem } from "drizzle-orm/batch";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { writeAuditEvent } from "../dao/audit-dao";
import { isUniqueViolation } from "../dao/customer-dao";
import { findActiveJit, jitActiveSql } from "../dao/jit-dao";
import { listPermissionKeysForUser } from "../dao/permission-dao";
import { findRoleDetail, listRoleIdsForUser, listRoleNamesForUser, OWNER_ROLE, userIsOwnerSql } from "../dao/role-dao";
import {
  approverScope,
  auditRowExistsSql,
  auditWithIdWhenStmt,
  bumpRoleVersionStmt,
  decideRequestStmt,
  eligibleApproverSql,
  expireRequestStmt,
  findChangeRequest,
  holds,
  insertRequestStmt,
  listChangeRequests,
  listOverdueRequests,
  openRequestSql,
  overdueSql,
  pendingOpenSql,
  requestExistsSql,
  userHoldsKeySql,
  type ChangeRequestRowDto,
  type StoredStatus,
} from "../dao/role-change-dao";
import {
  actorCarriesRole,
  actorHoldsAll,
  auditWhenStmt,
  grantPermissionsStmt,
  revokePermissionsStmt,
} from "../dao/role-write-dao";
import { listSodPairs, sodClearSql } from "../dao/sod-dao";
import { sodViolations } from "../domain/sod";
import { generateUlid } from "../utils/id";
import { purgeHolders, roleViewFor, type RoleView } from "./role-admin-service";

export interface RoleChangeDeps {
  db: Db;
  kv: KVNamespace;
  now: () => number; // unix seconds
}

export const REQUEST_TTL_SECONDS = 7 * 24 * 60 * 60;
const EXPIRE_BATCH = 100;

/** `owner_only` (FIX-05 R2): only a holder of the owner role (`giam_doc`) approves a change to the `admin` role. */
export type ChangeRule = "owner_only" | "own_role" | "grant_not_held" | "self_approve" | "jit_actor";
export type Forbidden = { kind: "forbidden"; rule?: ChangeRule; permissions?: string[] };

export type EffectiveStatus = StoredStatus;

/** `ChangeRequest` (PLAN-07 §2b), computed for one caller. */
export interface ChangeRequestView {
  id: string;
  role_id: string;
  role_name: string;
  role_label: string;
  base_version: number;
  added: string[];
  removed: string[];
  note: string | null;
  status: EffectiveStatus;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: number;
  expires_at: number;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: number | null;
  decision_note: string | null;
  can: { approve: boolean; reject: boolean; withdraw: boolean };
  locked_reason: "self_approve" | "jit_actor" | "owner_only" | "own_role" | null;
}

interface Caller {
  id: string;
  roleIds: Set<string>;
  permissions: Set<string>;
  jit: boolean;
  /** Carries the owner role (`giam_doc`) permanently — FIX-05. */
  owner: boolean;
}

async function loadCaller(db: Db, id: string, now: number): Promise<Caller> {
  const [roleIds, roleNames, perms, jit] = await Promise.all([
    listRoleIdsForUser(db, id),
    listRoleNamesForUser(db, id),
    listPermissionKeysForUser(db, id),
    findActiveJit(db, id, now),
  ]);
  return { id, roleIds: new Set(roleIds), permissions: new Set(perms), jit: jit !== null, owner: roleNames.includes(OWNER_ROLE) };
}

const effectiveStatus = (r: ChangeRequestRowDto, now: number): EffectiveStatus =>
  r.status === "pending" && r.expiresAt <= now ? "expired" : r.status;

/**
 * FIX-05: the role-specific approve rule for a caller who is neither the requester nor a JIT holder.
 * `admin` → owners only (R2). `giam_doc` → its holders may approve additions (R1). Others → DEC-3 own_role.
 * Mirrors `approverScope()` (create / `GET /roles`) and the approve batch guard.
 */
function decisionLock(r: { roleId: string; roleName: string; adding: boolean }, caller: Caller): "owner_only" | "own_role" | null {
  if (r.roleName === "admin") return caller.owner ? null : "owner_only";
  if (r.roleName === OWNER_ROLE) return null;
  return r.adding && caller.roleIds.has(r.roleId) ? "own_role" : null;
}

function toView(r: ChangeRequestRowDto, caller: Caller, now: number): ChangeRequestView {
  const status = effectiveStatus(r, now);
  const open = status === "pending";
  const self = r.requestedBy === caller.id;
  const locked = self
    ? "self_approve"
    : caller.jit
      ? "jit_actor"
      : decisionLock({ roleId: r.roleId, roleName: r.roleName, adding: r.added.length > 0 }, caller);
  const writer = caller.permissions.has("roles:write");
  return {
    id: r.id,
    role_id: r.roleId,
    role_name: r.roleName,
    role_label: r.roleLabel,
    base_version: r.baseVersion,
    added: r.added,
    removed: r.removed,
    note: r.note,
    status,
    requested_by: r.requestedBy,
    requested_by_name: r.requestedByName,
    requested_at: r.requestedAt,
    expires_at: r.expiresAt,
    decided_by: r.decidedBy,
    decided_by_name: r.decidedByName,
    decided_at: r.decidedAt,
    decision_note: r.decisionNote,
    can: {
      approve: open && writer && locked === null,
      reject: open && writer && !self && !caller.jit,
      withdraw: open && self,
    },
    locked_reason: locked,
  };
}

async function deny(
  db: Db,
  input: {
    actorId: string;
    target: string;
    rule?: ChangeRule;
    /** Audit-only rule when the 403 carries none (`not_requester` on withdraw, `not_permanent` without D1 roles:write). */
    auditRule?: string;
    permissions?: string[];
    ip: string | null;
  },
): Promise<Forbidden> {
  await writeAuditEvent(db, {
    actor: input.actorId,
    action: "permission.denied",
    target: input.target,
    metadata: { rule: input.rule ?? input.auditRule ?? "forbidden", permission: "roles:write" },
    ip: input.ip,
  });
  const out: Forbidden = { kind: "forbidden" };
  if (input.rule !== undefined) out.rule = input.rule;
  if (input.permissions !== undefined) out.permissions = input.permissions;
  return out;
}

const missingFrom = (keys: Iterable<string>, held: Set<string>): string[] => [...keys].filter((k) => !held.has(k)).sort();

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

function asBatch(items: BatchItem<"sqlite">[]): Batch {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error("empty batch");
  return [first, ...rest];
}

const auditMeta = (r: { roleName: string; roleLabel: string; added: string[]; removed: string[] }) => ({
  name: r.roleName,
  label: r.roleLabel,
  added: r.added,
  removed: r.removed,
});

/** [audit `role.change_expired` (still overdue) · flip to `expired`] for one overdue request — R-12. */
function expireStmts(db: Db, r: ChangeRequestRowDto, now: number): BatchItem<"sqlite">[] {
  return [
    auditWhenStmt(db, {
      actor: null, // the system: whoever flips it (cron or a new request) logs it once
      action: "role.change_expired",
      target: `role:${r.roleId}`,
      metadata: auditMeta(r),
      ip: null,
      ts: now,
      when: overdueSql(r.id, now),
    }),
    expireRequestStmt(db, { id: r.id, now }),
  ];
}

// ------------------------------- list ----------------------------------------

export async function listRequests(
  deps: RoleChangeDeps,
  input: { actorId: string; status?: StoredStatus },
): Promise<{ items: ChangeRequestView[] }> {
  const now = deps.now();
  const [rows, caller] = await Promise.all([
    listChangeRequests(deps.db, { status: input.status, now }),
    loadCaller(deps.db, input.actorId, now),
  ]);
  return { items: rows.map((r) => toView(r, caller, now)) };
}

// ------------------------------- create --------------------------------------

export type CreateRequestResult =
  | { kind: "ok"; request: ChangeRequestView }
  | { kind: "not-found" }
  | { kind: "no-change" }
  | { kind: "sod-conflict"; pairs: [string, string][] }
  | { kind: "stale" }
  | { kind: "request-pending" }
  | { kind: "no-eligible-approver" }
  | Forbidden;

/**
 * Order (PLAN-07 §2b, FIX-05): 404 → own_role (not for `admin`: admin proposes, an owner approves) → 422 nothing changes → sod-conflict (R-9) → grant_not_held →
 * stale → request-pending → no-eligible-approver. Returns null when every guard passes.
 */
async function classifyCreate(
  deps: RoleChangeDeps,
  input: { actorId: string; roleId: string; expectedVersion: number; permissions: string[]; ip: string | null },
  now: number,
): Promise<Exclude<CreateRequestResult, { kind: "ok" }> | { kind: "pass"; added: string[]; removed: string[]; name: string; label: string }> {
  const { db } = deps;
  const target = `role:${input.roleId}`;
  const role = await findRoleDetail(db, input.roleId);
  if (role === null) return { kind: "not-found" };
  const actor = await loadCaller(db, input.actorId, now);
  if (role.name !== "admin" && actor.roleIds.has(role.id)) return deny(db, { actorId: actor.id, target, rule: "own_role", ip: input.ip });
  const old = new Set(role.permissions);
  const next = new Set(input.permissions);
  const added = [...next].filter((k) => !old.has(k)).sort();
  const removed = [...old].filter((k) => !next.has(k)).sort();
  if (added.length === 0 && removed.length === 0) return { kind: "no-change" };
  const pairs = sodViolations(input.permissions, await listSodPairs(db));
  if (pairs.length > 0) return { kind: "sod-conflict", pairs };
  const missing = missingFrom(added, actor.permissions);
  if (missing.length > 0) {
    return deny(db, { actorId: actor.id, target, rule: "grant_not_held", permissions: missing, ip: input.ip });
  }
  if (role.version !== input.expectedVersion) return { kind: "stale" };
  if (await holds(db, openRequestSql(role.id, now))) return { kind: "request-pending" };
  const approver = eligibleApproverSql({ requesterId: actor.id, now, ...approverScope(role, added.length > 0) });
  if (!(await holds(db, approver))) return { kind: "no-eligible-approver" };
  return { kind: "pass", added, removed, name: role.name, label: role.label };
}

export async function createRequest(
  deps: RoleChangeDeps,
  input: { actorId: string; roleId: string; expectedVersion: number; permissions: string[]; note?: string; ip: string | null },
): Promise<CreateRequestResult> {
  const { db } = deps;
  const now = deps.now();
  const pre = await classifyCreate(deps, input, now);
  if (pre.kind !== "pass") return pre;
  const { added, removed } = pre;
  const target = { id: input.roleId, name: pre.name };

  const id = generateUlid();
  const note = input.note === undefined || input.note === "" ? null : input.note;
  const guard = sql`NOT EXISTS (SELECT 1 FROM role_change_requests gq WHERE gq.role_id = ${input.roleId} AND gq.status = 'pending')
    AND EXISTS (SELECT 1 FROM roles gr WHERE gr.id = ${input.roleId} AND gr.version = ${input.expectedVersion} AND gr.name = ${pre.name})
    AND ${pre.name === "admin" ? sql`1 = 1` : sql`NOT ${actorCarriesRole(input.actorId, input.roleId)}`}
    AND ${sodClearSql(input.permissions)}
    AND ${actorHoldsAll(input.actorId, added)}
    AND ${eligibleApproverSql({ requesterId: input.actorId, now, ...approverScope(target, added.length > 0) })}`;

  // R-5/R-12: an overdue pending request still occupies the partial UNIQUE — flip it (and log it once) first.
  const overdue = await listOverdueRequests(db, { now, roleId: input.roleId, limit: 5 });
  const stmts: BatchItem<"sqlite">[] = overdue.flatMap((r) => expireStmts(db, r, now));
  const insertAt = stmts.length;
  stmts.push(
    insertRequestStmt(db, {
      id,
      roleId: input.roleId,
      baseVersion: input.expectedVersion,
      added,
      removed,
      note,
      requestedBy: input.actorId,
      now,
      expiresAt: now + REQUEST_TTL_SECONDS,
      guard,
    }),
    auditWhenStmt(db, {
      actor: input.actorId,
      action: "role.change_requested",
      target: `role:${input.roleId}`,
      metadata: { name: pre.name, label: pre.label, added, removed },
      ip: input.ip,
      ts: now,
      when: requestExistsSql(id),
    }),
  );

  let inserted: unknown;
  try {
    inserted = (await db.batch(asBatch(stmts)))[insertAt];
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "request-pending" };
    throw err;
  }
  if (!Array.isArray(inserted) || inserted.length === 0) {
    const post = await classifyCreate(deps, input, deps.now());
    return post.kind === "pass" ? { kind: "request-pending" } : post;
  }
  const row = await findChangeRequest(db, id);
  if (row === null) throw new Error("change request vanished right after insert");
  return { kind: "ok", request: toView(row, await loadCaller(db, input.actorId, now), now) };
}

// ------------------------------- approve -------------------------------------

export type ApproveResult =
  | { kind: "ok"; request: ChangeRequestView; role: RoleView }
  | { kind: "not-found" }
  | { kind: "not-pending" }
  | { kind: "expired" }
  | { kind: "stale" }
  | { kind: "sod-conflict"; pairs: [string, string][] }
  | Forbidden;

type Pass<T> = { kind: "pass" } & T;

/**
 * 404 → self_approve → jit_actor → (no permanent roles:write) → [approve only: owner_only | own_role, FIX-05
 * `decisionLock`] → not-pending → expired. Shared by approve/reject.
 */
async function classifyDecision(
  db: Db,
  input: { actorId: string; id: string; ip: string | null; checkOwnRole: boolean },
  now: number,
): Promise<
  | { kind: "not-found" }
  | { kind: "not-pending" }
  | { kind: "expired" }
  | Forbidden
  | Pass<{ req: ChangeRequestRowDto; actor: Caller }>
> {
  const req = await findChangeRequest(db, input.id);
  if (req === null) return { kind: "not-found" };
  const target = `role:${req.roleId}`;
  const actor = await loadCaller(db, input.actorId, now);
  if (req.requestedBy === actor.id) return deny(db, { actorId: actor.id, target, rule: "self_approve", ip: input.ip });
  if (actor.jit) return deny(db, { actorId: actor.id, target, rule: "jit_actor", ip: input.ip });
  if (!actor.permissions.has("roles:write")) return deny(db, { actorId: actor.id, target, auditRule: "not_permanent", ip: input.ip });
  if (input.checkOwnRole) {
    const lock = decisionLock({ roleId: req.roleId, roleName: req.roleName, adding: req.added.length > 0 }, actor);
    if (lock !== null) return deny(db, { actorId: actor.id, target, rule: lock, ip: input.ip });
  }
  if (req.status === "expired") return { kind: "expired" };
  if (req.status !== "pending") return { kind: "not-pending" };
  if (req.expiresAt <= now) return { kind: "expired" };
  return { kind: "pass", req, actor };
}

async function classifyApprove(
  deps: RoleChangeDeps,
  input: { actorId: string; id: string; ip: string | null },
  now: number,
): Promise<Exclude<ApproveResult, { kind: "ok" }> | Pass<{ req: ChangeRequestRowDto; after: string[] }>> {
  const { db } = deps;
  const base = await classifyDecision(db, { ...input, checkOwnRole: true }, now);
  if (base.kind !== "pass") return base;
  const { req, actor } = base;
  const role = await findRoleDetail(db, req.roleId);
  if (role === null || role.version !== req.baseVersion) {
    // Request and role are read separately: a concurrent approve of THIS request may commit between the two reads.
    const fresh = await findChangeRequest(db, req.id);
    return fresh !== null && fresh.status !== "pending" ? { kind: "not-pending" } : { kind: "stale" };
  }
  const removed = new Set(req.removed);
  const after = [...new Set([...role.permissions.filter((k) => !removed.has(k)), ...req.added])].sort();
  const pairs = sodViolations(after, await listSodPairs(db));
  if (pairs.length > 0) return { kind: "sod-conflict", pairs };
  const requesterPerms = new Set(await listPermissionKeysForUser(db, req.requestedBy));
  const lost = missingFrom(req.added, requesterPerms);
  if (lost.length > 0) {
    return deny(db, { actorId: actor.id, target: `role:${req.roleId}`, rule: "grant_not_held", permissions: lost, ip: input.ip });
  }
  return { kind: "pass", req, after };
}

/** FIX-05: the SQL twin of `decisionLock` for the approve batch (role name read in-batch, so a stale DTO cannot widen it). */
function approveRoleGuard(req: ChangeRequestRowDto, actorId: string): SQL {
  const named = (name: string) => sql`EXISTS (SELECT 1 FROM roles nr WHERE nr.id = ${req.roleId} AND nr.name = ${name})`;
  const notCarrier = req.added.length > 0 ? sql`NOT ${actorCarriesRole(actorId, req.roleId)}` : sql`1 = 1`;
  return sql`(CASE WHEN ${named("admin")} THEN ${userIsOwnerSql(actorId)} WHEN ${named(OWNER_ROLE)} THEN 1 ELSE ${notCarrier} END)`;
}

export async function approveRequest(
  deps: RoleChangeDeps,
  input: { actorId: string; id: string; note?: string; ip: string | null },
): Promise<ApproveResult> {
  const { db } = deps;
  const now = deps.now();
  const pre = await classifyApprove(deps, input, now);
  if (pre.kind !== "pass") return pre;
  const { req, after } = pre;
  const note = input.note === undefined || input.note === "" ? null : input.note;
  const target = `role:${req.roleId}`;

  const guard: SQL = sql`${pendingOpenSql(req.id, now)}
    AND ${req.requestedBy} <> ${input.actorId}
    AND EXISTS (SELECT 1 FROM roles vr WHERE vr.id = ${req.roleId} AND vr.version = ${req.baseVersion})
    AND ${actorHoldsAll(req.requestedBy, req.added)}
    AND ${sodClearSql(after)}
    AND ${userHoldsKeySql(input.actorId, "roles:write")}
    AND NOT ${jitActiveSql(input.actorId, now)}
    AND ${approveRoleGuard(req, input.actorId)}`;
  const markerId = generateUlid();
  const marker = auditRowExistsSql(markerId);

  const stmts: BatchItem<"sqlite">[] = [
    auditWithIdWhenStmt(db, {
      id: markerId,
      actor: input.actorId,
      action: "role.change_approved",
      target,
      metadata: auditMeta(req),
      ip: input.ip,
      ts: now,
      when: guard,
    }),
  ];
  if (req.removed.length > 0) stmts.push(revokePermissionsStmt(db, { roleId: req.roleId, keys: req.removed, when: marker }));
  if (req.added.length > 0) {
    stmts.push(grantPermissionsStmt(db, { roleId: req.roleId, keys: req.added, actorId: req.requestedBy, when: marker }));
  }
  stmts.push(
    auditWhenStmt(db, {
      actor: input.actorId,
      action: "role.permissions_changed",
      target,
      metadata: { name: req.roleName, label: req.roleLabel, added: req.added, removed: req.removed },
      ip: input.ip,
      ts: now,
      when: marker,
    }),
    decideRequestStmt(db, { id: req.id, status: "approved", actorId: input.actorId, now, note, when: marker }),
    // The CAS write goes LAST.
    bumpRoleVersionStmt(db, { roleId: req.roleId, baseVersion: req.baseVersion, now, when: marker }),
  );

  const res = await db.batch(asBatch(stmts));
  const bumped: unknown = res[res.length - 1];
  if (!Array.isArray(bumped) || bumped.length === 0) {
    const post = await classifyApprove(deps, input, deps.now());
    return post.kind === "pass" ? { kind: "not-pending" } : post;
  }

  await purgeHolders(deps, req.roleId);
  const [row, role] = await Promise.all([findChangeRequest(db, req.id), roleViewFor(db, input.actorId, req.roleId, now)]);
  if (row === null || role === null) throw new Error("approved request or its role vanished");
  return { kind: "ok", request: toView(row, await loadCaller(db, input.actorId, now), now), role };
}

// ------------------------------- reject --------------------------------------

export type RejectResult =
  | { kind: "ok"; request: ChangeRequestView }
  | { kind: "not-found" }
  | { kind: "not-pending" }
  | { kind: "expired" }
  | Forbidden;

export async function rejectRequest(
  deps: RoleChangeDeps,
  input: { actorId: string; id: string; note: string; ip: string | null },
): Promise<RejectResult> {
  const { db } = deps;
  const now = deps.now();
  const pre = await classifyDecision(db, { ...input, checkOwnRole: false }, now);
  if (pre.kind !== "pass") return pre;
  const { req } = pre;
  const guard: SQL = sql`${pendingOpenSql(req.id, now)}
    AND ${userHoldsKeySql(input.actorId, "roles:write")}
    AND NOT ${jitActiveSql(input.actorId, now)}`;
  const [, decided] = await db.batch([
    auditWhenStmt(db, {
      actor: input.actorId,
      action: "role.change_rejected",
      target: `role:${req.roleId}`,
      metadata: auditMeta(req),
      ip: input.ip,
      ts: now,
      when: guard,
    }),
    decideRequestStmt(db, { id: req.id, status: "rejected", actorId: input.actorId, now, note: input.note, when: guard }),
  ]);
  if (decided.length === 0) {
    const post = await classifyDecision(db, { ...input, checkOwnRole: false }, deps.now());
    return post.kind === "pass" ? { kind: "not-pending" } : post;
  }
  const row = await findChangeRequest(db, req.id);
  if (row === null) throw new Error("rejected request vanished");
  return { kind: "ok", request: toView(row, await loadCaller(db, input.actorId, now), now) };
}

// ------------------------------- withdraw ------------------------------------

export type WithdrawResult =
  | { kind: "ok"; request: ChangeRequestView }
  | { kind: "not-found" }
  | { kind: "not-pending" }
  | Forbidden;

/** Requester only (anyone else → 403 `forbidden` + one denied row). An expired request is no longer pending. */
export async function withdrawRequest(
  deps: RoleChangeDeps,
  input: { actorId: string; id: string; ip: string | null },
): Promise<WithdrawResult> {
  const { db } = deps;
  const now = deps.now();
  const req = await findChangeRequest(db, input.id);
  if (req === null) return { kind: "not-found" };
  if (req.requestedBy !== input.actorId) {
    return deny(db, { actorId: input.actorId, target: `role:${req.roleId}`, auditRule: "not_requester", ip: input.ip });
  }
  if (effectiveStatus(req, now) !== "pending") return { kind: "not-pending" };
  const guard = pendingOpenSql(req.id, now);
  const [, decided] = await db.batch([
    auditWhenStmt(db, {
      actor: input.actorId,
      action: "role.change_withdrawn",
      target: `role:${req.roleId}`,
      metadata: auditMeta(req),
      ip: input.ip,
      ts: now,
      when: guard,
    }),
    decideRequestStmt(db, { id: req.id, status: "withdrawn", actorId: input.actorId, now, note: null, when: guard }),
  ]);
  if (decided.length === 0) return { kind: "not-pending" };
  const row = await findChangeRequest(db, req.id);
  if (row === null) throw new Error("withdrawn request vanished");
  return { kind: "ok", request: toView(row, await loadCaller(db, input.actorId, now), now) };
}

// ------------------------------- expire (cron) -------------------------------

/**
 * Nightly (`0 3`): pending requests past `expires_at` → `expired` + one `role.change_expired` row each (R-12),
 * ≤ 100 per run, one batch. A request flipped meanwhile by a new request on the same role is skipped by the guards.
 * Returns how many were expired.
 */
export async function expireOverdueRequests(deps: RoleChangeDeps, now: number): Promise<number> {
  const { db } = deps;
  const overdue = await listOverdueRequests(db, { now, limit: EXPIRE_BATCH });
  if (overdue.length === 0) return 0;
  const res = await db.batch(asBatch(overdue.flatMap((r) => expireStmts(db, r, now))));
  return res.filter((r, i) => i % 2 === 1 && Array.isArray(r) && r.length > 0).length;
}
