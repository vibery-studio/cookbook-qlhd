export type SnapshotLine = { description: string; qty: number; unitPrice: number; discountBps: number; amount: number };

export type SnapshotView = {
  templateVersionId: string | null;
  templateVersionNo: number | null;
  packageName: string | null;
  lines: SnapshotLine[];
  totalWords: string | null;
  start: string | null;
  end: string | null;
  inputs: Record<string, string | number>;
};

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The contract snapshot is untyped JSON in the API contract: read it defensively, never compute from it. */
export function parseSnapshot(raw: unknown): SnapshotView {
  const s = rec(raw);
  const template = rec(s["template"]);
  const dates = rec(s["dates"]);
  const inputs: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(rec(s["inputs"]))) if (typeof v === "string" || typeof v === "number") inputs[k] = v;
  const lines = Array.isArray(s["lines"]) ? s["lines"] : [];
  return {
    templateVersionId: str(template["version_id"]),
    templateVersionNo: typeof template["version_no"] === "number" ? template["version_no"] : null,
    packageName: str(rec(s["package"])["name"]),
    lines: lines.map((l) => {
      const r = rec(l);
      return { description: str(r["description"]) ?? "", qty: int(r["qty"]), unitPrice: int(r["unit_price"]), discountBps: int(r["discount_bps"]), amount: int(r["amount"]) };
    }),
    totalWords: str(s["total_words"]),
    start: str(dates["start"]),
    end: str(dates["end"]),
    inputs,
  };
}
