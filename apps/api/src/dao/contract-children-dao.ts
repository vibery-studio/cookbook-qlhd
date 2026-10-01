/**
 * Child documents DAO (SPEC-09 FR-4..FR-8, §3.6 "Tạo con = một db.batch"; PLAN-09 §2b CAS). Pure `(db, input)` functions.
 *
 * Create = ONE `db.batch`: `INSERT … SELECT … WHERE EXISTS (parent issued [+ BG in date])` then the audit
 * `INSERT … SELECT … WHERE changes() = 1`. The live-child partial UNIQUE (`uq_contracts_parent_child_live`) is the race
 * guard for "one live child per (parent, type)" — a violation aborts the whole batch and is reported as `child-exists`.
 * Reads here are diagnostics only (the guard is the CAS), used to pick the 404/409 after a lost CAS.
 */
import { and, asc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, contracts, templates } from "../db/schema";
import { LIVE_STATUSES, type DocType } from "../domain/contract/doc-types";
import { generateUlid } from "../utils/id";
import { isUniqueViolation } from "./customer-dao";

export interface ChildParentDto {
  id: string;
  type: DocType;
  status: string;
  number: string | null;
  docDate: string;
  validUntil: string | null;
  customerId: string;
  /** the parent's stored snapshot (JSON-decoded) */
  snapshot: Record<string, unknown>;
}

export interface TemplateHeadDto {
  id: string;
  type: string;
  active: boolean;
}

export interface ChildInsertRow {
  id: string;
  type: DocType;
  parentId: string;
  parentType: DocType;
  templateId: string;
  templateVersionId: string;
  customerId: string;
  createdBy: string;
  docDate: string;
  snapshot: string;
  snapshotHash: string;
  customerName: string;
  total: number;
  now: number;
}

export type CreateChildCasResult = { kind: "ok" } | { kind: "lost" } | { kind: "child-exists"; existingId: string | null };

/** The parent as the child service needs it, or null. */
export async function getChildParent(db: Db, id: string): Promise<ChildParentDto | null> {
  const [row] = await db
    .select({
      id: contracts.id,
      type: contracts.type,
      status: contracts.status,
      number: contracts.number,
      docDate: contracts.docDate,
      validUntil: contracts.validUntil,
      customerId: contracts.customerId,
      snapshot: contracts.snapshot,
    })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  if (row === undefined) return null;
  return { ...row, type: row.type as DocType, snapshot: JSON.parse(row.snapshot) as Record<string, unknown> };
}

/** A template's head (type + active), or null. */
export async function getTemplateHead(db: Db, id: string): Promise<TemplateHeadDto | null> {
  const [row] = await db
    .select({ id: templates.id, type: templates.type, active: templates.active })
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);
  return row === undefined ? null : { id: row.id, type: row.type, active: row.active === 1 };
}

/** P-5: the seed template of a type = the oldest active one (`created_at`, then smallest `id`). */
export async function seedTemplateIdOf(db: Db, type: DocType): Promise<string | null> {
  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.type, type), eq(templates.active, 1)))
    .orderBy(asc(templates.createdAt), asc(templates.id))
    .limit(1);
  return row?.id ?? null;
}

/** The live child of (parent, type) — at most one by `uq_contracts_parent_child_live`. */
export async function liveChildId(db: Db, parentId: string, type: DocType): Promise<string | null> {
  const [row] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.parentId, parentId), eq(contracts.type, type), inArray(contracts.status, [...LIVE_STATUSES])))
    .limit(1);
  return row?.id ?? null;
}

/**
 * One batch: the draft child inserted only while its parent is issued (and, for a BG, `valid_until >= today` — VN day from
 * the JS clock, P-6; NULL never passes), then its `contract.created` audit row guarded by `changes() = 1`.
 * `lost` = the parent CAS matched nothing (caller re-reads to diagnose); `child-exists` = the live-child UNIQUE fired.
 */
export async function createChildCas(
  db: Db,
  input: {
    row: ChildInsertRow;
    today: string;
    audit: { actor: string; ip: string | null; ts: number; metadata: Record<string, unknown> };
  },
): Promise<CreateChildCasResult> {
  const r = input.row;
  const auditId = generateUlid();
  const metadata = JSON.stringify(input.audit.metadata);
  try {
    // drizzle's INSERT … SELECT names every column in schema order (and checks the keys) — derive the order from the table.
    const values: Record<string, unknown> = {
      id: r.id,
      type: r.type,
      templateId: r.templateId,
      templateVersionId: r.templateVersionId,
      customerId: r.customerId,
      parentId: r.parentId,
      status: "draft",
      createdBy: r.createdBy,
      docDate: r.docDate,
      snapshot: r.snapshot,
      snapshotHash: r.snapshotHash,
      customerName: r.customerName,
      total: r.total,
      version: 1,
      createdAt: r.now,
      updatedAt: r.now,
    };
    const fields = Object.fromEntries(
      Object.keys(getTableColumns(contracts)).map((k) => [k, sql`${values[k] ?? null}`.as(k)]),
    ) as Record<keyof typeof contracts.$inferSelect, SQL.Aliased>;
    const [inserted] = await db.batch([
      // CAS: selecting the constants FROM the parent row = WHERE EXISTS (parent issued [+ BG in date]); 0 or 1 row
      db.insert(contracts).select(
        db
          .select(fields)
          .from(contracts)
          .where(
            and(
              eq(contracts.id, r.parentId),
              eq(contracts.type, r.parentType),
              eq(contracts.status, "issued"),
              sql`(${contracts.type} <> 'quote' OR ${contracts.validUntil} >= ${input.today})`,
            ),
          )
          .limit(1),
      ),
      // `changes()` = rows of the INSERT above; a lost CAS writes no audit row
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${auditId}`.as("id"),
            ts: sql<number>`${input.audit.ts}`.as("ts"),
            actor: sql<string>`${input.audit.actor}`.as("actor"),
            action: sql<string>`${"contract.created"}`.as("action"),
            target: sql<string>`${`contract:${r.id}`}`.as("target"),
            metadata: sql<string>`${metadata}`.as("metadata"),
            ip: sql<string | null>`${input.audit.ip}`.as("ip"),
          })
          .from(contracts)
          .where(and(eq(contracts.id, r.id), sql`changes() = 1`)),
      ),
    ]);
    return inserted.meta.changes === 1 ? { kind: "ok" } : { kind: "lost" };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // null only if the rival draft was deleted between the abort and this read
    return { kind: "child-exists", existingId: await liveChildId(db, r.parentId, r.type) };
  }
}
