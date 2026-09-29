/**
 * Approval DAO (SPEC-03 FR-4, FR-5, §3.3, I9, SoD, DEC-10). Pure `(db, input)` functions returning plain DTOs.
 *
 * Every status move is ONE `db.batch` (a D1 transaction): the CAS UPDATE, then the audit `INSERT … SELECT` guarded by
 * SQLite `changes()` (1 only if THIS statement won — row-1 precedent `updateCustomerCas`), then the dependent rows.
 * A lost CAS writes nothing. drizzle's batch takes query builders only, hence `INSERT … SELECT` for guarded inserts
 * (the select lists every column in table order — drizzle emits the full column list).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { approvalSteps, auditEvents, contracts, permissions, rolePermissions, roles, userRoles, users } from "../db/schema";
import { generateUlid } from "../utils/id";

export interface ApprovalCandidate {
  id: string;
  roles: string[];
  permissions: string[];
}

export interface DecisionStep {
  id: string;
  stepNo: number;
  label: string;
  requiredPermission: string;
  requiredRole: string | null;
  status: "waiting" | "approved" | "rejected";
  decidedBy: string | null;
}

export interface DecisionState {
  id: string;
  status: string;
  createdBy: string;
  version: number;
  snapshot: string; // JSON text
  snapshotHash: string;
  steps: DecisionStep[];
}

const unixSeconds = (d: Date): number => Math.floor(d.getTime() / 1000);

/**
 * Active users with their role names + permission keys (one join). Only people who could ever decide a step matter,
 * so users without any permission still appear (empty lists) — `isEligible` filters them out.
 */
export async function listCandidates(db: Db): Promise<ApprovalCandidate[]> {
  const rows = await db
    .select({ id: users.id, role: roles.name, perm: permissions.key })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(users.status, "active"), sql`${users.deletedAt} IS NULL`, sql`${users.deletionRequestedAt} IS NULL`));
  const byId = new Map<string, { roles: Set<string>; permissions: Set<string> }>();
  for (const r of rows) {
    let c = byId.get(r.id);
    if (c === undefined) {
      c = { roles: new Set(), permissions: new Set() };
      byId.set(r.id, c);
    }
    c.roles.add(r.role);
    if (r.perm !== null) c.permissions.add(r.perm);
  }
  return [...byId.entries()].map(([id, c]) => ({ id, roles: [...c.roles], permissions: [...c.permissions] }));
}

/** Contract status/creator/snapshot + its steps (ordered) — for the pre-checks and the 0-row diagnosis. */
export async function getDecisionState(db: Db, id: string): Promise<DecisionState | null> {
  const [c] = await db
    .select({
      id: contracts.id,
      status: contracts.status,
      createdBy: contracts.createdBy,
      version: contracts.version,
      snapshot: contracts.snapshot,
      snapshotHash: contracts.snapshotHash,
    })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  if (c === undefined) return null;
  const steps = await db
    .select({
      id: approvalSteps.id,
      stepNo: approvalSteps.stepNo,
      label: approvalSteps.label,
      requiredPermission: approvalSteps.requiredPermission,
      requiredRole: approvalSteps.requiredRole,
      status: approvalSteps.status,
      decidedBy: approvalSteps.decidedBy,
    })
    .from(approvalSteps)
    .where(eq(approvalSteps.contractId, id))
    .orderBy(asc(approvalSteps.stepNo));
  return {
    ...c,
    steps: steps.map((s) => ({ ...s, status: s.status as DecisionStep["status"] })),
  };
}

export interface SubmitCasInput {
  id: string;
  actor: string;
  ip: string | null;
  /** the version + hash the steps were computed from: a concurrent draft edit makes the CAS miss */
  expectedVersion: number;
  expectedHash: string;
  steps: Array<{ step_no: number; label: string; required_permission: string; required_role: string | null }>;
  now: Date;
}

/**
 * draft→pending CAS + `contract.submitted` audit + the steps, one batch. Returns false when the CAS missed
 * (not draft any more, edited meanwhile, or not the creator) — nothing is written then.
 */
export async function submitCas(db: Db, input: SubmitCasInput): Promise<boolean> {
  const now = unixSeconds(input.now);
  const target = `contract:${input.id}`;
  const metadata = JSON.stringify({
    from: "draft",
    to: "pending",
    steps: input.steps.map((s) => ({ step_no: s.step_no, label: s.label })),
  });
  const auditId = generateUlid();

  // Steps land only when THIS batch moved the contract (pending + this second's submitted_at + created_by), and
  // never twice (NOT EXISTS the same step_no; UNIQUE(contract_id, step_no) is the last net).
  const stepInserts = input.steps.map((s) =>
    db.insert(approvalSteps).select(
      db
        .select({
          id: sql<string>`${generateUlid()}`.as("id"),
          contractId: sql<string>`${input.id}`.as("contract_id"),
          stepNo: sql<number>`${s.step_no}`.as("step_no"),
          label: sql<string>`${s.label}`.as("label"),
          requiredPermission: sql<string>`${s.required_permission}`.as("required_permission"),
          requiredRole: sql<string | null>`${s.required_role}`.as("required_role"),
          status: sql<string>`'waiting'`.as("status"),
          decidedBy: sql<string | null>`NULL`.as("decided_by"),
          decidedAt: sql<number | null>`NULL`.as("decided_at"),
          note: sql<string | null>`NULL`.as("note"),
          snapshotHashAtDecision: sql<string | null>`NULL`.as("snapshot_hash_at_decision"),
          createdAt: sql<number>`${now}`.as("created_at"),
        })
        .from(contracts)
        .where(
          and(
            eq(contracts.id, input.id),
            eq(contracts.status, "pending"),
            eq(contracts.createdBy, input.actor),
            eq(contracts.submittedAt, now),
            sql`NOT EXISTS (SELECT 1 FROM approval_steps s2 WHERE s2.contract_id = ${input.id} AND s2.step_no = ${s.step_no})`,
          ),
        ),
    ),
  );

  const [moved] = await db.batch([
    db
      .update(contracts)
      .set({ status: "pending", submittedAt: now, updatedAt: now })
      .where(
        and(
          eq(contracts.id, input.id),
          eq(contracts.status, "draft"),
          eq(contracts.createdBy, input.actor),
          eq(contracts.version, input.expectedVersion),
          eq(contracts.snapshotHash, input.expectedHash),
        ),
      )
      .returning({ id: contracts.id }),
    // must directly follow the UPDATE: changes() refers to the previous statement
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${auditId}`.as("id"),
          ts: sql<number>`${now}`.as("ts"),
          actor: sql<string>`${input.actor}`.as("actor"),
          action: sql<string>`${"contract.submitted"}`.as("action"),
          target: sql<string>`${target}`.as("target"),
          metadata: sql<string>`${metadata}`.as("metadata"),
          ip: sql<string | null>`${input.ip}`.as("ip"),
        })
        .from(contracts)
        .where(and(eq(contracts.id, input.id), sql`changes() > 0`)),
    ),
    ...stepInserts,
  ]);
  return moved.length > 0;
}

export interface DecideCasInput {
  contractId: string;
  /** the step the pre-checks were run against; the CAS lands only if it is STILL the current waiting step */
  stepId: string;
  stepNo: number;
  label: string;
  actor: string;
  ip: string | null;
  decision: "approved" | "rejected";
  note: string | null;
  /** contract status after this decision: approved (last step) · rejected · pending (more steps) */
  to: "approved" | "rejected" | "pending";
  now: Date;
}

/**
 * Decide the current step, one batch:
 *  1. step CAS — `id = :stepId AND status='waiting' AND step_no = MIN(waiting) AND contract pending AND NOT EXISTS
 *     (a step of this contract decided by :actor)` (one_person_one_step inside the CAS, SPEC §3.3 SoD); stamps
 *     `snapshot_hash_at_decision` from the contract row.
 *  2. audit row, guarded by `changes()` of (1).
 *  3. contract move (pending→approved when no non-approved step is left · pending→rejected · or just `updated_at`),
 *     guarded by "(1) happened": our step carries our decision.
 * Returns false when the step CAS missed (nothing written).
 */
export async function decideCas(db: Db, input: DecideCasInput): Promise<boolean> {
  const now = unixSeconds(input.now);
  const cid = input.contractId;
  const action = input.decision === "approved" ? "contract.approved" : "contract.rejected";
  const metadata = JSON.stringify(
    input.decision === "approved"
      ? { step_no: input.stepNo, label: input.label, from: "pending", to: input.to }
      : { step_no: input.stepNo, from: "pending", to: input.to },
  );
  const auditId = generateUlid();

  const ourStepDecided = sql`EXISTS (SELECT 1 FROM approval_steps s3 WHERE s3.id = ${input.stepId} AND s3.contract_id = ${cid}
    AND s3.status = ${input.decision} AND s3.decided_by = ${input.actor})`;
  const contractGuard =
    input.to === "approved"
      ? and(
          eq(contracts.id, cid),
          eq(contracts.status, "pending"),
          ourStepDecided,
          sql`NOT EXISTS (SELECT 1 FROM approval_steps s4 WHERE s4.contract_id = ${cid} AND s4.status <> 'approved')`,
        )
      : and(eq(contracts.id, cid), eq(contracts.status, "pending"), ourStepDecided);

  const [stepRows] = await db.batch([
    db
      .update(approvalSteps)
      .set({
        status: input.decision,
        decidedBy: input.actor,
        decidedAt: now,
        note: input.note,
        snapshotHashAtDecision: sql`(SELECT c.snapshot_hash FROM contracts c WHERE c.id = ${cid})`,
      })
      .where(
        and(
          eq(approvalSteps.id, input.stepId),
          eq(approvalSteps.contractId, cid),
          eq(approvalSteps.status, "waiting"),
          sql`${approvalSteps.stepNo} = (SELECT MIN(s1.step_no) FROM approval_steps s1 WHERE s1.contract_id = ${cid} AND s1.status = 'waiting')`,
          sql`EXISTS (SELECT 1 FROM contracts c WHERE c.id = ${cid} AND c.status = 'pending')`,
          sql`NOT EXISTS (SELECT 1 FROM approval_steps s2 WHERE s2.contract_id = ${cid} AND s2.decided_by = ${input.actor})`,
        ),
      )
      .returning({ id: approvalSteps.id }),
    // must directly follow the step UPDATE: changes() refers to the previous statement
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${auditId}`.as("id"),
          ts: sql<number>`${now}`.as("ts"),
          actor: sql<string>`${input.actor}`.as("actor"),
          action: sql<string>`${action}`.as("action"),
          target: sql<string>`${`contract:${cid}`}`.as("target"),
          metadata: sql<string>`${metadata}`.as("metadata"),
          ip: sql<string | null>`${input.ip}`.as("ip"),
        })
        .from(approvalSteps)
        .where(and(eq(approvalSteps.id, input.stepId), sql`changes() > 0`)),
    ),
    db
      .update(contracts)
      .set(input.to === "pending" ? { updatedAt: now } : { status: input.to, decidedAt: now, updatedAt: now })
      .where(contractGuard),
  ]);
  return stepRows.length > 0;
}
