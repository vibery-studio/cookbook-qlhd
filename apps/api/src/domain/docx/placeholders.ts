/**
 * SPEC-10 §3.2 step 5–6 — placeholders read on the JOINED text of a paragraph / cell (FR-2: split runs, proofErr,
 * formatting changes mid-name), normalised by DEC-3, written back as a plain `{{key}}` outside any <strong>/<em>.
 * Internal-note detection reuses template-check's `fold` + phrases (R-3: one rule, not a copy).
 */
import { fold, INTERNAL_NOTE_PHRASES } from "../template-check";

/** A run of text with its formatting; `br` = a line break (no text). */
export interface Piece {
  text: string;
  b: boolean;
  i: boolean;
  br?: true;
}

export interface Ref {
  key: string;
  original: string;
  table: number | null;
}

export interface Placeholder {
  key: string;
  originals: string[];
  count: number;
  table_index: number | null;
}

/** DEC-3: trim, fold (marks, đ), lowercase, non [a-z0-9] runs → "_", trim "_"; null when empty or starting with a digit. */
export function slugKey(original: string): string | null {
  const s = fold(original.trim())
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s === "" || /^[0-9]/.test(s)) return null;
  return s;
}

const PH_RE = /\{\{([\s\S]*?)\}\}/g;

/** The `{{…}}` written back for one match, or null = keep the original text (checkTemplate will report it). */
function normalise(inner: string, ref: (key: string, original: string) => void): string | null {
  const t = inner.trim();
  if (t === "/if") return "{{/if}}";
  if (/[{}]/.test(t)) return null;
  const ifm = /^#if\s+([\s\S]+)$/.exec(t);
  if (ifm) {
    const original = ifm[1]!.trim();
    const key = slugKey(original);
    if (!key) return null;
    ref(key, original);
    return `{{#if ${key}}}`;
  }
  if (t.startsWith("#")) return null;
  const key = slugKey(t);
  if (!key) return null;
  ref(key, t);
  return `{{${key}}}`;
}

/** Rewrites placeholders across piece boundaries; the replacement piece carries no formatting. */
export function rewritePlaceholders(pieces: Piece[], ref: (key: string, original: string) => void): Piece[] {
  const joined = pieces.map((p) => p.text).join("");
  if (!joined.includes("{{")) return pieces;
  const matches: Array<{ start: number; end: number; text: string }> = [];
  for (const m of joined.matchAll(PH_RE)) {
    const start = m.index;
    matches.push({ start, end: start + m[0].length, text: normalise(m[1]!, ref) ?? m[0] });
  }
  if (matches.length === 0) return pieces;

  const out: Piece[] = [];
  let mi = 0;
  let pos = 0;
  for (const p of pieces) {
    while (mi < matches.length && matches[mi]!.end <= pos) mi++;
    if (p.br) {
      const m = matches[mi];
      if (!(m && m.start < pos && pos < m.end)) out.push(p);
      continue;
    }
    const len = p.text.length;
    let s = 0;
    while (s < len) {
      const abs = pos + s;
      while (mi < matches.length && matches[mi]!.end <= abs) mi++;
      const m = matches[mi];
      if (!m || m.start >= pos + len) {
        out.push({ text: p.text.slice(s), b: p.b, i: p.i });
        break;
      }
      if (m.start > abs) {
        out.push({ text: p.text.slice(s, m.start - pos), b: p.b, i: p.i });
        s = m.start - pos;
        continue;
      }
      if (abs === m.start) out.push({ text: m.text, b: false, i: false });
      s = Math.min(len, m.end - pos);
    }
    pos += len;
  }
  return out;
}

export function isInternalNote(text: string): boolean {
  const f = fold(text);
  return INTERNAL_NOTE_PHRASES.some((ph) => f.includes(ph));
}

/** Refs → placeholders (first-appearance order) + the rename/merge warning counts. */
export function aggregate(refs: Ref[]): { placeholders: Placeholder[]; renamed: number; merged: number } {
  const byKey = new Map<string, { originals: string[]; count: number; tables: Set<number | null> }>();
  const renamedOriginals = new Set<string>();
  for (const r of refs) {
    let e = byKey.get(r.key);
    if (!e) byKey.set(r.key, (e = { originals: [], count: 0, tables: new Set() }));
    e.count++;
    e.tables.add(r.table);
    if (!e.originals.includes(r.original)) e.originals.push(r.original);
    if (r.original !== r.key) renamedOriginals.add(r.original);
  }
  const placeholders: Placeholder[] = [];
  let merged = 0;
  for (const [key, e] of byKey) {
    if (e.originals.length > 1) merged++;
    const only = e.tables.size === 1 ? [...e.tables][0]! : null;
    placeholders.push({ key, originals: e.originals, count: e.count, table_index: only });
  }
  return { placeholders, renamed: renamedOriginals.size, merged };
}
