import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getDb } from "../db/client";
import { problem, ProblemType, problemResponse, type ProblemTypeSlug } from "../dto/error";
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
import {
  addPrice,
  cancelPrice,
  createProduct,
  getProductDetail,
  listProducts,
  patchProduct,
  PRODUCT_LIMIT,
  type ProductActor,
  type ProductDeps,
} from "../services/product-service";

/**
 * SPEC-08 §3.5 / PLAN-08 §2b — products + dated price levels (FR-1/2/3/7/8). Contract locked by C-08-003 (the 501
 * response stays declared); handlers by C-08-004. The route owns `c`; `services/product-service.ts` never sees it.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["products"];

const deps = (c: Context<Env>): ProductDeps => ({ db: getDb(c.env) });
const actorOf = (c: Context<Env>): ProductActor => {
  const principal = c.get("principal")!;
  return { id: principal.id, permissions: principal.permissions, ip: c.req.header("cf-connecting-ip") ?? null };
};

function fail<S extends 403 | 404 | 409 | 422>(
  c: Context<Env>,
  status: S,
  title: string,
  slug: ProblemTypeSlug,
  extra: { detail?: string; errors?: Array<{ path: string; message: string }> } = {},
) {
  return c.json(
    problem(status, title, slug, { ...extra, instance: c.req.path, request_id: c.get("requestId") }),
    status,
    PROBLEM_HEADERS,
  );
}

const notFound = (c: Context<Env>, what = "Product not found") => fail(c, 404, what, ProblemType.NotFound);
const backdated = (c: Context<Env>) =>
  fail(c, 422, "Price level starts too early", ProblemType.PriceBackdated, {
    detail: "A product's first level starts today at the earliest; a later level starts tomorrow at the earliest.",
  });

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

  app.openapi(listRoute, async (c) => {
    return c.json(await listProducts(deps(c), actorOf(c), c.req.valid("query"), new Date()), 200);
  });

  app.openapi(getRoute, async (c) => {
    const detail = await getProductDetail(deps(c), actorOf(c), c.req.valid("param").id, new Date());
    if (detail === null) return notFound(c);
    return c.json(detail, 200);
  });

  app.openapi(createProductRoute, async (c) => {
    const res = await createProduct(deps(c), actorOf(c), { ...c.req.valid("json"), path: c.req.path }, new Date());
    switch (res.kind) {
      case "ok":
        return c.json(res.product, 201);
      case "forbidden":
        return fail(c, 403, "Forbidden", ProblemType.Forbidden, { detail: "Setting a first price needs price:write." });
      case "price-backdated":
        return backdated(c);
      case "duplicate":
        return fail(c, 409, "Product code already used", ProblemType.Duplicate, {
          detail: "Another product has this code (case and spaces ignored).",
        });
      case "product-limit":
        return fail(c, 409, "Too many products", ProblemType.ProductLimit, {
          detail: `At most ${PRODUCT_LIMIT} products; stop selling one instead of adding more.`,
        });
    }
  });

  app.openapi(patchProductRoute, async (c) => {
    const res = await patchProduct(deps(c), actorOf(c), { ...c.req.valid("json"), id: c.req.valid("param").id }, new Date());
    switch (res.kind) {
      case "ok":
        return c.json(res.product, 200);
      case "not-found":
        return notFound(c);
      case "stale":
        return fail(c, 409, "Product was changed by someone else", ProblemType.Stale, {
          detail: "expected_version is out of date; reload the product and retry.",
        });
      case "invalid":
        return fail(c, 422, "Validation failed", ProblemType.Validation, { errors: res.errors });
    }
  });

  app.openapi(addPriceRoute, async (c) => {
    const res = await addPrice(deps(c), actorOf(c), { ...c.req.valid("json"), productId: c.req.valid("param").id }, new Date());
    switch (res.kind) {
      case "ok":
        return c.json(res.level, 201);
      case "not-found":
        return notFound(c);
      case "price-backdated":
        return backdated(c);
      case "duplicate":
        return fail(c, 409, "A level already starts that day", ProblemType.Duplicate, {
          detail: "Cancel the scheduled level first or pick another day.",
        });
    }
  });

  app.openapi(cancelPriceRoute, async (c) => {
    const { id, priceId } = c.req.valid("param");
    const res = await cancelPrice(deps(c), actorOf(c), { productId: id, priceId }, new Date());
    switch (res.kind) {
      case "ok":
        return c.body(null, 204);
      case "not-found":
        return notFound(c, "Price level not found");
      case "price-in-effect":
        return fail(c, 409, "Price level already in effect", ProblemType.PriceInEffect, {
          detail: "Only a level that has not started yet can be cancelled; add a new level instead.",
        });
    }
  });
}
