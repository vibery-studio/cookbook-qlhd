import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { problem, ProblemType, problemResponse } from "../dto/error";
import { getDb } from "../db/client";
import { priceListAt } from "../dao/price-list-dao";
import { isValidIsoDate, todayInVN } from "../utils/vn-date";
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
  },
});

export function priceListRoutes(app: OpenAPIHono<Env>): void {
  app.use("/price-list", requireAuth(), requirePerm("contract:read"));
  app.openapi(priceListRoute, async (c) => {
    const { date: given } = c.req.valid("query");
    const date = given ?? todayInVN(new Date());
    if (!isValidIsoDate(date)) {
      return c.json(
        problem(422, "Validation failed", ProblemType.Validation, {
          detail: "date is not a real calendar date",
          instance: c.req.path,
          request_id: c.get("requestId"),
          errors: [{ path: "date", message: "must be a real date, YYYY-MM-DD" }],
        }),
        422,
        { "content-type": "application/problem+json" },
      );
    }
    const items = await priceListAt(getDb(c.env), date);
    return c.json({ date, items }, 200);
  });
}
