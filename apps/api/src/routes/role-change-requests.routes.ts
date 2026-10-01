import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { problem, problemResponse, ProblemType, type ProblemTypeSlug } from "../dto/error";
import {
  ApproveChangeRequestBody,
  ApproveChangeRequestResponse,
  ChangeRequestIdParam,
  ChangeRequestList,
  ChangeRequestListQuery,
  ChangeRequestSchema,
  CreateChangeRequestBody,
  DirectPermissionsBody,
  RejectChangeRequestBody,
} from "../dto/role-change";
import { RoleIdParam, RoleSchema } from "../dto/roles";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { getDb } from "../db/client";
import {
  approveRequest,
  changeDirect,
  createRequest,
  listRequests,
  rejectRequest,
  withdrawRequest,
  type ChangeRule,
  type Forbidden,
  type RoleChangeDeps,
} from "../services/role-change-service";

/**
 * SPEC-07 §3.2 / PLAN-07 §2b — four-eyes permission change requests (DEC-1 A). Contract: C-07-002; handlers:
 * C-07-004. Routes own `c`; role-change-service sees plain inputs and returns typed outcomes.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["role-change-requests"];

const PROBLEM = (c: Context<Env>) => ({ instance: c.req.path, request_id: c.get("requestId") });
const deps = (c: Context<Env>): RoleChangeDeps => ({
  db: getDb(c.env),
  kv: c.env.SESSIONS,
  now: () => Math.floor(Date.now() / 1000),
});
const ipOf = (c: Context<Env>) => c.req.header("cf-connecting-ip") ?? null;

const RULE_DETAIL: Record<ChangeRule, string> = {
  owner_only: "Only a holder of the Giám đốc role (owner) approves changes to the admin role.",
  own_role: "You cannot change a role you carry (approving a removal from it is allowed; Giám đốc may approve changes to giam_doc).",
  grant_not_held: "The requester must hold every permission being added.",
  self_approve: "You sent this request; someone else must decide it.",
  jit_actor: "Temporary admin access cannot decide permission change requests.",
  root_role: "The root role never changes, and is never given, through the app.",
  admin_or_owner: "A direct permission change needs a permanent admin or Giám đốc.",
};

function forbidden(c: Context<Env>, res: Forbidden) {
  return c.json(
    problem(403, "Forbidden", ProblemType.Forbidden, {
      ...PROBLEM(c),
      detail: res.rule === undefined ? "Only the requester may do this." : RULE_DETAIL[res.rule],
      ...(res.rule !== undefined && { rule: res.rule }),
      ...(res.permissions !== undefined && { permissions: res.permissions }),
    }),
    403,
    PROBLEM_HEADERS,
  );
}

const fail = (c: Context<Env>, status: 404 | 409, slug: ProblemTypeSlug, title: string, detail?: string) =>
  c.json(problem(status, title, slug, { ...PROBLEM(c), ...(detail !== undefined && { detail }) }), status, PROBLEM_HEADERS);

const notFound = (c: Context<Env>, what: string) => fail(c, 404, ProblemType.NotFound, `${what} not found`);
const notPending = (c: Context<Env>) =>
  fail(c, 409, ProblemType.NotPending, "Request is no longer pending", "It was already decided, withdrawn or expired.");
const expired = (c: Context<Env>) =>
  fail(c, 409, ProblemType.Expired, "Request expired", "Pending requests expire 7 days after they are sent.");
const stale = (c: Context<Env>) =>
  fail(c, 409, ProblemType.Stale, "Role was changed by someone else", "expected_version is out of date; reload the role and retry.");
const sodConflict = (c: Context<Env>, pairs: [string, string][]) =>
  c.json(
    problem(409, "Conflicting permissions", ProblemType.SodConflict, {
      ...PROBLEM(c),
      detail: "The resulting permission set holds both codes of a declared conflicting pair.",
      pairs,
    }),
    409,
    PROBLEM_HEADERS,
  );

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
      "Missing roles:write, or `forbidden` with rule root_role (the root role never changes through the app) | own_role (not for the admin role: admin proposes, Giám đốc approves) | grant_not_held (+ `permissions`). One permission.denied row each.",
    ),
    404: problemResponse("Role not found"),
    409: problemResponse(
      "sod-conflict (+ `pairs`) | stale (version mismatch) | request-pending (role already has a pending request) | no-eligible-approver (nobody else can approve; for the admin role: no other giam_doc holder)",
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

const directRoute = createRoute({
  method: "put",
  path: "/roles/{id}/permissions",
  tags,
  summary:
    "Two-layer approval OFF (PUT /security/two-layer): change the role's permission set at once (full new set; CAS on the version; holders' cache purged)",
  security,
  request: {
    params: RoleIdParam,
    body: { content: { "application/json": { schema: DirectPermissionsBody } } },
  },
  responses: {
    200: { description: "Applied (version + 1); audit role.permissions_changed {direct:true}", content: { "application/json": { schema: RoleSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse(
      "Missing roles:write, or `forbidden` with rule root_role | jit_actor | admin_or_owner (needs a permanent admin / giam_doc) | owner_only (the admin role: Giám đốc only) | own_role | grant_not_held (+ `permissions`). One permission.denied row each.",
    ),
    404: problemResponse("Role not found"),
    409: problemResponse(
      "two-layer-on (two-layer approval is on — send a change request) | sod-conflict (+ `pairs`) | request-pending (the role has a pending request) | stale",
    ),
    422: problemResponse("Validation failed (unknown or repeated code, nothing changes → errors[{path:'permissions'}])"),
  },
});

const DECIDE_403 =
  "Missing roles:write, or `forbidden` with rule self_approve (you sent it) | jit_actor (caller has an active JIT grant) | " +
  "owner_only (approve only: a change to the admin role needs a giam_doc holder) | own_role (approve only: adding codes to a role you carry; not for giam_doc holders on giam_doc) | grant_not_held (approve only: the requester no longer holds an added code, + `permissions`). One permission.denied row each.";

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
  app.on("put", "/roles/:id/permissions", requireAuth(), requirePerm("roles:write"));
  app.on("get", "/role-change-requests", requireAuth(), requirePerm("roles:write"));
  app.on("post", "/role-change-requests/:id/approve", requireAuth(), requirePerm("roles:write"));
  app.on("post", "/role-change-requests/:id/reject", requireAuth(), requirePerm("roles:write"));
  // withdraw: requester-only, decided in the service (C-07-004)
  app.on("post", "/role-change-requests/:id/withdraw", requireAuth());

  app.openapi(createRequestRoute, async (c) => {
    const principal = c.get("principal")!;
    const body = c.req.valid("json");
    const res = await createRequest(deps(c), {
      actorId: principal.id,
      roleId: c.req.valid("param").id,
      expectedVersion: body.expected_version,
      permissions: body.permissions,
      note: body.note,
      ip: ipOf(c),
    });
    switch (res.kind) {
      case "ok":
        return c.json(res.request, 201);
      case "not-found":
        return notFound(c, "Role");
      case "no-change":
        return c.json(
          problem(422, "Validation failed", ProblemType.Validation, {
            ...PROBLEM(c),
            errors: [{ path: "permissions", message: "The new set equals the current one; nothing to change." }],
          }),
          422,
          PROBLEM_HEADERS,
        );
      case "sod-conflict":
        return sodConflict(c, res.pairs);
      case "stale":
        return stale(c);
      case "request-pending":
        return fail(
          c,
          409,
          ProblemType.RequestPending,
          "Role has a pending change request",
          "One pending request per role; withdraw it or wait for the decision.",
        );
      case "no-eligible-approver":
        return fail(
          c,
          409,
          ProblemType.NoEligibleApprover,
          "Nobody else can approve this request",
          "No other active user holds roles:write permanently (without temporary admin) and may approve it.",
        );
      case "forbidden":
        return forbidden(c, res);
    }
  });

  app.openapi(directRoute, async (c) => {
    const principal = c.get("principal")!;
    const body = c.req.valid("json");
    const res = await changeDirect(deps(c), {
      actorId: principal.id,
      roleId: c.req.valid("param").id,
      expectedVersion: body.expected_version,
      permissions: body.permissions,
      ip: ipOf(c),
    });
    switch (res.kind) {
      case "ok":
        return c.json(res.role, 200);
      case "not-found":
        return notFound(c, "Role");
      case "two-layer-on":
        return fail(
          c,
          409,
          ProblemType.TwoLayerOn,
          "Two-layer approval is on",
          "Permission changes need a change request that someone else approves.",
        );
      case "no-change":
        return c.json(
          problem(422, "Validation failed", ProblemType.Validation, {
            ...PROBLEM(c),
            errors: [{ path: "permissions", message: "The new set equals the current one; nothing to change." }],
          }),
          422,
          PROBLEM_HEADERS,
        );
      case "sod-conflict":
        return sodConflict(c, res.pairs);
      case "stale":
        return stale(c);
      case "request-pending":
        return fail(c, 409, ProblemType.RequestPending, "Role has a pending change request", "Withdraw it or wait for the decision.");
      case "forbidden":
        return forbidden(c, res);
    }
  });

  app.openapi(listRequestsRoute, async (c) => {
    const principal = c.get("principal")!;
    return c.json(await listRequests(deps(c), { actorId: principal.id, status: c.req.valid("query").status }), 200);
  });

  app.openapi(approveRoute, async (c) => {
    const principal = c.get("principal")!;
    const res = await approveRequest(deps(c), {
      actorId: principal.id,
      id: c.req.valid("param").id,
      note: c.req.valid("json").note,
      ip: ipOf(c),
    });
    switch (res.kind) {
      case "ok":
        return c.json({ request: res.request, role: res.role }, 200);
      case "not-found":
        return notFound(c, "Request");
      case "not-pending":
        return notPending(c);
      case "expired":
        return expired(c);
      case "stale":
        return stale(c);
      case "sod-conflict":
        return sodConflict(c, res.pairs);
      case "forbidden":
        return forbidden(c, res);
    }
  });

  app.openapi(rejectRoute, async (c) => {
    const principal = c.get("principal")!;
    const res = await rejectRequest(deps(c), {
      actorId: principal.id,
      id: c.req.valid("param").id,
      note: c.req.valid("json").note,
      ip: ipOf(c),
    });
    switch (res.kind) {
      case "ok":
        return c.json(res.request, 200);
      case "not-found":
        return notFound(c, "Request");
      case "not-pending":
        return notPending(c);
      case "expired":
        return expired(c);
      case "forbidden":
        return forbidden(c, res);
    }
  });

  app.openapi(withdrawRoute, async (c) => {
    const principal = c.get("principal")!;
    const res = await withdrawRequest(deps(c), { actorId: principal.id, id: c.req.valid("param").id, ip: ipOf(c) });
    switch (res.kind) {
      case "ok":
        return c.json(res.request, 200);
      case "not-found":
        return notFound(c, "Request");
      case "not-pending":
        return notPending(c);
      case "forbidden":
        return forbidden(c, res);
    }
  });
}
