import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notImplementedProblem, problemResponse } from "../dto/error";
import {
  AddPriceBody,
  CreateProductBody,
  LevelSchema,
  PatchProductBody,
  PriceIdParam,
  ProductDetailSchema,
  ProductIdParam,
  ProductListQuery,
  ProductListSchema,
  ProductSchema,
} from "../dto/products";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-08 §3.5 / PLAN-08 §2b — products + dated price levels (FR-1/2/7). Contract only (C-08-003): handlers answer 501
 * after the real middleware; C-08-004 fills them.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["products"];

const notImplemented = (c: Context<Env>) =>
  c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);

const listRoute = createRoute({
  method: "get",
  path: "/products",
  tags,
  summary: "Products with the price level in force on `date` (default: today, Vietnam time) and the next one",
  security,
  request: { query: ProductListQuery },
  responses: {
    200: { description: "Services first, then by code", content: { "application/json": { schema: ProductListSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:read"),
    422: problemResponse("Validation failed (date not a real date, limit, kind, active)"),
    501: problemResponse("Not implemented"),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/products/{id}",
  tags,
  summary: "A product with its full price history (newest first, past | current | scheduled)",
  security,
  request: { params: ProductIdParam },
  responses: {
    200: { description: "Product", content: { "application/json": { schema: ProductDetailSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:read"),
    404: problemResponse("Product not found"),
    501: problemResponse("Not implemented"),
  },
});

const createProductRoute = createRoute({
  method: "post",
  path: "/products",
  tags,
  summary: "Add a product (code trimmed + upper-cased, immutable); optional first price level; Idempotency-Key replays",
  security,
  request: {
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateProductBody } } },
  },
  responses: {
    201: { description: "Product created", content: { "application/json": { schema: ProductSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing product:write, or price:write when first_price is sent (one permission.denied row)"),
    409: problemResponse("duplicate (code already used, case/space-insensitive) | product-limit (500 products)"),
    422: problemResponse("Validation failed | price-backdated (first_price before today). Order: schema → price-backdated → 409"),
    501: problemResponse("Not implemented"),
  },
});

const patchProductRoute = createRoute({
  method: "patch",
  path: "/products/{id}",
  tags,
  summary: "Edit name / unit / duration / active (optimistic lock by expected_version; code and kind never change)",
  security,
  request: {
    params: ProductIdParam,
    body: { content: { "application/json": { schema: PatchProductBody } } },
  },
  responses: {
    200: { description: "Product updated (version + 1)", content: { "application/json": { schema: ProductSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing product:write"),
    404: problemResponse("Product not found"),
    409: problemResponse("stale (version mismatch)"),
    422: problemResponse("Validation failed (incl. sending code or kind)"),
    501: problemResponse("Not implemented"),
  },
});

const addPriceRoute = createRoute({
  method: "post",
  path: "/products/{id}/prices",
  tags,
  summary: "Add a price level (ex-VAT + VAT rate) from a date; levels are never edited; Idempotency-Key replays",
  security,
  request: {
    params: ProductIdParam,
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: AddPriceBody } } },
  },
  responses: {
    201: { description: "Level added", content: { "application/json": { schema: LevelSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing price:write"),
    404: problemResponse("Product not found"),
    409: problemResponse("duplicate (a level already starts that day)"),
    422: problemResponse("Validation failed | price-backdated (before tomorrow when levels exist; before today for the first)"),
    501: problemResponse("Not implemented"),
  },
});

const cancelPriceRoute = createRoute({
  method: "delete",
  path: "/products/{id}/prices/{priceId}",
  tags,
  summary: "Cancel a scheduled price level (never one already in effect)",
  security,
  request: { params: PriceIdParam },
  responses: {
    204: { description: "Cancelled" },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing price:write"),
    404: problemResponse("Product or level not found"),
    409: problemResponse("price-in-effect (effective_from ≤ today)"),
    501: problemResponse("Not implemented"),
  },
});

export function productsRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", ["/products", "/products/:id"], requireAuth(), requirePerm("contract:read"));
  // first_price also needs price:write — checked in the service (C-08-004)
  app.on("post", "/products", requireAuth(), requirePerm("product:write"), withIdempotency());
  app.on("patch", "/products/:id", requireAuth(), requirePerm("product:write"));
  app.on("post", "/products/:id/prices", requireAuth(), requirePerm("price:write"), withIdempotency());
  app.on("delete", "/products/:id/prices/:priceId", requireAuth(), requirePerm("price:write"));

  app.openapi(listRoute, (c) => notImplemented(c));
  app.openapi(getRoute, (c) => notImplemented(c));
  app.openapi(createProductRoute, (c) => notImplemented(c));
  app.openapi(patchProductRoute, (c) => notImplemented(c));
  app.openapi(addPriceRoute, (c) => notImplemented(c));
  app.openapi(cancelPriceRoute, (c) => notImplemented(c));
}
