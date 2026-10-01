/**
 * Read-only DAO for the Word import preview (SPEC-10 FR-4, FR-10; PLAN-10 §2b). Pure `(db) → DTO`. New file on purpose:
 * `template-dao.ts` is shared with row 4 (PLAN-10 R-1). `type` is never constrained here (R-2).
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { templates, templateVersions } from "../db/schema";
import type { ApprovalPolicy, FieldRule, OpaqueItem, TemplateField, TemplateVersionRow } from "./template-types";

export interface SuggestVersionDto {
  template_id: string;
  created_at: number;
  version_no: number;
  fields: TemplateField[];
  field_rules: FieldRule[];
  approval_policy: ApprovalPolicy;
  default_line_items: OpaqueItem[];
  default_clauses: OpaqueItem[];
}

export function toSuggestVersionDto(v: TemplateVersionRow): SuggestVersionDto {
  return {
    template_id: v.templateId,
    created_at: v.createdAt,
    version_no: v.versionNo,
    fields: JSON.parse(v.fields) as TemplateField[],
    field_rules: JSON.parse(v.fieldRules) as FieldRule[],
    approval_policy: JSON.parse(v.approvalPolicy) as ApprovalPolicy,
    default_line_items: JSON.parse(v.defaultLineItems) as OpaqueItem[],
    default_clauses: JSON.parse(v.defaultClauses) as OpaqueItem[],
  };
}

/** Current version of every active template, newest first (DEC-5: the newest template wins a key). One JOIN. */
export async function currentVersionsForSuggest(db: Db): Promise<SuggestVersionDto[]> {
  const rows = await db
    .select({ v: templateVersions })
    .from(templates)
    .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
    .where(eq(templates.active, 1))
    .orderBy(desc(templateVersions.createdAt), desc(templateVersions.id));
  return rows.map((r) => toSuggestVersionDto(r.v));
}
