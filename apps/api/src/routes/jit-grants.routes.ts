import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notImplementedProblem, problemResponse } from "../dto/error";
import { CreateJitGrantBody, JitGrantIdParam, JitGrantList, JitGrantListQuery, JitGrantSchema } from "../dto/jit";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-07 §3.2 / PLAN-07 §2b — just-in-time admin grants (FR-5/6, DEC-5..8). Contract only (C-07-002): handlers
 * answer 501 after the real middleware; C-07-005 fills them.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["jit-grants"];

const notImplemented = (c: Context<Env>) =>
  c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);

const listRoute = createRoute({
  method: "get",
  path: "/admin/jit-grants",
  tags,
  summary: "Temporary admin grants, newest first (?active=true → only active)",
  security,
  request: { query: JitGrantListQuery },
  responses: {
    200: { description: "Grants", content: { "application/json": { schema: JitGrantList } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing users:read"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const grantRoute = createRoute({
  method: "post",
  path: "/admin/jit-grants",
  tags,
  summary: "Grant temporary admin to someone else (reason 10–500, 15–480 minutes); Idempotency-Key replays",
  security,
  request: {
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateJitGrantBody } } },
  },
  responses: {
    201: { description: "Grant active until expires_at", content: { "application/json": { schema: JitGrantSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse(
      "Missing jit:grant, or `forbidden` with rule self_grant | jit_actor (caller has an active JIT grant). One permission.denied row each.",
    ),
    404: problemResponse("User not found"),
    409: problemResponse("already-admin (user carries admin permanently) | jit-active (user already has an active grant)"),
    422: problemResponse("Validation failed (reason, minutes, user not active)"),
    501: problemResponse("Not implemented"),
  },
});

const revokeRoute = createRoute({
  method: "post",
  path: "/admin/jit-grants/{id}/revoke",
  tags,
  summary: "End a grant early (jit:grant holder, or the recipient themself)",
  security,
  request: { params: JitGrantIdParam },
  responses: {
    200: { description: "Revoked", content: { "application/json": { schema: JitGrantSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("`forbidden`: neither a permanent jit:grant holder nor the recipient (one permission.denied row)"),
    404: problemResponse("Grant not found"),
    409: problemResponse("not-active (already revoked or expired)"),
    501: problemResponse("Not implemented"),
  },
});

export function jitGrantsRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", "/admin/jit-grants", requireAuth(), requirePerm("users:read"));
  app.on("post", "/admin/jit-grants", requireAuth(), requirePerm("jit:grant"), withIdempotency());
  // revoke: jit:grant (permanent) or the recipient, decided in the service (C-07-005)
  app.on("post", "/admin/jit-grants/:id/revoke", requireAuth());

  app.openapi(listRoute, (c) => notImplemented(c));
  app.openapi(grantRoute, (c) => notImplemented(c));
  app.openapi(revokeRoute, (c) => notImplemented(c));
}
