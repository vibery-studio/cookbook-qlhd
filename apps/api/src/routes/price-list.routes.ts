import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { notImplementedProblem, problemResponse } from "../dto/error";
import { PriceListQuery, PriceListResponse } from "../dto/price-list";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

type Env = { Bindings: Bindings; Variables: Variables };

const priceListRoute = createRoute({
  method: "get",
  path: "/price-list",
  tags: ["price-list"],
  summary: "Packages in force on a date (default: today, Vietnam time)",
  security: [{ cookieAuth: [] }],
  request: { query: PriceListQuery },
  responses: {
    200: {
      description: "Price list for the date",
      content: { "application/json": { schema: PriceListResponse } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:read permission"),
    422: problemResponse("Bad date"),
    501: problemResponse("Not implemented"),
  },
});

export function priceListRoutes(app: OpenAPIHono<Env>): void {
  app.use("/price-list", requireAuth(), requirePerm("contract:read"));
  app.openapi(priceListRoute, (c) =>
    c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, {
      "content-type": "application/problem+json",
    }),
  );
}
