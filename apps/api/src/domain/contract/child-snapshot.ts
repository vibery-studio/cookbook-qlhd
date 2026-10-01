import { CHILD_OF, type DocType } from "./doc-types";
import { priceLines } from "../money/line-pricing";
import { buildDocument, pricedInput, type BuildResult } from "./snapshot";
import type { CustomerInput, GoodsSnapshotLine, ParentRef, PricedLineInput, Snapshot, SnapshotLine, TemplateVersionInput } from "./types";

export type ChildBuildResult =
  | BuildResult
  /** the pair is not in CHILD_OF (BG→HĐ, HĐ→DNTT only) */
  | { ok: false; kind: "child-type" }
  /** DEC-6: a child keeps its parent's lines + discount — `values.giam_gia` is refused */
  | { ok: false; kind: "lines-locked" }
  /** P-4: a 0đ HĐ has nothing to request */
  | { ok: false; kind: "nothing-to-pay" };

export interface ChildParentInput {
  id: string;
  type: DocType;
  /** the parent's issued number (a child is only made from an issued parent) */
  number: string | null;
  doc_date: string;
  /** the parent's stored (immutable) snapshot */
  snapshot: Snapshot;
}

function isPricedLine(l: SnapshotLine | GoodsSnapshotLine): l is SnapshotLine {
  const p = l as Partial<SnapshotLine>;
  return (
    typeof p.unit_price_ex_vat === "number" &&
    (p.vat_rate_bps === null || typeof p.vat_rate_bps === "number") &&
    typeof p.price_from === "string" &&
    typeof p.amount_ex_vat === "number"
  );
}

/** The parent's lines as frozen priced inputs. A parent of a child is always priced (BG, HĐ) — anything else is a bug. */
function frozenLines(parent: ChildParentInput): PricedLineInput[] {
  const lines: ReadonlyArray<SnapshotLine | GoodsSnapshotLine> = parent.snapshot.lines ?? [];
  if (lines.length === 0 || !lines.every(isPricedLine)) {
    throw new Error(`buildChildSnapshot: parent ${parent.id} snapshot has no priced lines`);
  }
  return lines.map(pricedInput);
}

/**
 * A child document from an issued parent (SPEC-09 §3.3, FR-5/6, DEC-6/7/8). Pure: never looks a price up again.
 * - HĐ ← BG: the BG's frozen lines (price, VAT rate, `price_from`) re-priced with the BG's discount via `priceLines` — must
 *   equal the BG total (else throw: a bug), then the HĐ rule DEC-10 (→ `validation` `lines`, DEC-7); `inputs.frozen_from`.
 * - DNTT ← HĐ: `lines`, `vat_groups`, every total, `discount_bps` copied verbatim; `amount_requested` = HĐ total;
 *   `dates.payment_due` = doc_date + 7; a 0đ HĐ → `nothing-to-pay`.
 * Order (P-10, domain part): child-type → lines-locked → nothing-to-pay → validation `lines` → missing-fields.
 */
export function buildChildSnapshot(i: {
  parent: ChildParentInput;
  childType: DocType;
  version: TemplateVersionInput;
  customer: CustomerInput;
  values: Record<string, unknown>;
  docDate: string;
  /** `creator:name` — the child's creator */
  creatorName?: string;
  /** default: `ngay_bat_dau` was supplied in `values` */
  manualStart?: boolean;
}): ChildBuildResult {
  const { parent, childType } = i;
  if (!CHILD_OF[parent.type]?.includes(childType)) return { ok: false, kind: "child-type" };
  if (i.values.giam_gia !== undefined || i.values.lines !== undefined) return { ok: false, kind: "lines-locked" };

  const ref: ParentRef = { id: parent.id, type: parent.type, number: parent.number, doc_date: parent.doc_date, total: parent.snapshot.total };
  const supplied = i.values.ngay_bat_dau;
  const common = {
    type: childType,
    version: i.version,
    customer: i.customer,
    values: i.values,
    docDate: i.docDate,
    manualStart: i.manualStart ?? (typeof supplied === "string" && supplied.trim() !== ""),
    ...(i.creatorName === undefined ? {} : { creatorName: i.creatorName }),
    parent: ref,
  };

  if (childType === "payment_request") {
    if (parent.snapshot.total === 0) return { ok: false, kind: "nothing-to-pay" };
    frozenLines(parent); // a DNTT copies a priced HĐ — assert it is one
    return buildDocument({ ...common, source: { kind: "copy", from: parent.snapshot, frozenFrom: parent.id } });
  }

  // HĐ ← BG
  const lines = frozenLines(parent);
  const discountBps = parent.snapshot.discount_bps;
  const repriced = priceLines(lines, discountBps);
  if (repriced.total !== parent.snapshot.total) {
    throw new Error(`buildChildSnapshot: frozen lines of ${parent.id} re-price to ${repriced.total}, parent total is ${parent.snapshot.total}`);
  }
  return buildDocument({ ...common, source: { kind: "frozen", lines, discountBps, frozenFrom: parent.id } });
}
