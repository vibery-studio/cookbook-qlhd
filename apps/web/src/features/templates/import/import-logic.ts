import type { components } from "@runway/client";

export type ImportPreview = components["schemas"]["TemplateImportPreview"];
type Placeholder = components["schemas"]["TemplateImportPlaceholder"];
export type TemplateField = components["schemas"]["TemplateField"];
export type FieldType = TemplateField["type"];
type CreateRequest = components["schemas"]["CreateTemplateRequest"];
type VersionRequest = components["schemas"]["CreateTemplateVersionRequest"];

export type FieldRow = {
  key: string;
  count: number;
  label: string;
  type: FieldType;
  required: boolean;
  source: string;
  /** "Lựa chọn" input: comma-separated, only used when type = choice. */
  optionsText: string;
  default?: string | number;
  from: Placeholder["suggestion_from"];
  /** The user changed something on this row — it survives a re-read of the file. */
  touched: boolean;
};

export type RowError = { key?: string; path?: string; message: string };

/** "Bao_Gia.docx" → "Bao Gia". */
export function templateNameFromFile(fileName: string): string {
  return fileName.replace(/\.docx$/i, "").replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

export const importNote = (fileName: string): string => `Nhập từ ${fileName}`;

export function rowsFromPreview(preview: ImportPreview): FieldRow[] {
  return preview.placeholders.map((p) => ({
    key: p.key,
    count: p.count,
    label: p.suggested.label,
    type: p.suggested.type,
    required: p.suggested.required,
    source: p.suggested.source,
    optionsText: (p.suggested.options ?? []).join(", "),
    ...(p.suggested.default !== undefined ? { default: p.suggested.default } : {}),
    from: p.suggestion_from,
    touched: false,
  }));
}

export function touchRow(rows: readonly FieldRow[], key: string, patch: Partial<Pick<FieldRow, "label" | "type" | "required" | "source" | "optionsText">>): FieldRow[] {
  return rows.map((r) => (r.key === key ? { ...r, ...patch, touched: true } : r));
}

/** Fresh server suggestions, but what the user already typed (by key) wins; keys gone from the file are dropped. */
export function mergeRows(prev: readonly FieldRow[], preview: ImportPreview): FieldRow[] {
  const edited = new Map(prev.filter((r) => r.touched).map((r) => [r.key, r]));
  return rowsFromPreview(preview).map((fresh) => {
    const mine = edited.get(fresh.key);
    return mine ? { ...fresh, label: mine.label, type: mine.type, required: mine.required, source: mine.source, optionsText: mine.optionsText, touched: true } : fresh;
  });
}

export function buildFields(rows: readonly FieldRow[]): TemplateField[] {
  return rows.map((r) => {
    const options = r.type === "choice" ? r.optionsText.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
    return {
      key: r.key,
      label: r.label,
      type: r.type,
      required: r.required,
      source: r.source,
      ...(options ? { options } : {}),
      ...(r.default !== undefined ? { default: r.default } : {}),
    };
  });
}

type SaveInput = { fileName: string; preview: ImportPreview; rows: readonly FieldRow[] };

function versionPart({ fileName, preview, rows }: SaveInput) {
  return {
    body: preview.body,
    fields: buildFields(rows),
    field_rules: preview.base.field_rules,
    default_line_items: preview.base.default_line_items,
    default_clauses: preview.base.default_clauses,
    approval_policy: preview.base.approval_policy,
    note: importNote(fileName),
  };
}

export function createBody(input: SaveInput & { type: CreateRequest["type"]; name: string }): CreateRequest {
  return { type: input.type, name: input.name.trim(), subject_type: "customer", version: versionPart(input) };
}

export function versionBody(input: SaveInput): VersionRequest {
  const base = input.preview.base.version_no;
  if (base === null) throw new Error("preview has no base version (read the file against a template first)");
  return { expected_version_no: base, ...versionPart(input) };
}

export function badgesFor(row: Pick<FieldRow, "from" | "source" | "type">): string[] {
  const badges = [row.from === "current_version" ? "gợi ý từ: phiên bản hiện tại" : row.from === "other_template" ? "gợi ý từ: mẫu khác" : "mới"];
  if (row.source === "manual") {
    badges.push("Người lập nhập tay");
    if (row.type === "money") badges.push("Tiền nhập tay");
  }
  return badges;
}

/** check_errors (preview) and 422 `errors[]` (save) share the shape: `key` ties one to a field row. */
export function errorsByRow(errors: readonly RowError[]): { byKey: Record<string, string[]>; general: string[] } {
  const byKey: Record<string, string[]> = {};
  const general: string[] = [];
  for (const e of errors) {
    if (e.key) (byKey[e.key] ??= []).push(e.message);
    else general.push(e.message);
  }
  return { byKey, general };
}

/** The preview's check ran on the suggestions: once the user edits a row, its old errors are stale (save re-checks on the server). */
export function unresolvedErrors<T extends RowError>(errors: readonly T[], touchedKeys: ReadonlySet<string>): T[] {
  return errors.filter((e) => !(e.key && touchedKeys.has(e.key)));
}

/** `body` is escaped by the server, so a string replace is safe — never parse it as HTML on the client. */
export function highlightPlaceholders(body: string): string {
  return body.replace(/\{\{[\s\S]*?\}\}/g, (m) => `<mark>${m}</mark>`);
}

const PREVIEW_STYLE =
  "<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:4px 6px}mark{background:#ffe9a8;border-radius:3px;padding:0 2px}</style>";

export function previewDocument(body: string): string {
  return PREVIEW_STYLE + highlightPlaceholders(body);
}
