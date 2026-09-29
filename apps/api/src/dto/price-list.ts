import { z } from "@hono/zod-openapi";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const PriceListQuery = z.object({ date: IsoDate.optional() });

export const PriceItem = z
  .object({
    code: z.string(),
    name: z.string(),
    duration_value: z.number().int(),
    duration_unit: z.enum(["day", "month"]),
    unit_price: z.number().int(),
    effective_from: z.string(),
    effective_to: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi("PriceItem");

export const PriceListResponse = z
  .object({ date: z.string(), items: z.array(PriceItem) })
  .openapi("PriceList");
