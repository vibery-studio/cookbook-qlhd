/**
 * Withdraw DAO (SPEC-04b §3.2 C): pending → draft while no approval step has been decided. Pure `(db, input)`.
 * One batch, in this order: (1) CAS on the contract, (2) audit guarded by `changes() > 0` (must directly follow the
 * UPDATE), (3) delete the waiting steps only if the contract is now `draft`. A lost CAS writes nothing.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { approvalSteps, auditEvents, contracts } from "../db/schema";
import { generateUlid } from "../utils/id";

export interface WithdrawCasInput {
  id: string;
  actor: string;
  ip: string | null;
  now: Date;
}

export async function withdrawCas(db: Db, input: WithdrawCasInput): Promise<boolean> {
  const now = Math.floor(input.now.getTime() / 1000);
  const [moved] = await db.batch([
    db
      .update(contracts)
      .set({
        status: "draft",
        submittedAt: null,
        decidedAt: null,
        version: sql`${contracts.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contracts.id, input.id),
          eq(contracts.status, "pending"),
          eq(contracts.createdBy, input.actor),
          sql`NOT EXISTS (SELECT 1 FROM approval_steps s WHERE s.contract_id = ${input.id} AND s.status <> 'waiting')`,
        ),
      )
      .returning({ id: contracts.id }),
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${generateUlid()}`.as("id"),
          ts: sql<number>`${now}`.as("ts"),
          actor: sql<string>`${input.actor}`.as("actor"),
          action: sql<string>`${"contract.withdrawn"}`.as("action"),
          target: sql<string>`${`contract:${input.id}`}`.as("target"),
          metadata: sql<string>`json_object('from', 'pending', 'to', 'draft', 'type', ${contracts.type})`.as("metadata"),
          ip: sql<string | null>`${input.ip}`.as("ip"),
        })
        .from(contracts)
        .where(and(eq(contracts.id, input.id), sql`changes() > 0`)),
    ),
    db
      .delete(approvalSteps)
      .where(
        and(
          eq(approvalSteps.contractId, input.id),
          eq(approvalSteps.status, "waiting"),
          sql`EXISTS (SELECT 1 FROM contracts c WHERE c.id = ${input.id} AND c.status = 'draft')`,
        ),
      ),
  ]);
  return moved.length > 0;
}

export type WithdrawDiagnosis =
  | { kind: "not-found" }
  | { kind: "already-decided" }
  | { kind: "state-conflict"; current: string };

/** Why the CAS matched 0 rows (read after the fact). */
export async function diagnoseWithdraw(db: Db, id: string): Promise<WithdrawDiagnosis> {
  const [c] = await db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, id)).limit(1);
  if (c === undefined) return { kind: "not-found" };
  if (c.status === "pending") {
    const steps = await db
      .select({ status: approvalSteps.status })
      .from(approvalSteps)
      .where(eq(approvalSteps.contractId, id));
    if (steps.some((s) => s.status !== "waiting")) return { kind: "already-decided" };
  }
  return { kind: "state-conflict", current: c.status };
}

export interface LifecycleEvent {
  action: string;
  at: number;
  actor: string | null;
}

/** submitted / withdrawn audit rows: the columns `submitted_at` reset on withdraw, the history must not. */
export async function listLifecycleEvents(db: Db, id: string): Promise<LifecycleEvent[]> {
  const rows = await db
    .select({ action: auditEvents.action, at: auditEvents.ts, actor: auditEvents.actor })
    .from(auditEvents)
    .where(and(eq(auditEvents.target, `contract:${id}`), inArray(auditEvents.action, ["contract.submitted", "contract.withdrawn"])))
    .orderBy(asc(auditEvents.ts));
  return rows;
}
