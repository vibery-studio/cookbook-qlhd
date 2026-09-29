/**
 * Templates write DAO (SPEC-02 §3.8, FR-1/5/7). Pure `(db, input)`. There is deliberately NO update/delete:
 * a version is only ever INSERTed (the DB trigger refuses anything else). Each success is ONE `db.batch`
 * (atomic in D1) carrying the change and its audit row.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, templates, templateVersions } from "../db/schema";
import { generateUlid } from "../utils/id";
import { auditInsert } from "./audit-dao";
import { isUniqueViolation } from "./customer-dao";

/** Version content, already validated by Zod and by checkTemplate. JSON columns are stored as TEXT. */
export interface TemplateVersionContent {
  body: string;
  fields: unknown[];
  field_rules: unknown[];
  default_line_items: unknown[];
  default_clauses: unknown[];
  approval_policy: unknown;
  note?: string | null;
}

function versionValues(c: TemplateVersionContent) {
  return {
    body: c.body,
    fields: JSON.stringify(c.fields),
    fieldRules: JSON.stringify(c.field_rules),
    defaultLineItems: JSON.stringify(c.default_line_items),
    defaultClauses: JSON.stringify(c.default_clauses),
    approvalPolicy: JSON.stringify(c.approval_policy),
    note: c.note ?? null,
  };
}

export async function findTemplateIdByNameNorm(db: Db, nameNorm: string): Promise<string | null> {
  const [row] = await db.select({ id: templates.id }).from(templates).where(eq(templates.nameNorm, nameNorm)).limit(1);
  return row?.id ?? null;
}

/**
 * Template + version 1 + `template.created` audit row in one batch. `duplicate` = the `name_norm` UNIQUE index
 * refused it (nothing was written); `existingId` is the row that holds the name.
 */
export async function insertTemplateWithV1(
  db: Db,
  input: {
    name: string;
    nameNorm: string;
    type: string;
    subjectType: string;
    content: TemplateVersionContent;
    actor: string;
    ip?: string | null;
  },
): Promise<{ kind: "ok"; id: string; versionNo: 1 } | { kind: "duplicate"; existingId: string | null }> {
  const id = generateUlid();
  const versionId = generateUlid();
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.batch([
      db.insert(templates).values({
        id,
        type: input.type,
        name: input.name,
        nameNorm: input.nameNorm,
        subjectType: input.subjectType,
        currentVersionId: versionId,
        active: 1,
        createdBy: input.actor,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(templateVersions).values({
        id: versionId,
        templateId: id,
        versionNo: 1,
        ...versionValues(input.content),
        createdBy: input.actor,
        createdAt: now,
      }),
      auditInsert(db, {
        actor: input.actor,
        action: "template.created",
        target: `template:${id}`,
        metadata: { version_no: 1, fields: input.content.fields.length },
        ip: input.ip,
        ts: now,
      }),
    ]);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return { kind: "duplicate", existingId: await findTemplateIdByNameNorm(db, input.nameNorm) };
  }
  return { kind: "ok", id, versionNo: 1 };
}

/**
 * Append version `expectedVersionNo + 1` and move `current_version_id` to it — all guarded by "the current
 * version is still `expectedVersionNo`" — plus the `template.version_created` audit row, in one batch.
 *  - version INSERT … SELECT lands only when the template's current version_no = expected;
 *  - the pointer UPDATE lands only when it still points at the expected version and the new row exists;
 *  - the audit INSERT lands only when the UPDATE changed a row (`changes()`).
 * A concurrent winner makes the guard select empty (sequential loser) or trips UNIQUE(template_id, version_no)
 * (simultaneous loser, whole batch rolled back) — both are `stale`, never a 500. `not_found` = no such template.
 */
export async function insertNextVersionCas(
  db: Db,
  input: {
    templateId: string;
    expectedVersionNo: number;
    content: TemplateVersionContent;
    actor: string;
    ip?: string | null;
  },
): Promise<{ kind: "ok"; versionNo: number } | { kind: "stale" } | { kind: "not_found" }> {
  const newId = generateUlid();
  const auditId = generateUlid();
  const now = Math.floor(Date.now() / 1000);
  const versionNo = input.expectedVersionNo + 1;
  const v = versionValues(input.content);
  const tid = input.templateId;
  const auditMeta = JSON.stringify({ version_no: versionNo, fields: input.content.fields.length });
  const expectedVersionId = sql`(SELECT ${templateVersions.id} FROM ${templateVersions} WHERE ${templateVersions.templateId} = ${tid} AND ${templateVersions.versionNo} = ${input.expectedVersionNo})`;

  let moved: unknown[];
  try {
    const res = await db.batch([
      // drizzle's batch takes query builders only, hence INSERT … SELECT for the guarded inserts.
      db.insert(templateVersions).select(
        db
          .select({
            id: sql<string>`${newId}`.as("id"),
            templateId: sql<string>`${tid}`.as("templateId"),
            versionNo: sql<number>`${versionNo}`.as("versionNo"),
            body: sql<string>`${v.body}`.as("body"),
            fields: sql<string>`${v.fields}`.as("fields"),
            defaultLineItems: sql<string>`${v.defaultLineItems}`.as("defaultLineItems"),
            defaultClauses: sql<string>`${v.defaultClauses}`.as("defaultClauses"),
            approvalPolicy: sql<string>`${v.approvalPolicy}`.as("approvalPolicy"),
            fieldRules: sql<string>`${v.fieldRules}`.as("fieldRules"),
            note: sql<string | null>`${v.note}`.as("note"),
            createdBy: sql<string>`${input.actor}`.as("createdBy"),
            createdAt: sql<number>`${now}`.as("createdAt"),
          })
          .from(templates)
          .where(and(eq(templates.id, tid), sql`${templates.currentVersionId} = ${expectedVersionId}`)),
      ),
      db
        .update(templates)
        .set({ currentVersionId: newId, updatedAt: now })
        .where(
          and(
            eq(templates.id, tid),
            sql`${templates.currentVersionId} = ${expectedVersionId}`,
            sql`EXISTS (SELECT 1 FROM ${templateVersions} WHERE ${templateVersions.id} = ${newId})`,
          ),
        )
        .returning({ id: templates.id }),
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${auditId}`.as("id"),
            ts: sql<number>`${now}`.as("ts"),
            actor: sql<string>`${input.actor}`.as("actor"),
            action: sql<string>`${"template.version_created"}`.as("action"),
            target: sql<string>`${`template:${tid}`}`.as("target"),
            metadata: sql<string>`${auditMeta}`.as("metadata"),
            ip: sql<string | null>`${input.ip ?? null}`.as("ip"),
          })
          .from(templates)
          .where(and(eq(templates.id, tid), sql`changes() > 0`)),
      ),
    ]);
    moved = res[1];
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "stale" };
    throw err;
  }
  if (moved.length > 0) return { kind: "ok", versionNo };
  const [t] = await db.select({ id: templates.id }).from(templates).where(eq(templates.id, tid)).limit(1);
  return t === undefined ? { kind: "not_found" } : { kind: "stale" };
}
