/** VAT rate in basis points; `null` = không chịu thuế (KCT). */
export type VatRateBps = number | null;

export type SnapshotLine = {
  productId: string;
  code: string;
  name: string;
  kind: string;
  unit: string;
  qty: number;
  unitPriceExVat: number;
  vatRateBps: VatRateBps;
  amountExVat: number;
  discountAmount: number;
  netExVat: number;
};
export type VatGroup = { vatRateBps: VatRateBps; base: number; vat: number };
export type InputLine = { productId: string; qty: number };

export type SnapshotView = {
  templateVersionId: string | null;
  templateVersionNo: number | null;
  lines: SnapshotLine[];
  vatGroups: VatGroup[];
  subtotalExVat: number;
  discountBps: number;
  discountAmount: number;
  totalExVat: number;
  vatTotal: number;
  total: number;
  totalWords: string | null;
  start: string | null;
  end: string | null;
  inputs: Record<string, string | number>;
  inputLines: InputLine[];
};

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rate = (v: unknown): VatRateBps => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The contract snapshot is untyped JSON in the API contract: read it defensively, never compute from it. */
export function parseSnapshot(raw: unknown): SnapshotView {
  const s = rec(raw);
  const template = rec(s["template"]);
  const dates = rec(s["dates"]);
  const rawInputs = rec(s["inputs"]);
  const inputs: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(rawInputs)) if (typeof v === "string" || typeof v === "number") inputs[k] = v;
  return {
    templateVersionId: str(template["version_id"]),
    templateVersionNo: typeof template["version_no"] === "number" ? template["version_no"] : null,
    lines: list(s["lines"]).map((l) => {
      const r = rec(l);
      return {
        productId: str(r["product_id"]) ?? "",
        code: str(r["code"]) ?? "",
        name: str(r["name"]) ?? "",
        kind: str(r["kind"]) ?? "",
        unit: str(r["unit"]) ?? "",
        qty: int(r["qty"]),
        unitPriceExVat: int(r["unit_price_ex_vat"]),
        vatRateBps: rate(r["vat_rate_bps"]),
        amountExVat: int(r["amount_ex_vat"]),
        discountAmount: int(r["discount_amount"]),
        netExVat: int(r["net_ex_vat"]),
      };
    }),
    vatGroups: list(s["vat_groups"]).map((g) => {
      const r = rec(g);
      return { vatRateBps: rate(r["vat_rate_bps"]), base: int(r["base"]), vat: int(r["vat"]) };
    }),
    subtotalExVat: int(s["subtotal_ex_vat"]),
    discountBps: int(s["discount_bps"]),
    discountAmount: int(s["discount_amount"]),
    totalExVat: int(s["total_ex_vat"]),
    vatTotal: int(s["vat_total"]),
    total: int(s["total"]),
    totalWords: str(s["total_words"]),
    start: str(dates["start"]),
    end: str(dates["end"]),
    inputs,
    inputLines: list(rawInputs["lines"]).flatMap((l) => {
      const r = rec(l);
      const productId = str(r["product_id"]);
      return productId && typeof r["qty"] === "number" ? [{ productId, qty: r["qty"] }] : [];
    }),
  };
}
