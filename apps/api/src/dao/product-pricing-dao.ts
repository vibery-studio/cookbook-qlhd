/**
 * Read-only pricing DAO for documents (SPEC-08 FR-3/FR-4, PLAN-08 §3 "điều phối"): the products a document names + the level
 * in force on its date. Pure `(db, input) → DTO`. Product CRUD lives in `product-dao.ts` (C-08-004) — not imported here.
 */
import { asc, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { productPrices, products } from "../db/schema";
import { levelAt } from "../domain/money/price-at";

export interface PricingProduct {
  id: string;
  kind: "service" | "goods";
  code: string;
  name: string;
  unit: string;
  duration_value: number | null;
  duration_unit: "day" | "month" | null;
  active: boolean;
}

export interface PricingLevel {
  id: string;
  effective_from: string;
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
}

export interface ProductAt {
  product: PricingProduct;
  /** The level with the greatest effective_from ≤ date; null = no price that day. */
  level: PricingLevel | null;
}

/** Every requested id that exists → its product + level on `date` (YYYY-MM-DD). Unknown ids are absent from the map. */
export async function linesAt(db: Db, productIds: readonly string[], date: string): Promise<Map<string, ProductAt>> {
  const ids = [...new Set(productIds)];
  const out = new Map<string, ProductAt>();
  if (ids.length === 0) return out;

  const [rows, levels] = await Promise.all([
    db.select().from(products).where(inArray(products.id, ids)),
    db
      .select()
      .from(productPrices)
      .where(inArray(productPrices.productId, ids))
      .orderBy(asc(productPrices.productId), asc(productPrices.effectiveFrom)),
  ]);

  const byProduct = new Map<string, PricingLevel[]>();
  for (const l of levels) {
    const list = byProduct.get(l.productId) ?? [];
    list.push({ id: l.id, effective_from: l.effectiveFrom, unit_price_ex_vat: l.unitPriceExVat, vat_rate_bps: l.vatRateBps });
    byProduct.set(l.productId, list);
  }

  for (const r of rows) {
    out.set(r.id, {
      product: {
        id: r.id,
        kind: r.kind as PricingProduct["kind"],
        code: r.code,
        name: r.name,
        unit: r.unit,
        duration_value: r.durationValue,
        duration_unit: r.durationUnit as PricingProduct["duration_unit"],
        active: r.active === 1,
      },
      level: levelAt(byProduct.get(r.id) ?? [], date),
    });
  }
  return out;
}
