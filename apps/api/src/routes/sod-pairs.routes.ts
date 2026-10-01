import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notImplementedProblem, problemResponse } from "../dto/error";
import { CreateSodPairBody, SodPairIdParam, SodPairList, SodPairSchema } from "../dto/sod";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-07 §3.2 — separation-of-duties permission pairs (FR-1, DEC-9 B). Contract only (C-07-002): handlers answer
 * 501 after the real middleware; C-07-003 fills them.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["sod-pairs"];

const notImplemented = (c: Context<Env>) =>
  c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);

const listRoute = createRoute({
  method: "get",
  path: "/sod-pairs",
  tags,
  summary: "Declared conflicting permission pairs (any logged-in user)",
  security,
  responses: {
    200: { description: "Pairs", content: { "application/json": { schema: SodPairList } } },
    401: problemResponse("Not authenticated"),
    501: problemResponse("Not implemented"),
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/sod-pairs",
  tags,
  summary: "Declare a conflicting permission pair (stored perm_a < perm_b)",
  security,
  request: { body: { content: { "application/json": { schema: CreateSodPairBody } } } },
  responses: {
    201: { description: "Pair declared", content: { "application/json": { schema: SodPairSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing roles:write"),
    409: problemResponse("sod-conflict (+ `roles`: roles already holding both codes) | duplicate (same pair, either order)"),
    422: problemResponse("Validation failed (unknown code, same code twice, reason > 200)"),
    501: problemResponse("Not implemented"),
  },
});

const deleteRouteDef = createRoute({
  method: "delete",
  path: "/sod-pairs/{id}",
  tags,
  summary: "Remove a pair (roles are not touched)",
  security,
  request: { params: SodPairIdParam },
  responses: {
    204: { description: "Pair removed" },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing roles:write"),
    404: problemResponse("Pair not found"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

export function sodPairsRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", "/sod-pairs", requireAuth());
  app.on("post", "/sod-pairs", requireAuth(), requirePerm("roles:write"));
  app.on("delete", "/sod-pairs/:id", requireAuth(), requirePerm("roles:write"));

  app.openapi(listRoute, (c) => notImplemented(c));
  app.openapi(createRouteDef, (c) => notImplemented(c));
  app.openapi(deleteRouteDef, (c) => notImplemented(c));
}
