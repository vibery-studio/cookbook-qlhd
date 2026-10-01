import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, contracts } from "../db/schema";
import type { ContractDto } from "../dto/contracts";
import { generateUlid } from "../utils/id";
import { pdfStatusOf } from "../domain/contract/pdf";
import { auditInsert } from "./audit-dao";

export interface ContractInsertRow {
  id: string;
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
    type: "contract" as const,
    templateId: row.templateId,
    templateVersionId: row.templateVersionId,
    customerId: row.customerId,
    sourceContractId: row.sourceContractId,
    status: "draft" as const,
    createdBy: row.createdBy,
    docDate: row.docDate,
    snapshot: row.snapshot,
    snapshotHash: row.snapshotHash,
    customerName: row.customerName,
    total: row.total,
    version: 1,
    createdAt: row.now,
    updatedAt: row.now,
  };
}

function emptyCan(): ContractDto["can"] {
  return { edit: false, submit: false, approve: false, reject: false, issue: false, void: false, copy: false, withdraw: false, delete: false, create_child: [] };
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

/** A write-side read used to distinguish a lost CAS from a missing or locked contract. */
export async function getContractForWrite(db: Db, id: string): Promise<ContractDto | null> {
  const [row] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  return row === undefined ? null : toDto(row);
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
  return toDto(inserted);
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
          metadata: sql<string>`${metadata}`.as("metadata"),
          ip: sql<string | null>`${input.ip}`.as("ip"),
        })
        .from(contracts)
        .where(and(eq(contracts.id, input.id), sql`changes() > 0`)),
    ),
  ]);
  const updated = rows[0];
  return updated === undefined ? null : toDto(updated);
}

function isCopyGuardFailure(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== null && depth < 5; depth += 1) {
    const message = current instanceof Error ? current.message : typeof current === "string" ? current : "";
    if (message.includes("ck_contracts_status")) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

/**
 * Insert a copied draft. For a voided source, the replacement pointer and the new row share one batch; the
 * deliberately invalid status update is a query-builder-only guard that rolls the batch back when the source CAS
 * touched zero rows.
 */
export async function insertCopy(
  db: Db,
  input: {
    row: ContractInsertRow;
    sourceId: string;
    sourceVoided: boolean;
    audit: ContractAuditInput;
  },
): Promise<{ kind: "ok"; contract: ContractDto } | { kind: "source-conflict" }> {
  try {
    if (!input.sourceVoided) {
      const [rows] = await db.batch([
        db.insert(contracts).values(insertValues(input.row)).returning(),
        auditInsert(db, {
          actor: input.audit.actor,
          action: "contract.created",
          target: `contract:${input.row.id}`,
          metadata: input.audit.metadata,
          ip: input.audit.ip,
          ts: input.audit.ts,
        }),
      ]);
      const inserted = rows[0];
      if (inserted === undefined) throw new Error("insertCopy: insert returned no rows");
      return { kind: "ok", contract: toDto(inserted) };
    }

    const auditId = generateUlid();
    const metadata = JSON.stringify(input.audit.metadata);
    const [rows] = await db.batch([
      db.insert(contracts).values(insertValues(input.row)).returning(),
      db
        .update(contracts)
        .set({ replacedById: input.row.id, updatedAt: input.row.now })
        .where(and(eq(contracts.id, input.sourceId), eq(contracts.status, "voided"), isNull(contracts.replacedById))),
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${auditId}`.as("id"),
            ts: sql<number>`${input.audit.ts}`.as("ts"),
            actor: sql<string>`${input.audit.actor}`.as("actor"),
            action: sql<string>`${"contract.created"}`.as("action"),
            target: sql<string>`${`contract:${input.row.id}`}`.as("target"),
            metadata: sql<string>`${metadata}`.as("metadata"),
            ip: sql<string | null>`${input.audit.ip}`.as("ip"),
          })
          .from(contracts)
          .where(and(eq(contracts.id, input.row.id), sql`changes() = 1`)),
      ),
      // The source UPDATE is immediately before the guarded audit INSERT. If it changed no row, this sets an
      // invalid status and the table CHECK aborts the whole D1 batch, including the new draft.
      db
        .update(contracts)
        .set({ status: sql`CASE WHEN changes() = 1 THEN ${contracts.status} ELSE 'invalid' END` })
        .where(eq(contracts.id, input.row.id)),
    ]);
    const inserted = rows[0];
    if (inserted === undefined) throw new Error("insertCopy: insert returned no rows");
    return { kind: "ok", contract: toDto(inserted) };
  } catch (error) {
    if (isCopyGuardFailure(error)) return { kind: "source-conflict" };
    throw error;
  }
}
