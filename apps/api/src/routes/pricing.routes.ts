import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notImplementedProblem, problemResponse } from "../dto/error";
import { PricingPreviewBody, PricingPreviewSchema } from "../dto/products";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-08 §3.5 / PLAN-08 §2b — the contract form's totals box (DEC-13): prices lines on today (Vietnam) with the same
 * function as the document, writes nothing. Generic line rules only (PLAN-08 P-1), not DEC-10. Contract only (C-08-003):
 * 501 after the real middleware; C-08-005 fills it.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const notImplemented = (c: Context<Env>) =>
  c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);

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
    501: problemResponse("Not implemented"),
  },
});

export function pricingRoutes(app: OpenAPIHono<Env>): void {
  app.on("post", "/pricing/preview", requireAuth(), requirePerm("contract:write"));
  app.openapi(previewRoute, (c) => notImplemented(c));
}
