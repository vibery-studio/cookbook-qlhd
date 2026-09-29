/**
 * Template DTO types + row -> DTO mappers (SPEC-02 §3.3, §3.4, §3.8). Pure; no queries live here.
 * JSON columns are stored as TEXT and parsed on the way out.
 */
import type { z } from "zod";
import type {
  ApprovalPolicySchema,
  FieldRuleSchema,
  TemplateFieldSchema,
} from "../dto/templates";
import type { templates, templateVersions } from "../db/schema";

export type TemplateField = z.infer<typeof TemplateFieldSchema>;
export type FieldRule = z.infer<typeof FieldRuleSchema>;
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export type OpaqueItem = Record<string, unknown>;

export type TemplateRow = typeof templates.$inferSelect;
export type TemplateVersionRow = typeof templateVersions.$inferSelect;

export interface TemplateVersionDto {
  id: string;
  version_no: number;
  body: string;
  fields: TemplateField[];
  field_rules: FieldRule[];
  default_line_items: OpaqueItem[];
  default_clauses: OpaqueItem[];
  approval_policy: ApprovalPolicy;
  note: string | null;
  created_at: number;
  created_by_name: string | null;
}

export interface TemplateVersionRefDto {
  id: string;
  version_no: number;
  created_at: number;
  created_by_name: string | null;
  note: string | null;
}

export interface TemplateDetailDto {
  id: string;
  type: string;
  name: string;
  subject_type: string;
  active: boolean;
  version: TemplateVersionDto;
  versions: TemplateVersionRefDto[];
}

export interface TemplateListItemDto {
  id: string;
  type: string;
  name: string;
  active: boolean;
  current_version: {
    id: string;
    version_no: number;
    created_at: number;
    created_by_name: string | null;
  };
  required_fields: string[];
  steps_summary: string[];
}

/** `created_by_name` = the creator's `display_name` (null for a seeded/system version). */
export function toVersionDto(r: TemplateVersionRow, createdByName: string | null): TemplateVersionDto {
  return {
    id: r.id,
    version_no: r.versionNo,
    body: r.body,
    fields: JSON.parse(r.fields) as TemplateField[],
    field_rules: JSON.parse(r.fieldRules) as FieldRule[],
    default_line_items: JSON.parse(r.defaultLineItems) as OpaqueItem[],
    default_clauses: JSON.parse(r.defaultClauses) as OpaqueItem[],
    approval_policy: JSON.parse(r.approvalPolicy) as ApprovalPolicy,
    note: r.note,
    created_at: r.createdAt,
    created_by_name: createdByName,
  };
}

export function toVersionRefDto(r: TemplateVersionRow, createdByName: string | null): TemplateVersionRefDto {
  return {
    id: r.id,
    version_no: r.versionNo,
    created_at: r.createdAt,
    created_by_name: createdByName,
    note: r.note,
  };
}

export function toDetailDto(
  t: TemplateRow,
  version: TemplateVersionDto,
  versions: TemplateVersionRefDto[],
): TemplateDetailDto {
  return {
    id: t.id,
    type: t.type,
    name: t.name,
    subject_type: t.subjectType,
    active: t.active === 1,
    version,
    versions,
  };
}

/** Fixed policy steps first, then the labels of steps that rules may add (order of appearance). */
export function stepsSummary(policy: ApprovalPolicy): string[] {
  const labels = (policy.steps ?? []).map((s) => s.label);
  for (const rule of policy.rules ?? []) for (const s of rule.add_steps) labels.push(s.label);
  return labels;
}

export function toListItemDto(
  t: TemplateRow,
  v: TemplateVersionRow,
  createdByName: string | null,
): TemplateListItemDto {
  const fields = JSON.parse(v.fields) as TemplateField[];
  return {
    id: t.id,
    type: t.type,
    name: t.name,
    active: t.active === 1,
    current_version: {
      id: v.id,
      version_no: v.versionNo,
      created_at: v.createdAt,
      created_by_name: createdByName,
    },
    required_fields: fields.filter((f) => f.required).map((f) => f.key),
    steps_summary: stepsSummary(JSON.parse(v.approvalPolicy) as ApprovalPolicy),
  };
}
