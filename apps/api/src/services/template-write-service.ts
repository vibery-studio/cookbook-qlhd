/** Template write orchestration (SPEC-02 §3.8). Never sees Hono `c`. Order: check → CAS/write; nothing is written on `check_failed`. */
import { getTemplateDetail } from "../dao/template-dao";
import type { TemplateDetailDto } from "../dao/template-types";
import {
  insertNextVersionCas,
  insertTemplateWithV1,
  type TemplateVersionContent,
} from "../dao/template-write-dao";
import type { Db } from "../db/client";
import { checkTemplate, type FieldDef, type TemplateCheckError } from "../domain/template-check";

export interface CheckFailedItem {
  path: string;
  code: string;
  key?: string;
  source?: string;
  message: string;
}

export type WriteOutcome =
  | { kind: "ok"; template: TemplateDetailDto }
  | { kind: "check_failed"; errors: CheckFailedItem[] }
  | { kind: "stale" }
  | { kind: "not_found" }
  | { kind: "duplicate"; existingId: string | null };

function pathOf(e: TemplateCheckError): string {
  if (e.key !== undefined) return `fields.${e.key}`;
  if (e.code === "policy_invalid") return "approval_policy";
  if (e.code === "all_or_none_invalid") return "field_rules";
  return "body";
}

function runCheck(c: TemplateVersionContent): CheckFailedItem[] {
  return checkTemplate({
    body: c.body,
    fields: c.fields as FieldDef[],
    field_rules: c.field_rules as Array<{ all_or_none: string[] }>,
    approval_policy: c.approval_policy,
  }).map((e) => ({
    path: pathOf(e),
    code: e.code,
    ...(e.key !== undefined && { key: e.key }),
    ...(e.source !== undefined && { source: e.source }),
    message: e.message,
  }));
}

async function detailOrThrow(db: Db, id: string, versionNo: number): Promise<TemplateDetailDto> {
  const t = await getTemplateDetail(db, id, versionNo);
  if (t === null) throw new Error("template written but not readable");
  return t;
}

export async function createTemplate(
  db: Db,
  actor: { id: string; ip: string | null },
  input: { name: string; type: string; subject_type: string; version: TemplateVersionContent },
): Promise<Exclude<WriteOutcome, { kind: "not_found" }>> {
  const errors = runCheck(input.version);
  if (errors.length > 0) return { kind: "check_failed", errors };
  const name = input.name.trim();
  const res = await insertTemplateWithV1(db, {
    name,
    nameNorm: name.toLowerCase(),
    type: input.type,
    subjectType: input.subject_type,
    content: input.version,
    actor: actor.id,
    ip: actor.ip,
  });
  if (res.kind === "duplicate") return res;
  return { kind: "ok", template: await detailOrThrow(db, res.id, res.versionNo) };
}

export async function addTemplateVersion(
  db: Db,
  actor: { id: string; ip: string | null },
  templateId: string,
  input: TemplateVersionContent & { expected_version_no: number },
): Promise<WriteOutcome> {
  const errors = runCheck(input);
  if (errors.length > 0) return { kind: "check_failed", errors };
  const res = await insertNextVersionCas(db, {
    templateId,
    expectedVersionNo: input.expected_version_no,
    content: input,
    actor: actor.id,
    ip: actor.ip,
  });
  if (res.kind !== "ok") return res;
  return { kind: "ok", template: await detailOrThrow(db, templateId, res.versionNo) };
}
