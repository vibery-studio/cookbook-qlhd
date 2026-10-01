/**
 * Four-eyes role permission change requests (SPEC-07 §3.1/§3.3, FR-3/4/11, DEC-3/4/14). Pure `(db, input)` reads +
 * UNEXECUTED builders; the service runs them in one `db.batch` (a D1 transaction, statements in order).
 *
 * `expired` is computed on read (`pending AND expires_at <= now`); whoever flips it (cron, or a new request for the
 * same role — the partial UNIQUE would otherwise block it) writes the one `role.change_expired` row (PLAN-07 R-12).
 * Every guard about a person reads D1 `user_roles` (never the principal cache) and excludes an active JIT (DEC-7).
 */
import { and, desc, eq, gt, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { auditEvents, roleChangeRequests, roles, users } from "../db/schema";
import { deepScrub } from "../observability/logger";
import { jitActiveSql } from "./jit-dao";

export type StoredStatus = "pending" | "approved" | "rejected" | "withdrawn" | "expired" | "cancelled";

export interface ChangeRequestRowDto {
  id: string;
  roleId: string;
  roleName: string;
  roleLabel: string;
  baseVersion: number;
  added: string[];
  removed: string[];
  note: string | null;
  /** As stored — `pending` may already be past `expiresAt`. */
  status: StoredStatus;
  requestedBy: string;
  requestedByName: string | null;
  requestedAt: number;
  expiresAt: number;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
}

const requester = alias(users, "rcr_requester");
const decider = alias(users, "rcr_decider");

const parseKeys = (json: string): string[] => {
  const v: unknown = JSON.parse(json);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

function selectRows(db: Db) {
  return db
    .select({
      id: roleChangeRequests.id,
      roleId: roleChangeRequests.roleId,
      roleName: roles.name,
      roleLabel: roles.label,
      baseVersion: roleChangeRequests.baseVersion,
      added: roleChangeRequests.added,
      removed: roleChangeRequests.removed,
      note: roleChangeRequests.note,
      status: roleChangeRequests.status,
      requestedBy: roleChangeRequests.requestedBy,
      requestedByName: requester.displayName,
      requestedAt: roleChangeRequests.requestedAt,
      expiresAt: roleChangeRequests.expiresAt,
      decidedBy: roleChangeRequests.decidedBy,
      decidedByName: decider.displayName,
      decidedAt: roleChangeRequests.decidedAt,
      decisionNote: roleChangeRequests.decisionNote,
    })
    .from(roleChangeRequests)
    .leftJoin(roles, eq(roles.id, roleChangeRequests.roleId))
    .leftJoin(requester, eq(requester.id, roleChangeRequests.requestedBy))
    .leftJoin(decider, eq(decider.id, roleChangeRequests.decidedBy));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectRows>["all"]>>[number];

function toDto(r: Row): ChangeRequestRowDto {
  return {
    id: r.id,
    roleId: r.roleId,
    roleName: r.roleName ?? "",
    roleLabel: r.roleLabel ?? r.roleName ?? "",
    baseVersion: r.baseVersion,
    added: parseKeys(r.added),
    removed: parseKeys(r.removed),
    note: r.note,
    status: r.status as StoredStatus,
    requestedBy: r.requestedBy,
    requestedByName: r.requestedByName,
    requestedAt: r.requestedAt,
    expiresAt: r.expiresAt,
    decidedBy: r.decidedBy,
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
  };
}

export async function findChangeRequest(db: Db, id: string): Promise<ChangeRequestRowDto | null> {
  const rows = await selectRows(db).where(eq(roleChangeRequests.id, id)).limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

/**
 * Requests newest first. `status` filters by the EFFECTIVE status at `now`: `pending` = stored pending and not yet
 * past `expires_at`; `expired` = stored expired or stored pending past `expires_at`; others as stored.
 */
export async function listChangeRequests(db: Db, input: { status?: StoredStatus; now: number }): Promise<ChangeRequestRowDto[]> {
  const t = roleChangeRequests;
  let where: SQL | undefined;
  if (input.status === "pending") where = and(eq(t.status, "pending"), gt(t.expiresAt, input.now));
  else if (input.status === "expired") where = or(eq(t.status, "expired"), and(eq(t.status, "pending"), lte(t.expiresAt, input.now)));
  else if (input.status !== undefined) where = eq(t.status, input.status);
  const rows = await selectRows(db).where(where).orderBy(desc(t.requestedAt), desc(t.id));
  return rows.map(toDto);
}

/** Open (pending, not yet expired) requests of the given roles (all roles when omitted) — one query. */
export async function listOpenRequests(db: Db, input: { now: number; roleIds?: string[] }): Promise<ChangeRequestRowDto[]> {
  const t = roleChangeRequests;
  if (input.roleIds !== undefined && input.roleIds.length === 0) return [];
  const rows = await selectRows(db).where(
    and(
      eq(t.status, "pending"),
      gt(t.expiresAt, input.now),
      input.roleIds === undefined ? undefined : inArray(t.roleId, input.roleIds),
    ),
  );
  return rows.map(toDto);
}

/** Stored-pending requests already past `expires_at` (oldest first), optionally for one role. */
export async function listOverdueRequests(
  db: Db,
  input: { now: number; roleId?: string; limit: number },
): Promise<ChangeRequestRowDto[]> {
  const t = roleChangeRequests;
  const rows = await selectRows(db)
    .where(and(eq(t.status, "pending"), lte(t.expiresAt, input.now), input.roleId === undefined ? undefined : eq(t.roleId, input.roleId)))
    .orderBy(t.expiresAt, t.id)
    .limit(input.limit);
  return rows.map(toDto);
}

// ------------------------------------------------------------------ predicates

/** The role has an open (pending, not expired) request — DEC-4 lock. */
export function openRequestSql(roleId: string, now: number): SQL {
  return sql`EXISTS (SELECT 1 FROM role_change_requests orq WHERE orq.role_id = ${roleId} AND orq.status = 'pending' AND orq.expires_at > ${now})`;
}

/** The request is still stored-pending and already past its deadline. */
export function overdueSql(id: string, now: number): SQL {
  return sql`EXISTS (SELECT 1 FROM role_change_requests ovq WHERE ovq.id = ${id} AND ovq.status = 'pending' AND ovq.expires_at <= ${now})`;
}

/** A user (bound id or column reference) holds `key` through `user_roles` (permanent; JIT never counts). */
export function userHoldsKeySql(userId: SQL | string, key: string): SQL {
  return sql`EXISTS (SELECT 1 FROM user_roles kur JOIN role_permissions krp ON krp.role_id = kur.role_id JOIN permissions kp ON kp.id = krp.permission_id WHERE kur.user_id = ${userId} AND kp.key = ${key})`;
}

/**
 * DEC-3/DEC-14: EXISTS someone other than `requesterId` who could approve — `active`, not erased, permanent
 * `roles:write`, no active JIT, and (when `carryingRoleId` is given, i.e. the request ADDS codes) not carrying
 * that role. Without `carryingRoleId` this is the weakest form (`GET /roles` `no_approver`).
 */
export function eligibleApproverSql(input: { requesterId: string; now: number; carryingRoleId?: string }): SQL {
  const carrying =
    input.carryingRoleId === undefined
      ? sql``
      : sql` AND NOT EXISTS (SELECT 1 FROM user_roles cr WHERE cr.user_id = eu.id AND cr.role_id = ${input.carryingRoleId})`;
  return sql`EXISTS (SELECT 1 FROM users eu WHERE eu.status = 'active' AND eu.deleted_at IS NULL AND eu.id <> ${input.requesterId} AND ${userHoldsKeySql(sql`eu.id`, "roles:write")} AND NOT ${jitActiveSql(sql`eu.id`, input.now)}${carrying})`;
}

/** Evaluate a predicate now (1 = true). */
export async function holds(db: Db, predicate: SQL): Promise<boolean> {
  const rows = await db.all<{ ok: number }>(sql`SELECT (${predicate}) AS ok`);
  return rows[0]?.ok === 1;
}

// ------------------------------------------------------------------ builders

/**
 * New pending request, inserted only when `guard` holds (the caller composes it: no pending request on the role,
 * role at `base_version`, SoD-clean new set, requester holds every added code, an eligible approver exists).
 * RETURNING id → 0 rows = refused (the service re-reads to classify).
 */
export function insertRequestStmt(
  db: Db,
  input: {
    id: string;
    roleId: string;
    baseVersion: number;
    added: readonly string[];
    removed: readonly string[];
    note: string | null;
    requestedBy: string;
    now: number;
    expiresAt: number;
    guard: SQL;
  },
) {
  // Column order = table order: id, role_id, base_version, added, removed, note, status, requested_by, requested_at,
  // expires_at, decided_by, decided_at, decision_note.
  return db
    .insert(roleChangeRequests)
    .select(
      sql`SELECT ${input.id}, ${input.roleId}, ${input.baseVersion}, ${JSON.stringify(input.added)}, ${JSON.stringify(input.removed)}, ${input.note}, 'pending', ${input.requestedBy}, ${input.now}, ${input.expiresAt}, NULL, NULL, NULL WHERE ${input.guard}`,
    )
    .returning({ id: roleChangeRequests.id });
}

/** The row exists (guard for the audit row right after an insert). */
export function requestExistsSql(id: string): SQL {
  return sql`EXISTS (SELECT 1 FROM role_change_requests xrq WHERE xrq.id = ${id})`;
}

/** Flip one overdue pending request to `expired` (lazy expiry / cron). RETURNING id → 0 rows = someone else did. */
export function expireRequestStmt(db: Db, input: { id: string; now: number }) {
  return db
    .update(roleChangeRequests)
    .set({ status: "expired", decidedAt: input.now })
    .where(and(eq(roleChangeRequests.id, input.id), eq(roleChangeRequests.status, "pending"), lte(roleChangeRequests.expiresAt, input.now)))
    .returning({ id: roleChangeRequests.id });
}

/**
 * Decide a pending request when `when` holds (the CAS: status still `pending` is part of `when`).
 * RETURNING id → 0 rows = refused.
 */
export function decideRequestStmt(
  db: Db,
  input: { id: string; status: "approved" | "rejected" | "withdrawn"; actorId: string; now: number; note: string | null; when: SQL },
) {
  return db
    .update(roleChangeRequests)
    .set({ status: input.status, decidedBy: input.actorId, decidedAt: input.now, decisionNote: input.note })
    .where(and(eq(roleChangeRequests.id, input.id), eq(roleChangeRequests.status, "pending"), input.when))
    .returning({ id: roleChangeRequests.id });
}

/** The request is pending and not past its deadline at `now`. */
export function pendingOpenSql(id: string, now: number): SQL {
  return sql`EXISTS (SELECT 1 FROM role_change_requests prq WHERE prq.id = ${id} AND prq.status = 'pending' AND prq.expires_at > ${now})`;
}

/** The audit row with this id exists — the batch marker (see role-change-service approve). */
export function auditRowExistsSql(id: string): SQL {
  return sql`EXISTS (SELECT 1 FROM audit_events mk WHERE mk.id = ${id})`;
}

/** Bump the role version when `when` holds and the role is still at `baseVersion` — LAST in the batch. */
export function bumpRoleVersionStmt(db: Db, input: { roleId: string; baseVersion: number; now: number; when: SQL }) {
  return db
    .update(roles)
    .set({ version: sql`${roles.version} + 1`, updatedAt: input.now })
    .where(and(eq(roles.id, input.roleId), eq(roles.version, input.baseVersion), input.when))
    .returning({ version: roles.version });
}

/**
 * Audit row with a caller-chosen id, inserted only when `when` holds. Used as the FIRST statement of the approve
 * batch: `when` (the full guard) is evaluated before anything in the batch writes, and later statements key on
 * `auditRowExistsSql(id)` — a marker no other batch can satisfy.
 */
export function auditWithIdWhenStmt(
  db: Db,
  input: {
    id: string;
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
    .select(sql`SELECT ${input.id}, ${input.ts}, ${input.actor}, ${input.action}, ${input.target}, ${metadata}, ${input.ip} WHERE ${input.when}`)
    .returning({ id: auditEvents.id });
}
