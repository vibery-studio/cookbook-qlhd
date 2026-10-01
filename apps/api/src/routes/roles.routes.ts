import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notImplementedProblem, problemResponse } from "../dto/error";
import { CreateRoleBody, DeleteRoleQuery, PatchRoleBody, RoleIdParam, RoleSchema, RolesResponse } from "../dto/roles";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { listRolesWithPermissions } from "../dao/role-dao";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const FORBIDDEN_403 =
  "Missing roles:write, or `forbidden` with rule own_role (caller carries the role) | admin_role (admin is immutable) | " +
  "system_role (system roles are not deleted) | grant_not_held (+ `permissions`: codes the caller lacks). One permission.denied row each.";

const listRolesRoute = createRoute({
  method: "get",
  path: "/roles",
  tags: ["roles"],
  summary: "Role x permission matrix + full permission catalog",
  security,
  responses: {
    200: {
      description: "Roles (with holders, can/locked_reason for the caller) and the permission catalog",
      content: { "application/json": { schema: RolesResponse } },
    },
    401: problemResponse("Not authenticated"),
  },
});

const createRoleRoute = createRoute({
  method: "post",
  path: "/roles",
  tags: ["roles"],
  summary: "Create a custom role (clone = create with the source's permissions); name is server-made r_<ulid>",
  security,
  request: {
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateRoleBody } } },
  },
  responses: {
    201: { description: "Role created", content: { "application/json": { schema: RoleSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse(FORBIDDEN_403),
    409: problemResponse("duplicate (label, case/space-insensitive) | role-limit (50 custom roles)"),
    422: problemResponse("Validation failed (unknown or repeated permission, label 1–60, description ≤ 200, extra keys)"),
    501: problemResponse("Not implemented"),
  },
});

const patchRoleRoute = createRoute({
  method: "patch",
  path: "/roles/{id}",
  tags: ["roles"],
  summary: "Edit a role's label, description and/or full permission set (optimistic lock by expected_version)",
  security,
  request: {
    params: RoleIdParam,
    body: { content: { "application/json": { schema: PatchRoleBody } } },
  },
  responses: {
    200: { description: "Role updated (version + 1)", content: { "application/json": { schema: RoleSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse(FORBIDDEN_403),
    404: problemResponse("Role not found"),
    409: problemResponse("stale (version mismatch) | duplicate (label)"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const deleteRoleRoute = createRoute({
  method: "delete",
  path: "/roles/{id}",
  tags: ["roles"],
  summary: "Delete a custom role nobody carries",
  security,
  request: { params: RoleIdParam, query: DeleteRoleQuery },
  responses: {
    204: { description: "Role deleted" },
    401: problemResponse("Not authenticated"),
    403: problemResponse(FORBIDDEN_403),
    404: problemResponse("Role not found"),
    409: problemResponse("stale (version mismatch) | role-in-use (+ `holders`)"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

/** C-06-002 contract stub; handlers land in C-06-003. */
function notImplemented(c: Context<Env>) {
  return c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);
}

export function rolesRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", "/roles", requireAuth());
  app.on("post", "/roles", requireAuth(), requirePerm("roles:write"), withIdempotency());
  app.on(["patch", "delete"], "/roles/:id", requireAuth(), requirePerm("roles:write"));

  app.openapi(listRolesRoute, async (c) => {
    // TODO(C-06-003): label/is_system/version/holders/can/locked_reason + catalog. Old shape until then.
    const items = await listRolesWithPermissions(getDb(c.env));
    return c.json({ items } as unknown as z.infer<typeof RolesResponse>, 200);
  });
  app.openapi(createRoleRoute, notImplemented);
  app.openapi(patchRoleRoute, notImplemented);
  app.openapi(deleteRoleRoute, notImplemented);
}
