/**
 * SPEC-10 FR-4 / DEC-5 — suggest a field definition per placeholder from data that already exists. Pure.
 * Order: the target template's current version → another template's current version (newest first wins) → a manual
 * default `{label: first original, type: text, required: true, source: manual}`. P-8: `bang_hang` is always forced to
 * `{type: lines, source: derived:lines_table, required: true}` (label kept from the suggestion when there is one).
 */
import { LINES_TABLE_SOURCE } from "../template-sources";
import { LINES_FIELD_KEY, LINES_FIELD_LABEL } from "./defaults";

export interface SuggestField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  source: string;
  options?: string[];
  default?: string | number;
}

export interface VersionFields {
  fields: SuggestField[];
}

export interface SuggestPlaceholder {
  key: string;
  originals: string[];
}

export type SuggestionFrom = "current_version" | "other_template" | "none";

export interface Suggestion {
  key: string;
  suggested: SuggestField;
  suggestion_from: SuggestionFrom;
}

const LABEL_MAX = 200;

function manualDefault(p: SuggestPlaceholder): SuggestField {
  const label = (p.originals[0] ?? p.key).trim().slice(0, LABEL_MAX) || p.key;
  return { key: p.key, label, type: "text", required: true, source: "manual" };
}

export function suggestFields(
  placeholders: SuggestPlaceholder[],
  target: VersionFields | null,
  others: VersionFields[] /* newest first */,
): Suggestion[] {
  const fromTarget = new Map((target?.fields ?? []).map((f) => [f.key, f]));
  const fromOthers = new Map<string, SuggestField>();
  for (const v of others) for (const f of v.fields) if (!fromOthers.has(f.key)) fromOthers.set(f.key, f);

  return placeholders.map((p) => {
    let suggested: SuggestField;
    let from: SuggestionFrom;
    const t = fromTarget.get(p.key);
    const o = fromOthers.get(p.key);
    if (t) {
      suggested = t;
      from = "current_version";
    } else if (o) {
      suggested = o;
      from = "other_template";
    } else {
      suggested = manualDefault(p);
      from = "none";
    }
    if (p.key === LINES_FIELD_KEY) {
      const label = from === "none" ? LINES_FIELD_LABEL : suggested.label;
      suggested = { key: LINES_FIELD_KEY, label, type: "lines", required: true, source: LINES_TABLE_SOURCE };
    }
    return { key: p.key, suggested, suggestion_from: from };
  });
}
