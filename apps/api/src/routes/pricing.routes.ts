import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { getDb } from "../db/client";
import { problem, ProblemType, problemResponse } from "../dto/error";
import { PricingPreviewBody, PricingPreviewSchema, type PricingPreviewDto } from "../dto/products";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { previewPricing } from "../services/pricing-service";

/**
 * SPEC-08 §3.5 / PLAN-08 §2b — the contract form's totals box (DEC-13): prices lines on today (Vietnam) with the same
 * function as the document, writes nothing. Generic line rules only (PLAN-08 P-1), not DEC-10.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const LINE_PROBLEM = {
  validation: { slug: ProblemType.Validation, title: "Validation failed" },
  "product-inactive": { slug: ProblemType.ProductInactive, title: "Product is not on sale" },
  "no-price": { slug: ProblemType.NoPrice, title: "Product has no price on the document date" },
} as const;

const previewRoute = createRoute({
  method: "post",
  path: "/pricing/preview",
  tags: ["pricing"],
  summary: "Price lines on today's date (ex-VAT, per-line discount, VAT per rate group); nothing is stored",
  security: [{ cookieAuth: [] }],
  request: { body: { content: { "application/json": { schema: PricingPreviewBody } } } },
  responses: {
    200: { description: "Priced lines + totals", content: { "application/json": { schema: PricingPreviewSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:write"),
    422: problemResponse(
      "validation (errors[].path `lines.<i>.product_id` for unknown / duplicate) | product-inactive | no-price (errors name the lines)",
    ),
  },
});

export function pricingRoutes(app: OpenAPIHono<Env>): void {
  app.on("post", "/pricing/preview", requireAuth(), requirePerm("contract:write"));
  app.openapi(previewRoute, async (c) => {
    const body = c.req.valid("json");
    const r = await previewPricing(getDb(c.env), { lines: body.lines, discount_bps: body.discount_bps, now: new Date() });
    // vat_rate_bps comes from the DB CHECK (0/500/800/1000/NULL) = the DTO union
    if (r.kind === "ok") return c.json(r.preview as PricingPreviewDto, 200);
    const t = LINE_PROBLEM[r.slug];
    return c.json(
      problem(422, t.title, t.slug, {
        instance: c.req.path,
        request_id: c.get("requestId"),
        detail: r.errors.map((e) => e.message).join(" "),
        errors: r.errors,
      }),
      422,
      PROBLEM_HEADERS,
    );
  });
}
