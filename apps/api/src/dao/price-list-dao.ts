/** Price list DAO (SPEC-01 FR-6). Pure `(db, input) → DTO`. */
import { and, asc, gte, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { priceList } from "../db/schema";

export interface PriceItemDto {
  code: string;
  name: string;
  duration_value: number;
  duration_unit: "day" | "month";
  unit_price: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
}

/** Packages in force on `date` (YYYY-MM-DD, inclusive both ends), shortest duration first. */
export async function priceListAt(db: Db, date: string): Promise<PriceItemDto[]> {
  const rows = await db
    .select()
    .from(priceList)
    .where(
      and(
        lte(priceList.effectiveFrom, date),
        or(isNull(priceList.effectiveTo), gte(priceList.effectiveTo, date)),
      ),
    )
    // "day" < "month" alphabetically → DT14 first, then G3, G6, G12 by value.
    .orderBy(asc(priceList.durationUnit), asc(priceList.durationValue), asc(priceList.code));
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    duration_value: r.durationValue,
    duration_unit: r.durationUnit as "day" | "month",
    unit_price: r.unitPrice,
    effective_from: r.effectiveFrom,
    effective_to: r.effectiveTo,
    note: r.note,
  }));
}
