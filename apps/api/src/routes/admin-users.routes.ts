import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { UlidSchema } from "../dto/common";
import { notImplementedProblem, problemResponse } from "../dto/error";
import {
  AdminUserSchema,
  IdempotencyKeyHeader,
  InviteUserBody,
  InviteUserResponse,
  ReinviteResponse,
  UpdateUserBody,
} from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";

/** Contract-only (C-01-002): every handler is a 501 until its card. */

type Env = { Bindings: Bindings; Variables: Variables };

const IdParam = z.object({ id: UlidSchema });
const security = [{ cookieAuth: [] }];

function stub(c: Context<Env>) {
  return c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, {
    "content-type": "application/problem+json",
  });
}

const createUserRoute = createRoute({
  method: "post",
  path: "/admin/users",
  tags: ["admin"],
  summary: "Invite a user (returns a one-time activation link)",
  security,
  request: {
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: InviteUserBody } } },
  },
  responses: {
    201: {
      description: "User created (pending) with activation link",
      content: { "application/json": { schema: InviteUserResponse } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing users:write permission"),
    409: problemResponse("Email already registered"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const updateUserRoute = createRoute({
  method: "patch",
  path: "/admin/users/{id}",
  tags: ["admin"],
  summary: "Change role, status or display name",
  security,
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: UpdateUserBody } } },
  },
  responses: {
    200: {
      description: "Updated user",
      content: { "application/json": { schema: AdminUserSchema } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing users:write permission"),
    404: problemResponse("User not found"),
    409: problemResponse("last_admin: cannot disable or demote the last active admin"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const reinviteRoute = createRoute({
  method: "post",
  path: "/admin/users/{id}/invite",
  tags: ["admin"],
  summary: "Re-issue the activation link (old link stops working)",
  security,
  request: { params: IdParam },
  responses: {
    200: {
      description: "New activation link",
      content: { "application/json": { schema: ReinviteResponse } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing users:write permission"),
    404: problemResponse("User not found"),
    409: problemResponse("already_active: user has already activated"),
    501: problemResponse("Not implemented"),
  },
});

export function adminUsersRoutes(app: OpenAPIHono<Env>): void {
  app.on(
    "post",
    "/admin/users",
    requireAuth(),
    requirePerm("users:write"),
    withIdempotency(),
  );
  app.on("patch", "/admin/users/:id", requireAuth(), requirePerm("users:write"));
  app.on("post", "/admin/users/:id/invite", requireAuth(), requirePerm("users:write"));

  app.openapi(createUserRoute, stub);
  app.openapi(updateUserRoute, stub);
  app.openapi(reinviteRoute, stub);
}
