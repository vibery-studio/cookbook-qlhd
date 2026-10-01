import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notImplementedProblem, problemResponse } from "../dto/error";
import {
  ApproveChangeRequestBody,
  ApproveChangeRequestResponse,
  ChangeRequestIdParam,
  ChangeRequestList,
  ChangeRequestListQuery,
  ChangeRequestSchema,
  CreateChangeRequestBody,
  RejectChangeRequestBody,
} from "../dto/role-change";
import { RoleIdParam } from "../dto/roles";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-07 §3.2 / PLAN-07 §2b — four-eyes permission change requests (DEC-1 A). Contract only (C-07-002): handlers
 * answer 501 after the real middleware; C-07-004 fills them.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["role-change-requests"];

const notImplemented = (c: Context<Env>) =>
  c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);

const createRequestRoute = createRoute({
  method: "post",
  path: "/roles/{id}/change-requests",
  tags,
  summary: "Request a change of the role's permission set (full new set; applied only when someone else approves)",
  security,
  request: {
    params: RoleIdParam,
    body: { content: { "application/json": { schema: CreateChangeRequestBody } } },
  },
  responses: {
    201: { description: "Request created (pending, expires in 7 days)", content: { "application/json": { schema: ChangeRequestSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse(
      "Missing roles:write, or `forbidden` with rule admin_role | own_role | grant_not_held (+ `permissions`). One permission.denied row each.",
    ),
    404: problemResponse("Role not found"),
    409: problemResponse(
      "sod-conflict (+ `pairs`) | stale (version mismatch) | request-pending (role already has a pending request) | no-eligible-approver (nobody else can approve)",
    ),
    422: problemResponse("Validation failed (unknown or repeated code, note > 500, nothing changes → errors[{path:'permissions'}])"),
    501: problemResponse("Not implemented"),
  },
});

const listRequestsRoute = createRoute({
  method: "get",
  path: "/role-change-requests",
  tags,
  summary: "Permission change requests, newest first (no status = all)",
  security,
  request: { query: ChangeRequestListQuery },
  responses: {
    200: { description: "Requests with can/locked_reason for the caller", content: { "application/json": { schema: ChangeRequestList } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing roles:write"),
    422: problemResponse("Validation failed (unknown status)"),
    501: problemResponse("Not implemented"),
  },
});

const DECIDE_403 =
  "Missing roles:write, or `forbidden` with rule self_approve (you sent it) | jit_actor (caller has an active JIT grant) | " +
  "own_role (approve only: adding codes to a role you carry) | grant_not_held (approve only: the requester no longer holds an added code, + `permissions`). One permission.denied row each.";

const approveRoute = createRoute({
  method: "post",
  path: "/role-change-requests/{id}/approve",
  tags,
  summary: "Approve and apply a pending request (CAS on the role version; holders' cache purged)",
  security,
  request: {
    params: ChangeRequestIdParam,
    body: { content: { "application/json": { schema: ApproveChangeRequestBody } } },
  },
  responses: {
    200: { description: "Approved; the role after the change", content: { "application/json": { schema: ApproveChangeRequestResponse } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse(DECIDE_403),
    404: problemResponse("Request not found"),
    409: problemResponse("not-pending | expired | stale (role changed) | sod-conflict (+ `pairs`, a pair declared after the request)"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const rejectRoute = createRoute({
  method: "post",
  path: "/role-change-requests/{id}/reject",
  tags,
  summary: "Reject a pending request (note required)",
  security,
  request: {
    params: ChangeRequestIdParam,
    body: { content: { "application/json": { schema: RejectChangeRequestBody } } },
  },
  responses: {
    200: { description: "Rejected", content: { "application/json": { schema: ChangeRequestSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse(DECIDE_403),
    404: problemResponse("Request not found"),
    409: problemResponse("not-pending | expired"),
    422: problemResponse("Validation failed (note 1–500)"),
    501: problemResponse("Not implemented"),
  },
});

const withdrawRoute = createRoute({
  method: "post",
  path: "/role-change-requests/{id}/withdraw",
  tags,
  summary: "Withdraw your own pending request",
  security,
  request: { params: ChangeRequestIdParam },
  responses: {
    200: { description: "Withdrawn", content: { "application/json": { schema: ChangeRequestSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("`forbidden`: only the requester may withdraw (one permission.denied row)"),
    404: problemResponse("Request not found"),
    409: problemResponse("not-pending"),
    501: problemResponse("Not implemented"),
  },
});

export function roleChangeRequestsRoutes(app: OpenAPIHono<Env>): void {
  app.on("post", "/roles/:id/change-requests", requireAuth(), requirePerm("roles:write"));
  app.on("get", "/role-change-requests", requireAuth(), requirePerm("roles:write"));
  app.on("post", "/role-change-requests/:id/approve", requireAuth(), requirePerm("roles:write"));
  app.on("post", "/role-change-requests/:id/reject", requireAuth(), requirePerm("roles:write"));
  // withdraw: requester-only, decided in the service (C-07-004)
  app.on("post", "/role-change-requests/:id/withdraw", requireAuth());

  app.openapi(createRequestRoute, (c) => notImplemented(c));
  app.openapi(listRequestsRoute, (c) => notImplemented(c));
  app.openapi(approveRoute, (c) => notImplemented(c));
  app.openapi(rejectRoute, (c) => notImplemented(c));
  app.openapi(withdrawRoute, (c) => notImplemented(c));
}
