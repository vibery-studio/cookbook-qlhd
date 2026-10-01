import { and, asc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { auditEvents, contracts, templates } from "../db/schema";
import type { ContractDto } from "../dto/contracts";
import { isDocType, LIVE_STATUSES, type DocType } from "../domain/contract/doc-types";
import { generateUlid } from "../utils/id";
import { pdfStatusOf } from "../domain/contract/pdf";
import { auditInsert } from "./audit-dao";

export interface ContractInsertRow {
  id: string;
  /** SPEC-09: the template's type (create) or the source's type (copy). */
  type: DocType;
  /** BG only: `snapshot.dates.valid_until` (CHECK ck_contracts_valid_until). */
  validUntil: string | null;
  /** The business-chain parent (a copied child keeps it); NULL for a standalone document. */
  parentId: string | null;
  templateId: string;
  templateVersionId: string;
  customerId: string;
  sourceContractId: string | null;
  createdBy: string;
  docDate: string;
  snapshot: string;
  snapshotHash: string;
  customerName: string;
  total: number;
  now: number;
}

export interface ContractAuditInput {
  actor: string;
  ip: string | null;
  ts: number;
  metadata: Record<string, unknown>;
}

export interface DraftPatch {
  /** BG: the new `snapshot.dates.valid_until` (doc_date moves on edit); NULL for every other type. */
  validUntil: string | null;
  templateId: string;
  templateVersionId: string;
  customerId: string;
  docDate: string;
  snapshot: string;
  snapshotHash: string;
  customerName: string;
  total: number;
  now: number;
}

function insertValues(row: ContractInsertRow) {
  return {
    id: row.id,
    type: row.type,
    templateId: row.templateId,
    templateVersionId: row.templateVersionId,
    customerId: row.customerId,
    sourceContractId: row.sourceContractId,
    parentId: row.parentId,
    status: "draft" as const,
    createdBy: row.createdBy,
    docDate: row.docDate,
    snapshot: row.snapshot,
    snapshotHash: row.snapshotHash,
    customerName: row.customerName,
    total: row.total,
    version: 1,
    validUntil: row.validUntil,
    createdAt: row.now,
    updatedAt: row.now,
  };
}

function emptyCan(): ContractDto["can"] {
  const reason = { edit: null, submit: null, approve: null, reject: null, issue: null, void: null, copy: null, withdraw: null, delete: null };
  return { edit: false, submit: false, approve: false, reject: false, issue: false, void: false, copy: false, withdraw: false, delete: false, reason, create_child: [] };
}

function toDto(row: typeof contracts.$inferSelect): ContractDto {
  return {
    id: row.id,
    type: row.type as ContractDto["type"], // CHECK ck_contracts_type
    status: row.status as ContractDto["status"],
    number: row.number,
    seq: row.seq,
    series_year: row.seriesYear,
    template_id: row.templateId,
    template_version_id: row.templateVersionId,
    customer_id: row.customerId,
    customer_name: row.customerName,
    total: row.total,
    created_by: row.createdBy,
    doc_date: row.docDate,
    version: row.version,
    snapshot: JSON.parse(row.snapshot) as Record<string, unknown>,
    snapshot_hash: row.snapshotHash,
    source_contract_id: row.sourceContractId,
    replaced_by_id: row.replacedById,
    // write-side view (like steps/timeline/can below): no joins — GET /contracts/{id} carries parent/children refs
    valid_until: row.validUntil,
    parent: null,
    children: [],
    submitted_at: row.submittedAt,
    decided_at: row.decidedAt,
    issued_by: row.issuedBy,
    issued_at: row.issuedAt,
    rendered_hash: row.renderedHash,
    voided_by: row.voidedBy,
    voided_at: row.voidedAt,
    void_reason: row.voidReason,
    pdf_status: pdfStatusOf(row),
    pdf_size: row.pdfSize,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    steps: [],
    timeline: [],
    can: emptyCan(),
  };
}

type ContractRowSel = typeof contracts.$inferSelect;

/** `toDto` + the parent ref (one small read when the row has a parent) — a copied child's 201 names its parent. */
async function toDtoWithParent(db: Db, row: ContractRowSel): Promise<ContractDto> {
  const dto = toDto(row);
  if (row.parentId === null) return dto;
  const [p] = await db
    .select({ id: contracts.id, type: contracts.type, number: contracts.number, status: contracts.status, total: contracts.total, docDate: contracts.docDate })
    .from(contracts)
    .where(eq(contracts.id, row.parentId))
    .limit(1);
  if (p === undefined) return dto;
  return {
    ...dto,
    parent: {
      id: p.id,
      type: p.type as ContractDto["type"],
      number: p.number,
      status: p.status as ContractDto["status"],
      total: p.total,
      doc_date: p.docDate,
    },
  };
}

/** A write-side read used to distinguish a lost CAS from a missing or locked contract. */
export async function getContractForWrite(db: Db, id: string): Promise<ContractDto | null> {
  const [row] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  return row === undefined ? null : toDtoWithParent(db, row);
}

/** `templates.type` of a template (SPEC-09 FR-1: a document takes its type from its template); null = unknown template. */
export async function templateTypeOf(db: Db, templateId: string): Promise<DocType | null> {
  const [row] = await db.select({ type: templates.type }).from(templates).where(eq(templates.id, templateId)).limit(1);
  return row !== undefined && isDocType(row.type) ? row.type : null;
}

/** The live child of `parentId` of `type` (DEC-4: at most one), oldest first — for 409 `child-exists` `existing_id`. */
export async function liveChildOf(db: Db, parentId: string, type: DocType): Promise<string | null> {
  const [row] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.parentId, parentId), eq(contracts.type, type), inArray(contracts.status, [...LIVE_STATUSES])))
    .orderBy(asc(contracts.createdAt), asc(contracts.id))
    .limit(1);
  return row?.id ?? null;
}

/** Insert a draft and its creation audit row atomically. */
export async function insertContract(
  db: Db,
  row: ContractInsertRow,
  audit: ContractAuditInput,
): Promise<ContractDto> {
  const [rows] = await db.batch([
    db.insert(contracts).values(insertValues(row)).returning(),
    auditInsert(db, {
      actor: audit.actor,
      action: "contract.created",
      target: `contract:${row.id}`,
      metadata: audit.metadata,
      ip: audit.ip,
      ts: audit.ts,
    }),
  ]);
  const inserted = rows[0];
  if (inserted === undefined) throw new Error("insertContract: insert returned no rows");
  return toDtoWithParent(db, inserted);
}

/** CAS update a draft and append the field-name-only audit row in the same batch. */
export async function updateDraftCas(
  db: Db,
  input: {
    id: string;
    expectedVersion: number;
    actor: string;
    ip: string | null;
    patch: DraftPatch;
    fieldNames: string[];
  },
): Promise<ContractDto | null> {
  const auditId = generateUlid();
  const metadata = JSON.stringify({ fields: input.fieldNames });
  const [rows] = await db.batch([
    db
      .update(contracts)
      .set({
        templateId: input.patch.templateId,
        templateVersionId: input.patch.templateVersionId,
        customerId: input.patch.customerId,
        docDate: input.patch.docDate,
        snapshot: input.patch.snapshot,
        snapshotHash: input.patch.snapshotHash,
        customerName: input.patch.customerName,
        total: input.patch.total,
        validUntil: input.patch.validUntil,
        updatedAt: input.patch.now,
        version: sql`${contracts.version} + 1`,
      })
      .where(
        and(
          eq(contracts.id, input.id),
          eq(contracts.status, "draft"),
          eq(contracts.version, input.expectedVersion),
          eq(contracts.createdBy, input.actor),
        ),
      )
      .returning(),
    // `changes()` is evaluated after the CAS update; a lost update therefore creates no audit row.
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${auditId}`.as("id"),
          ts: sql<number>`${input.patch.now}`.as("ts"),
          actor: sql<string>`${input.actor}`.as("actor"),
          action: sql<string>`${"contract.updated"}`.as("action"),
          target: sql<string>`${`contract:${input.id}`}`.as("target"),
          // FR-14: the row's type, read inside the batch
          metadata: sql<string>`json_set(${metadata}, '$.type', ${contracts.type})`.as("metadata"),
          ip: sql<string | null>`${input.ip}`.as("ip"),
        })
        .from(contracts)
        .where(and(eq(contracts.id, input.id), sql`changes() > 0`)),
    ),
  ]);
  const updated = rows[0];
  return updated === undefined ? null : toDtoWithParent(db, updated);
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    parts.push(current instanceof Error ? current.message : typeof current === "string" ? current : "");
    current = current instanceof Error ? current.cause : null;
  }
  return parts.join(" ");
}

const isCopyGuardFailure = (error: unknown) => errorText(error).includes("ck_contracts_status");
/** `uq_contracts_parent_child_live` (partial UNIQUE on parent_id, type) — SQLite names the columns, not the index. */
const isLiveChildConflict = (error: unknown) => {
  const text = errorText(error);
  return text.includes("uq_contracts_parent_child_live") || text.includes("contracts.parent_id, contracts.type");
};

/** A copied child's parent guard (DEC-5 A): the parent must still be issued, and a BG in date on `today` (VN, P-6). */
export interface CopyParentGuard {
  id: string;
  today: string;
}

const parentRow = alias(contracts, "p");

/**
 * The new draft's INSERT. With a parent guard it is `INSERT … SELECT <values> FROM contracts p WHERE p.id = :parent AND
 * p.status = 'issued' AND (p.type <> 'quote' OR p.valid_until >= :today)` — 0 rows when the parent no longer qualifies.
 */
function insertDraft(db: Db, row: ContractInsertRow, guard: CopyParentGuard | undefined) {
  if (guard === undefined) return db.insert(contracts).values(insertValues(row)).returning();
  const values = insertValues(row) as Record<string, unknown>;
  const fields = Object.fromEntries(
    Object.keys(getTableColumns(contracts)).map((key) => [key, sql`${values[key] ?? null}`.as(key)]),
  );
  const select = db
    .select(fields)
    .from(parentRow)
    .where(
      and(
        eq(parentRow.id, guard.id),
        eq(parentRow.status, "issued"),
        sql`(${parentRow.type} <> 'quote' OR ${parentRow.validUntil} >= ${guard.today})`,
      ),
    );
  // drizzle checks the selected keys against the table's columns (same keys, same order)
  return db.insert(contracts).select(select as never).returning();
}

export type InsertCopyResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "source-conflict" }
  /** the guarded parent no longer qualifies (0 rows) — the caller diagnoses `parent-not-issued` / `quote-expired` */
  | { kind: "parent-guard" }
  /** another live child of the same parent + type exists (DEC-4) */
  | { kind: "child-exists" };

/**
 * Insert a copied draft. For a voided source, the replacement pointer and the new row share one batch; the
 * deliberately invalid status update is a query-builder-only guard that rolls the batch back when the source CAS
 * touched zero rows. A copied child (SPEC-09 FR-7) keeps its parent: the INSERT is guarded by the parent (`parent`),
 * and the audit row is written only when the draft row exists.
 */
export async function insertCopy(
  db: Db,
  input: {
    row: ContractInsertRow;
    sourceId: string;
    sourceVoided: boolean;
    audit: ContractAuditInput;
    parent?: CopyParentGuard;
  },
): Promise<InsertCopyResult> {
  const metadata = JSON.stringify(input.audit.metadata);
  // audit row only when the draft row exists (a guarded INSERT may add none)
  const auditCreated = (extra?: ReturnType<typeof sql>) =>
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${generateUlid()}`.as("id"),
          ts: sql<number>`${input.audit.ts}`.as("ts"),
          actor: sql<string>`${input.audit.actor}`.as("actor"),
          action: sql<string>`${"contract.created"}`.as("action"),
          target: sql<string>`${`contract:${input.row.id}`}`.as("target"),
          metadata: sql<string>`${metadata}`.as("metadata"),
          ip: sql<string | null>`${input.audit.ip}`.as("ip"),
        })
        .from(contracts)
        .where(extra === undefined ? eq(contracts.id, input.row.id) : and(eq(contracts.id, input.row.id), extra)),
    );
  try {
    if (!input.sourceVoided) {
      const [rows] = await db.batch([insertDraft(db, input.row, input.parent), auditCreated()]);
      const inserted = rows[0];
      if (inserted === undefined) {
        if (input.parent !== undefined) return { kind: "parent-guard" };
        throw new Error("insertCopy: insert returned no rows");
      }
      return { kind: "ok", contract: await toDtoWithParent(db, inserted) };
    }

    const [rows] = await db.batch([
      insertDraft(db, input.row, input.parent),
      db
        .update(contracts)
        .set({ replacedById: input.row.id, updatedAt: input.row.now })
        .where(
          and(
            eq(contracts.id, input.sourceId),
            eq(contracts.status, "voided"),
            isNull(contracts.replacedById),
            // a guarded INSERT that added no row must not mark the source replaced
            sql`EXISTS (SELECT 1 FROM contracts n WHERE n.id = ${input.row.id})`,
          ),
        ),
      auditCreated(sql`changes() = 1`),
      // The source UPDATE is immediately before the guarded audit INSERT. If it changed no row (while the draft exists),
      // this sets an invalid status and the table CHECK aborts the whole D1 batch, including the new draft.
      db
        .update(contracts)
        .set({ status: sql`CASE WHEN changes() = 1 THEN ${contracts.status} ELSE 'invalid' END` })
        .where(eq(contracts.id, input.row.id)),
    ]);
    const inserted = rows[0];
    if (inserted === undefined) {
      if (input.parent !== undefined) return { kind: "parent-guard" };
      throw new Error("insertCopy: insert returned no rows");
    }
    return { kind: "ok", contract: await toDtoWithParent(db, inserted) };
  } catch (error) {
    if (isCopyGuardFailure(error)) return { kind: "source-conflict" };
    if (input.parent !== undefined && isLiveChildConflict(error)) return { kind: "child-exists" };
    throw error;
  }
}
