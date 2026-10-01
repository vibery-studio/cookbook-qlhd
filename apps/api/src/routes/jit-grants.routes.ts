import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { getDb } from "../db/client";
import { problem, problemResponse, ProblemType } from "../dto/error";
import { CreateJitGrantBody, JitGrantIdParam, JitGrantList, JitGrantListQuery, JitGrantSchema } from "../dto/jit";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";
import { grantJit, listJit, revokeJit, type JitDeps } from "../services/jit-service";

/**
 * SPEC-07 §3.2 / PLAN-07 §2b — just-in-time admin grants (FR-5/6, DEC-5..8). Contract from C-07-002 (the 501 entry
 * stays in the spec, unreachable); handlers C-07-005 → `services/jit-service.ts`.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["jit-grants"];

const JIT_RULE_DETAIL = {
  self_grant: "Không tự cấp quyền quản trị tạm thời cho chính mình.",
  jit_actor: "Người đang có quyền quản trị tạm thời không cấp quyền tạm cho người khác.",
} as const;

function deps(env: Bindings): JitDeps {
  return { db: getDb(env), kv: env.SESSIONS, now: () => Math.floor(Date.now() / 1000) };
}

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
  // revoke: jit:grant (permanent, D1) or the recipient, decided in the service
  app.on("post", "/admin/jit-grants/:id/revoke", requireAuth());

  app.openapi(listRoute, async (c) => {
    const { active } = c.req.valid("query");
    return c.json({ items: await listJit(deps(c.env), { activeOnly: active === "true" }) }, 200);
  });

  app.openapi(grantRoute, async (c) => {
    const body = c.req.valid("json");
    const actor = c.get("principal")!;
    const res = await grantJit(deps(c.env), {
      actorId: actor.id,
      userId: body.user_id,
      reason: body.reason,
      minutes: body.minutes,
      ip: c.req.header("cf-connecting-ip") ?? null,
    });
    const opts = { instance: c.req.path, request_id: c.get("requestId") };
    switch (res.kind) {
      case "ok":
        return c.json(res.grant, 201);
      case "not-found":
        return c.json(problem(404, "User not found", ProblemType.NotFound, opts), 404, PROBLEM_HEADERS);
      case "forbidden":
        return c.json(
          problem(403, "Forbidden", ProblemType.Forbidden, { ...opts, rule: res.rule, detail: JIT_RULE_DETAIL[res.rule] }),
          403,
          PROBLEM_HEADERS,
        );
      case "not-active-user":
        return c.json(
          problem(422, "Validation failed", ProblemType.Validation, {
            ...opts,
            errors: [{ path: "user_id", message: "Người dùng chưa kích hoạt hoặc đã bị khóa." }],
          }),
          422,
          PROBLEM_HEADERS,
        );
      case "already-admin":
        return c.json(
          problem(409, "User already holds admin permanently", ProblemType.AlreadyAdmin, opts),
          409,
          PROBLEM_HEADERS,
        );
      case "jit-active":
        return c.json(
          problem(409, "User already has an active temporary admin grant", ProblemType.JitActive, opts),
          409,
          PROBLEM_HEADERS,
        );
    }
  });

  app.openapi(revokeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const actor = c.get("principal")!;
    const res = await revokeJit(deps(c.env), { actorId: actor.id, grantId: id, ip: c.req.header("cf-connecting-ip") ?? null });
    const opts = { instance: c.req.path, request_id: c.get("requestId") };
    switch (res.kind) {
      case "ok":
        return c.json(res.grant, 200);
      case "not-found":
        return c.json(problem(404, "Grant not found", ProblemType.NotFound, opts), 404, PROBLEM_HEADERS);
      case "forbidden":
        return c.json(
          problem(403, "Forbidden", ProblemType.Forbidden, {
            ...opts,
            detail: "Chỉ người có quyền cấp quản trị tạm thời hoặc chính người nhận mới thu hồi được.",
          }),
          403,
          PROBLEM_HEADERS,
        );
      case "not-active":
        return c.json(problem(409, "Grant is not active", ProblemType.NotActive, opts), 409, PROBLEM_HEADERS);
    }
  });
}
