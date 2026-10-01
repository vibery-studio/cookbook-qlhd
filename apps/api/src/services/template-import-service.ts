/**
 * SPEC-10 FR-1 — stateless preview of a Word (.docx) template import. Never sees Hono `c`; writes nothing; never logs
 * the file's content (PLAN-10 R-8). Saving goes through the existing POST /templates · /templates/{id}/versions.
 */
import { getCurrentVersion } from "../dao/template-dao";
import { currentVersionsForSuggest, toSuggestVersionDto, type SuggestVersionDto } from "../dao/template-suggest-dao";
import type { ApprovalPolicy, FieldRule, OpaqueItem, TemplateField } from "../dao/template-types";
import type { Db } from "../db/client";
import { convertDocx, type DocxErrorReason } from "../domain/docx";
import { checkTemplate, type FieldDef, type TemplateCheckError } from "../domain/template-check";
import { BOX_APPROVAL_POLICY } from "../domain/template-import/defaults";
import { suggestFields, type SuggestionFrom } from "../domain/template-import/suggest";
import { SOURCE_REGISTRY } from "../domain/template-sources";
import type { CheckFailedItem } from "./template-write-service";

export interface ImportPreviewInput {
  bytes: Uint8Array;
  templateId?: string;
  linesTable?: number;
}

export interface ImportPreviewDto {
  body: string;
  placeholders: Array<{
    key: string;
    original: string;
    count: number;
    table_index: number | null;
    suggested: TemplateField;
    suggestion_from: SuggestionFrom;
  }>;
  tables: Array<{ index: number; rows: number; cols: number; placeholder_keys: string[] }>;
  removed: Array<{ kind: "internal_note"; text: string }>;
  warnings: Array<{ code: string; message: string; count: number }>;
  sources: string[];
  base: {
    template_id: string | null;
    version_no: number | null;
    approval_policy: ApprovalPolicy;
    field_rules: FieldRule[];
    default_line_items: OpaqueItem[];
    default_clauses: OpaqueItem[];
  };
  check_errors: CheckFailedItem[];
  stats: { body_bytes: number; fields: number };
}

export type ImportPreviewOutcome =
  | { kind: "ok"; preview: ImportPreviewDto }
  | { kind: "not_found" }
  | { kind: "docx_invalid"; reason: DocxErrorReason }
  | { kind: "invalid"; errors: Array<{ path: string; message: string }> };

const FIELD_RULE_DROPPED = "Ràng buộc điền-cùng-nhau đã bỏ vì file không còn đủ các trường của nó.";

function pathOf(e: TemplateCheckError): string {
  if (e.key !== undefined) return `fields.${e.key}`;
  if (e.code === "policy_invalid") return "approval_policy";
  if (e.code === "all_or_none_invalid") return "field_rules";
  return "body";
}

function allSources(): string[] {
  const out = ["manual"];
  for (const [kind, refs] of Object.entries(SOURCE_REGISTRY)) for (const ref of refs) out.push(`${kind}:${ref}`);
  return out.sort();
}

export async function previewImport(deps: { db: Db }, input: ImportPreviewInput): Promise<ImportPreviewOutcome> {
  const { db } = deps;

  // (1) target template
  let target: SuggestVersionDto | null = null;
  if (input.templateId !== undefined) {
    const row = await getCurrentVersion(db, input.templateId);
    if (row === null) return { kind: "not_found" };
    target = toSuggestVersionDto(row);
  }

  // (2)+(3) convert; the replaced line table is not listed in `tables[]` (C-10-002), so lines_table is validated on the
  // plain conversion (must name a table that has fields) before converting again with it.
  const plain = convertDocx(input.bytes);
  if ("error" in plain) return { kind: "docx_invalid", reason: plain.error };
  let conv = plain;
  if (input.linesTable !== undefined) {
    if (!plain.tables.some((t) => t.index === input.linesTable)) {
      return {
        kind: "invalid",
        errors: [{ path: "lines_table", message: "Không có bảng nào chứa trường ở vị trí này." }],
      };
    }
    const withLines = convertDocx(input.bytes, { linesTable: input.linesTable });
    if ("error" in withLines) return { kind: "docx_invalid", reason: withLines.error };
    conv = withLines;
  }

  // (4) suggestions: target first, then every other active template's current version, newest first
  const others = (await currentVersionsForSuggest(db)).filter((v) => v.template_id !== input.templateId);
  const suggestions = suggestFields(conv.placeholders, target, others);
  const suggested = suggestions.map((s) => s.suggested);

  // (5) base
  const keys = new Set(conv.placeholders.map((p) => p.key));
  const warnings: ImportPreviewDto["warnings"] = conv.warnings.map((w) => ({ ...w }));
  let base: ImportPreviewDto["base"];
  if (target !== null) {
    const kept = target.field_rules.filter((r) => r.all_or_none.every((k) => keys.has(k)));
    const dropped = target.field_rules.length - kept.length;
    if (dropped > 0) warnings.push({ code: "field_rule_dropped", message: FIELD_RULE_DROPPED, count: dropped });
    base = {
      template_id: input.templateId ?? null,
      version_no: target.version_no,
      approval_policy: target.approval_policy,
      field_rules: kept,
      default_line_items: target.default_line_items,
      default_clauses: target.default_clauses,
    };
  } else {
    base = {
      template_id: null,
      version_no: null,
      approval_policy: structuredClone(BOX_APPROVAL_POLICY) as unknown as ApprovalPolicy,
      field_rules: [],
      default_line_items: [],
      default_clauses: [],
    };
  }

  // (6) the same check the save will run
  const check_errors: CheckFailedItem[] = checkTemplate({
    body: conv.body,
    fields: suggested as FieldDef[],
    field_rules: base.field_rules,
    approval_policy: base.approval_policy,
  }).map((e) => ({
    path: pathOf(e),
    code: e.code,
    ...(e.key !== undefined && { key: e.key }),
    ...(e.source !== undefined && { source: e.source }),
    message: e.message,
  }));

  // (7)+(8)
  const placeholders = conv.placeholders.map((p, i) => ({
    key: p.key,
    original: p.originals.join(", "),
    count: p.count,
    table_index: p.table_index,
    // suggestions are copied from stored TemplateFields or built with a valid FIELD_TYPES member
    suggested: suggestions[i]!.suggested as TemplateField,
    suggestion_from: suggestions[i]!.suggestion_from,
  }));

  return {
    kind: "ok",
    preview: {
      body: conv.body,
      placeholders,
      tables: conv.tables,
      removed: conv.removed,
      warnings,
      sources: allSources(),
      base,
      check_errors,
      stats: { body_bytes: new TextEncoder().encode(conv.body).length, fields: placeholders.length },
    },
  };
}
