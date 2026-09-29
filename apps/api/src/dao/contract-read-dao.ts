/**
 * Contract read DAO (SPEC-03 FR-9). Pure `(db, input)` reads: one query per page, no N+1
 * (`customer_name` / `total` are columns copied from the snapshot).
 */
import { and, asc, desc, eq, inArray, lt, gt, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { approvalSteps, contracts, users } from "../db/schema";

export type ContractRow = typeof contracts.$inferSelect;
export type StepRow = typeof approvalSteps.$inferSelect;
export type ContractStatusValue = "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";

export interface ContractFilters {
  customerId?: string;
  createdBy?: string;
}

export interface ListContractsInput extends ContractFilters {
  status?: ContractStatusValue;
  after?: { updatedAt: number; id: string };
  limit: number;
}

export interface ContractListRow {
  id: string;
  number: string | null;
  status: ContractStatusValue;
  customerName: string;
  total: number;
  createdBy: string;
  createdByName: string | null;
  updatedAt: number;
}

/** Newest first, `(updated_at DESC, id DESC)`; fetches `limit + 1` so the caller can tell there is a next page. */
export async function listContracts(db: Db, input: ListContractsInput): Promise<ContractListRow[]> {
  const conds: SQL[] = [];
  if (input.status !== undefined) conds.push(eq(contracts.status, input.status));
  if (input.customerId !== undefined) conds.push(eq(contracts.customerId, input.customerId));
  if (input.createdBy !== undefined) conds.push(eq(contracts.createdBy, input.createdBy));
  if (input.after !== undefined) {
    const { updatedAt, id } = input.after;
    conds.push(or(lt(contracts.updatedAt, updatedAt), and(eq(contracts.updatedAt, updatedAt), lt(contracts.id, id)))!);
  }
  const rows = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      status: contracts.status,
      customerName: contracts.customerName,
      total: contracts.total,
      createdBy: contracts.createdBy,
      createdByName: users.displayName,
      updatedAt: contracts.updatedAt,
    })
    .from(contracts)
    .leftJoin(users, eq(users.id, contracts.createdBy))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(contracts.updatedAt), desc(contracts.id))
    .limit(input.limit + 1);
  return rows.map((r) => ({ ...r, status: r.status as ContractStatusValue }));
}

/** Per-status counts under the same filters minus `status` (the tab badges). Missing statuses → 0. */
export async function countByStatus(db: Db, filters: ContractFilters): Promise<Record<ContractStatusValue, number>> {
  const conds: SQL[] = [];
  if (filters.customerId !== undefined) conds.push(eq(contracts.customerId, filters.customerId));
  if (filters.createdBy !== undefined) conds.push(eq(contracts.createdBy, filters.createdBy));
  const rows = await db
    .select({ status: contracts.status, n: sql<number>`count(*)` })
    .from(contracts)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(contracts.status);
  const out: Record<ContractStatusValue, number> = {
    draft: 0,
    pending: 0,
    approved: 0,
    issued: 0,
    rejected: 0,
    voided: 0,
  };
  for (const r of rows) if (r.status in out) out[r.status as ContractStatusValue] = Number(r.n);
  return out;
}

export interface ContractDetailRow {
  contract: ContractRow;
  steps: StepRow[];
  /** display names for every user id that appears in the contract (creator, deciders, issuer, voider) */
  names: Map<string, string | null>;
}

export async function getContractDetail(db: Db, id: string): Promise<ContractDetailRow | null> {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  if (contract === undefined) return null;
  const steps = await db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.contractId, id))
    .orderBy(asc(approvalSteps.stepNo));
  const ids = new Set<string>([contract.createdBy]);
  if (contract.issuedBy !== null) ids.add(contract.issuedBy);
  if (contract.voidedBy !== null) ids.add(contract.voidedBy);
  for (const s of steps) if (s.decidedBy !== null) ids.add(s.decidedBy);
  const userRows = await db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, [...ids]));
  const names = new Map<string, string | null>(userRows.map((u) => [u.id, u.name]));
  return { contract, steps, names };
}

export interface QueueRow {
  contractId: string;
  stepNo: number;
  label: string;
  customerName: string;
  total: number;
  createdBy: string;
  createdByName: string | null;
  submittedAt: number | null;
}

export interface ApprovalQueueInput {
  actorId: string;
  actorRoles: readonly string[];
  actorPermissions: readonly string[];
  after?: { submittedAt: number; id: string };
  limit: number;
}

/**
 * One join. A row is a step that is the LOWEST `waiting` step of a `pending` contract, whose permission (and
 * `required_role` if set) the caller holds, on a contract the caller did not create and has not decided a step of.
 * Mirrors domain `isEligible` + the excluded set {created_by, prior deciders}. Oldest submission first.
 */
export async function listApprovalQueue(db: Db, input: ApprovalQueueInput): Promise<QueueRow[]> {
  if (input.actorPermissions.length === 0) return [];
  const lower = alias(approvalSteps, "lower_step");
  const mine = alias(approvalSteps, "my_step");
  const submitted = sql<number>`coalesce(${contracts.submittedAt}, 0)`;
  const conds: SQL[] = [
    eq(contracts.status, "pending"),
    eq(approvalSteps.status, "waiting"),
    inArray(approvalSteps.requiredPermission, [...input.actorPermissions]),
    input.actorRoles.length > 0
      ? or(sql`${approvalSteps.requiredRole} IS NULL`, inArray(approvalSteps.requiredRole, [...input.actorRoles]))!
      : sql`${approvalSteps.requiredRole} IS NULL`,
    ne(contracts.createdBy, input.actorId),
    notExists(
      db
        .select({ one: sql`1` })
        .from(lower)
        .where(
          and(
            eq(lower.contractId, approvalSteps.contractId),
            eq(lower.status, "waiting"),
            lt(lower.stepNo, approvalSteps.stepNo),
          ),
        ),
    ),
    notExists(
      db
        .select({ one: sql`1` })
        .from(mine)
        .where(and(eq(mine.contractId, approvalSteps.contractId), eq(mine.decidedBy, input.actorId))),
    ),
  ];
  if (input.after !== undefined) {
    const { submittedAt, id } = input.after;
    conds.push(or(gt(submitted, submittedAt), and(eq(submitted, submittedAt), gt(contracts.id, id)))!);
  }
  const rows = await db
    .select({
      contractId: contracts.id,
      stepNo: approvalSteps.stepNo,
      label: approvalSteps.label,
      customerName: contracts.customerName,
      total: contracts.total,
      createdBy: contracts.createdBy,
      createdByName: users.displayName,
      submittedAt: contracts.submittedAt,
    })
    .from(approvalSteps)
    .innerJoin(contracts, eq(contracts.id, approvalSteps.contractId))
    .leftJoin(users, eq(users.id, contracts.createdBy))
    .where(and(...conds))
    .orderBy(asc(submitted), asc(contracts.id))
    .limit(input.limit + 1);
  return rows;
}
