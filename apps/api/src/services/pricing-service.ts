/**
 * Lines → priced lines on a date (SPEC-08 FR-3/FR-4, PLAN-08 §2b P-1/P-2). One path for documents (snapshot-builder) and the
 * contract form's preview (DEC-13), so the form and the paper never differ by 1 đồng. Services never see Hono `c`.
 */
import { linesAt } from "../dao/product-pricing-dao";
import type { Db } from "../db/client";
import { amountInWords } from "../domain/contract/amount-words";
import type { LineRef, PricedLineInput, SnapshotLine, SnapshotVatGroup } from "../domain/contract/types";
import { priceLines } from "../domain/money/line-pricing";
import { todayInVN } from "../utils/vn-date";

export type LineSlug = "validation" | "product-inactive" | "no-price";

export type ResolveLinesResult =
  | { kind: "ok"; lines: PricedLineInput[] }
  | { kind: "line-invalid"; slug: LineSlug; errors: Array<{ path: string; message: string }> };

/** P-2 order per line: unknown id → duplicate → inactive → no price on `date`. Lower rank wins the slug. */
const RANK: Record<LineSlug, number> = { validation: 0, "product-inactive": 1, "no-price": 2 };

/**
 * Generic line rules (P-1 — no document rule here): every line names an existing product, at most once, on sale, priced on
 * `date`. On failure: the slug of the first rule broken (P-2 order) + every line broken under that slug.
 */
export async function resolveLines(db: Db, refs: readonly LineRef[], date: string): Promise<ResolveLinesResult> {
  const found = await linesAt(
    db,
    refs.map((r) => r.product_id),
    date,
  );
  const seen = new Set<string>();
  const problems: Array<{ slug: LineSlug; path: string; message: string }> = [];
  const lines: PricedLineInput[] = [];

  refs.forEach((ref, i) => {
    const path = `lines.${i}.product_id`;
    const n = i + 1;
    const hit = found.get(ref.product_id);
    if (hit === undefined) {
      problems.push({ slug: "validation", path, message: `Dòng ${n}: sản phẩm không tồn tại.` });
      return;
    }
    if (seen.has(ref.product_id)) {
      problems.push({ slug: "validation", path, message: `Dòng ${n}: ${hit.product.name} đã có ở dòng khác.` });
      return;
    }
    seen.add(ref.product_id);
    if (!hit.product.active) {
      problems.push({ slug: "product-inactive", path, message: `Dòng ${n}: ${hit.product.name} đã ngừng bán.` });
      return;
    }
    if (hit.level === null) {
      problems.push({ slug: "no-price", path, message: `Dòng ${n}: ${hit.product.name} chưa có giá ngày ${date}.` });
      return;
    }
    lines.push({
      product_id: hit.product.id,
      code: hit.product.code,
      name: hit.product.name,
      kind: hit.product.kind,
      unit: hit.product.unit,
      duration_value: hit.product.duration_value,
      duration_unit: hit.product.duration_unit,
      qty: ref.qty,
      unit_price_ex_vat: hit.level.unit_price_ex_vat,
      vat_rate_bps: hit.level.vat_rate_bps,
      price_from: hit.level.effective_from,
    });
  });

  if (problems.length > 0) {
    const slug = problems.reduce<LineSlug>((best, p) => (RANK[p.slug] < RANK[best] ? p.slug : best), "no-price");
    return {
      kind: "line-invalid",
      slug,
      errors: problems.filter((p) => p.slug === slug).map(({ path, message }) => ({ path, message })),
    };
  }
  return { kind: "ok", lines };
}

export interface PricingPreview {
  doc_date: string;
  lines: SnapshotLine[];
  vat_groups: SnapshotVatGroup[];
  subtotal_ex_vat: number;
  discount_amount: number;
  total_ex_vat: number;
  vat_total: number;
  total: number;
  total_words: string;
}

export type PreviewResult = { kind: "ok"; preview: PricingPreview } | Extract<ResolveLinesResult, { kind: "line-invalid" }>;

/** `POST /pricing/preview`: today's prices (Vietnam), the same priceLines as the paper; writes nothing. */
export async function previewPricing(
  db: Db,
  input: { lines: LineRef[]; discount_bps: number; now: Date },
): Promise<PreviewResult> {
  const docDate = todayInVN(input.now);
  const resolved = await resolveLines(db, input.lines, docDate);
  if (resolved.kind !== "ok") return resolved;
  let priced;
  try {
    priced = priceLines(resolved.lines, input.discount_bps);
  } catch (error) {
    return {
      kind: "line-invalid",
      slug: "validation",
      errors: [{ path: "lines", message: error instanceof Error ? error.message : "Số tiền không hợp lệ." }],
    };
  }
  return {
    kind: "ok",
    preview: {
      doc_date: docDate,
      lines: priced.lines,
      vat_groups: priced.vat_groups,
      subtotal_ex_vat: priced.subtotal_ex_vat,
      discount_amount: priced.discount_amount,
      total_ex_vat: priced.total_ex_vat,
      vat_total: priced.vat_total,
      total: priced.total,
      total_words: amountInWords(priced.total),
    },
  };
}
