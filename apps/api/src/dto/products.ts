import { z } from "@hono/zod-openapi";
import { MAX_LINES, MAX_QTY, MAX_UNIT_PRICE, VAT_RATES_BPS } from "../domain/money/line-pricing";
import { isValidIsoDate } from "../utils/vn-date";

/**
 * SPEC-08 §3.5 / PLAN-08 §2b — products, dated price levels (ex-VAT + VAT rate on the level) and the pricing preview.
 * Contract locked by C-08-003; a later card that needs a change stops and tells the driver.
 */

/** ULID-shaped 26 chars. Seed ids (`01PROD…G6`, `01PPRICE…`) contain O/I, so not strict Crockford (like `RoleIdSchema`). */
export const ProductIdSchema = z
  .string()
  .regex(/^[0-9A-Z]{26}$/, "invalid id")
  .openapi({ example: "01PROD000000000000000000G6" });

/** YYYY-MM-DD, a real calendar date. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine(isValidIsoDate, "must be a real date, YYYY-MM-DD")
  .openapi({ example: "2026-07-01" });

export const ProductKind = z.enum(["service", "goods"]);
export const DurationUnit = z.enum(["day", "month"]);

/** 0 · 5% · 8% · 10% in basis points; null = KCT (not subject to VAT — not 0%). */
// Explicit union: zod-to-openapi renders a multi-value `z.literal([...])` as `enum: [first]` only.
const [R0, R5, R8, R10] = VAT_RATES_BPS;
export const VatRateBps = z.union([z.literal(R0), z.literal(R5), z.literal(R8), z.literal(R10)]).nullable();

const UnitPriceExVat = z.number().int().min(0).max(MAX_UNIT_PRICE);
const Money = z.number().int();
const ProductName = z.string().trim().min(1).max(120);
const ProductUnit = z.string().trim().min(1).max(20);

/** Duration limits per unit (service only): 1–120 months · 1–3650 days. */
export const DURATION_MAX = { month: 120, day: 3650 } as const;

export const LevelSchema = z
  .object({
    id: ProductIdSchema,
    effective_from: z.string(),
    /** The day before the next level (computed on read); null = open-ended. */
    effective_to: z.string().nullable(),
    unit_price_ex_vat: z.number().int(),
    vat_rate_bps: VatRateBps,
    /** half-up, display only — documents price from ex-VAT + VAT groups. */
    unit_price_inc_vat: z.number().int(),
  })
  .openapi("Level");

export const ProductSchema = z
  .object({
    id: ProductIdSchema,
    kind: ProductKind,
    code: z.string(),
    name: z.string(),
    unit: z.string(),
    duration_value: z.number().int().nullable(),
    duration_unit: DurationUnit.nullable(),
    active: z.boolean(),
    version: z.number().int().min(1),
    /** Level in force on the list `date` (default: today, Vietnam time). */
    price: LevelSchema.nullable(),
    /** First level after `date`. */
    next_price: LevelSchema.nullable(),
    /** Hints for the caller (the API decides): edit = product:write, price = price:write. */
    can: z.object({ edit: z.boolean(), price: z.boolean() }),
  })
  .openapi("Product");

export const PriceHistoryItemSchema = LevelSchema.extend({
  status: z.enum(["past", "current", "scheduled"]),
  created_by_name: z.string().nullable(),
}).openapi("PriceHistoryItem");

export const ProductDetailSchema = ProductSchema.extend({
  /** Newest effective_from first. */
  prices: z.array(PriceHistoryItemSchema),
}).openapi("ProductDetail");

export const ProductListSchema = z
  .object({ date: z.string(), items: z.array(ProductSchema) })
  .openapi("ProductList");

export const ProductListQuery = z.object({
  /** Default: today in Vietnam. */
  date: IsoDateSchema.optional(),
  kind: ProductKind.optional(),
  /** Omitted = all (PLAN-08 P-3). */
  active: z.enum(["true", "false"]).optional(),
  /** Upper-case → matches the normalised code; otherwise lower(name), diacritics kept. */
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export const ProductIdParam = z.object({ id: ProductIdSchema });
export const PriceIdParam = z.object({ id: ProductIdSchema, priceId: ProductIdSchema });

export const AddPriceBody = z
  .object({
    unit_price_ex_vat: UnitPriceExVat,
    vat_rate_bps: VatRateBps,
    effective_from: IsoDateSchema,
  })
  .strict()
  .openapi("AddPriceBody");

/** service ⇒ duration_value + duration_unit within DURATION_MAX · goods ⇒ no duration. */
function checkDuration(
  b: { kind: "service" | "goods"; duration_value?: number; duration_unit?: "day" | "month" },
  ctx: z.RefinementCtx,
): void {
  if (b.kind === "goods") {
    if (b.duration_value !== undefined || b.duration_unit !== undefined) {
      ctx.addIssue({ code: "custom", path: ["duration_value"], message: "goods have no duration" });
    }
    return;
  }
  if (b.duration_value === undefined || b.duration_unit === undefined) {
    ctx.addIssue({ code: "custom", path: ["duration_value"], message: "a service needs duration_value + duration_unit" });
    return;
  }
  if (b.duration_value > DURATION_MAX[b.duration_unit]) {
    ctx.addIssue({
      code: "custom",
      path: ["duration_value"],
      message: `at most ${DURATION_MAX[b.duration_unit]} ${b.duration_unit}s`,
    });
  }
}

export const CreateProductBody = z
  .object({
    kind: ProductKind,
    /** trim + upper, then [A-Z0-9._-]{1,32}. Never changes after creation. */
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9._-]{1,32}$/, "1–32 of A–Z 0–9 . _ -"),
    name: ProductName,
    unit: ProductUnit,
    duration_value: z.number().int().min(1).max(DURATION_MAX.day).optional(),
    duration_unit: DurationUnit.optional(),
    /** Needs price:write as well (checked in the service → 403 + permission.denied). */
    first_price: AddPriceBody.optional(),
  })
  .strict()
  .superRefine(checkDuration)
  .openapi("CreateProductBody");

/** `code` / `kind` are immutable: sending them → 422 (strict). Duration vs kind is checked in the service. */
export const PatchProductBody = z
  .object({
    expected_version: z.number().int().min(1),
    name: ProductName.optional(),
    unit: ProductUnit.optional(),
    duration_value: z.number().int().min(1).max(DURATION_MAX.day).optional(),
    duration_unit: DurationUnit.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .openapi("PatchProductBody");

export const SnapshotLineSchema = z
  .object({
    product_id: ProductIdSchema,
    code: z.string(),
    name: z.string(),
    kind: ProductKind,
    unit: z.string(),
    duration_value: z.number().int().nullable(),
    duration_unit: DurationUnit.nullable(),
    qty: z.number().int(),
    unit_price_ex_vat: z.number().int(),
    vat_rate_bps: VatRateBps,
    /** effective_from of the level used. */
    price_from: z.string(),
    amount_ex_vat: Money,
    discount_amount: Money,
    net_ex_vat: Money,
  })
  .openapi("SnapshotLine");

export const VatGroupSchema = z
  .object({ vat_rate_bps: VatRateBps, base: Money, vat: Money })
  .openapi("VatGroup");

export const LineInput = z
  .object({ product_id: ProductIdSchema, qty: z.number().int().min(1).max(MAX_QTY) })
  .strict()
  .openapi("LineInput");

export const PricingPreviewBody = z
  .object({
    lines: z.array(LineInput).min(1).max(MAX_LINES),
    discount_bps: z.number().int().min(0).max(10_000),
  })
  .strict()
  .openapi("PricingPreviewBody");

export const PricingPreviewSchema = z
  .object({
    doc_date: z.string(),
    lines: z.array(SnapshotLineSchema),
    /** KCT first, then rates ascending. */
    vat_groups: z.array(VatGroupSchema),
    subtotal_ex_vat: Money,
    discount_amount: Money,
    total_ex_vat: Money,
    vat_total: Money,
    total: Money,
    total_words: z.string(),
  })
  .openapi("PricingPreview");

export type CreateProductInput = z.infer<typeof CreateProductBody>;
export type PatchProductInput = z.infer<typeof PatchProductBody>;
export type AddPriceInput = z.infer<typeof AddPriceBody>;
export type PricingPreviewInput = z.infer<typeof PricingPreviewBody>;
export type ProductDto = z.infer<typeof ProductSchema>;
export type ProductDetailDto = z.infer<typeof ProductDetailSchema>;
export type LevelDto = z.infer<typeof LevelSchema>;
export type PricingPreviewDto = z.infer<typeof PricingPreviewSchema>;
