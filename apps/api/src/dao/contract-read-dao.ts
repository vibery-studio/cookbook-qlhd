/**
 * Contract read DAO (SPEC-03 FR-9). Pure `(db, input)` reads: one query per page, no N+1
 * (`customer_name` / `total` are columns copied from the snapshot).
 */
import { and, asc, desc, eq, inArray, lt, gt, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { approvalSteps, contracts, templates, users } from "../db/schema";
import type { DocType } from "../domain/contract/doc-types";

export type ContractRow = typeof contracts.$inferSelect;
export type StepRow = typeof approvalSteps.$inferSelect;
export type ContractStatusValue = "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";

export interface ContractFilters {
  type?: DocType;
  customerId?: string;
  createdBy?: string;
  templateId?: string;
}

export interface ListContractsInput extends ContractFilters {
  status?: ContractStatusValue;
  after?: { updatedAt: number; id: string };
  limit: number;
}

export interface ContractListRow {
  id: string;
  type: DocType;
  parentId: string | null;
  validUntil: string | null;
  number: string | null;
  status: ContractStatusValue;
  customerName: string;
  templateName: string;
  total: number;
  createdBy: string;
  createdByName: string | null;
  updatedAt: number;
}

/** Newest first, `(updated_at DESC, id DESC)`; fetches `limit + 1` so the caller can tell there is a next page. */
export async function listContracts(db: Db, input: ListContractsInput): Promise<ContractListRow[]> {
  const conds: SQL[] = [];
  if (input.type !== undefined) conds.push(eq(contracts.type, input.type));
  if (input.status !== undefined) conds.push(eq(contracts.status, input.status));
  if (input.customerId !== undefined) conds.push(eq(contracts.customerId, input.customerId));
  if (input.createdBy !== undefined) conds.push(eq(contracts.createdBy, input.createdBy));
  if (input.templateId !== undefined) conds.push(eq(contracts.templateId, input.templateId));
  if (input.after !== undefined) {
    const { updatedAt, id } = input.after;
    conds.push(or(lt(contracts.updatedAt, updatedAt), and(eq(contracts.updatedAt, updatedAt), lt(contracts.id, id)))!);
  }
  const rows = await db
    .select({
      id: contracts.id,
      type: contracts.type,
      parentId: contracts.parentId,
      validUntil: contracts.validUntil,
      number: contracts.number,
      status: contracts.status,
      customerName: contracts.customerName,
      templateName: templates.name,
      total: contracts.total,
      createdBy: contracts.createdBy,
      createdByName: users.displayName,
      updatedAt: contracts.updatedAt,
    })
    .from(contracts)
    .innerJoin(templates, eq(templates.id, contracts.templateId))
    .leftJoin(users, eq(users.id, contracts.createdBy))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(contracts.updatedAt), desc(contracts.id))
    .limit(input.limit + 1);
  return rows.map((r) => ({ ...r, type: r.type as DocType, status: r.status as ContractStatusValue }));
}

/** Per-status counts under the same filters minus `status` (the tab badges; `type` narrows them). Missing statuses → 0. */
export async function countByStatus(db: Db, filters: ContractFilters): Promise<Record<ContractStatusValue, number>> {
  const conds: SQL[] = [];
  if (filters.type !== undefined) conds.push(eq(contracts.type, filters.type));
  if (filters.customerId !== undefined) conds.push(eq(contracts.customerId, filters.customerId));
  if (filters.createdBy !== undefined) conds.push(eq(contracts.createdBy, filters.createdBy));
  if (filters.templateId !== undefined) conds.push(eq(contracts.templateId, filters.templateId));
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
  type: DocType;
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
      type: contracts.type,
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
  return rows.map((r) => ({ ...r, type: r.type as DocType }));
}

/** A related document (parent or child) — `ContractRef` of the API. */
export interface RefRow {
  id: string;
  type: DocType;
  number: string | null;
  status: ContractStatusValue;
  total: number;
  docDate: string;
}

const refColumns = {
  id: contracts.id,
  type: contracts.type,
  number: contracts.number,
  status: contracts.status,
  total: contracts.total,
  docDate: contracts.docDate,
};

const toRef = (r: { id: string; type: string; number: string | null; status: string; total: number; docDate: string }): RefRow => ({
  ...r,
  type: r.type as DocType,
  status: r.status as ContractStatusValue,
});

/** Refs for `ids` in one query (order not guaranteed — the caller keys by id). */
export async function refsOf(db: Db, ids: readonly string[]): Promise<RefRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.select(refColumns).from(contracts).where(inArray(contracts.id, [...ids]));
  return rows.map(toRef);
}

/** Every child of `parentId` (any status), oldest first — one query on `idx_contracts_parent`. */
export async function childrenOf(db: Db, parentId: string): Promise<RefRow[]> {
  const rows = await db
    .select(refColumns)
    .from(contracts)
    .where(eq(contracts.parentId, parentId))
    .orderBy(asc(contracts.createdAt), asc(contracts.id));
  return rows.map(toRef);
}
