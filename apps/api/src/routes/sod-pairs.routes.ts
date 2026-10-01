import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { problem, problemResponse, ProblemType } from "../dto/error";
import { CreateSodPairBody, SodPairIdParam, SodPairList, SodPairSchema } from "../dto/sod";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { getDb } from "../db/client";
import { addPair, listPairs, removePair, type SodDeps } from "../services/sod-service";

/**
 * SPEC-07 §3.2 — separation-of-duties permission pairs (FR-1, DEC-9 B). Contract: C-07-002; handlers: C-07-003.
 * Routes own `c`; the service sees plain inputs.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["sod-pairs"];

const PROBLEM = (c: Context<Env>) => ({ instance: c.req.path, request_id: c.get("requestId") });
const deps = (c: Context<Env>): SodDeps => ({ db: getDb(c.env), now: () => Math.floor(Date.now() / 1000) });
const ipOf = (c: Context<Env>) => c.req.header("cf-connecting-ip") ?? null;

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

  app.openapi(listRoute, async (c) => c.json(await listPairs(getDb(c.env)), 200));

  app.openapi(createRouteDef, async (c) => {
    const principal = c.get("principal")!;
    const body = c.req.valid("json");
    const res = await addPair(deps(c), {
      actorId: principal.id,
      permA: body.perm_a,
      permB: body.perm_b,
      reason: body.reason,
      ip: ipOf(c),
    });
    switch (res.kind) {
      case "ok":
        return c.json(res.pair, 201);
      case "duplicate":
        return c.json(
          problem(409, "Pair already declared", ProblemType.Duplicate, {
            ...PROBLEM(c),
            detail: "This pair (in either order) is already declared.",
          }),
          409,
          PROBLEM_HEADERS,
        );
      case "sod-conflict":
        return c.json(
          problem(409, "Roles already hold both permissions", ProblemType.SodConflict, {
            ...PROBLEM(c),
            detail: "Remove one of the two permissions from these roles first.",
            roles: res.roles,
          }),
          409,
          PROBLEM_HEADERS,
        );
    }
  });

  app.openapi(deleteRouteDef, async (c) => {
    const principal = c.get("principal")!;
    const res = await removePair(deps(c), { actorId: principal.id, id: c.req.valid("param").id, ip: ipOf(c) });
    if (res.kind === "not-found") {
      return c.json(problem(404, "Pair not found", ProblemType.NotFound, PROBLEM(c)), 404, PROBLEM_HEADERS);
    }
    return c.body(null, 204);
  });
}
