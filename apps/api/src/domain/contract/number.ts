import type { DocType } from "./doc-types";

/** One gap-free number series per document type (SPEC-09 FR-2, PLAN-09 §2b): `{PREFIX}-{YYYY}-{NNN}`. */
export const SERIES = {
  contract: { prefix: "HD", pad: 3 },
  quote: { prefix: "BG", pad: 3 },
  payment_request: { prefix: "DNTT", pad: 3 },
  delivery_note: { prefix: "PXK", pad: 3 },
} as const satisfies Record<DocType, { prefix: string; pad: number }>;

export function formatNumber(prefix: string, year: number, seq: number, pad: number): string {
  if (prefix.length === 0 || !Number.isSafeInteger(year) || !Number.isSafeInteger(seq) || seq < 0) {
    throw new RangeError("invalid number series arguments");
  }
  if (!Number.isSafeInteger(pad) || pad < 1) throw new RangeError("pad must be a positive integer");
  return `${prefix}-${year}-${String(seq).padStart(pad, "0")}`;
}

/** printf format equal to `formatNumber(SERIES[type].prefix, year, seq, SERIES[type].pad)` (no truncation past the pad). */
export function numberPrintfFormat(type: DocType): string {
  const s = SERIES[type];
  return `${s.prefix}-%d-%0${s.pad}d`;
}
