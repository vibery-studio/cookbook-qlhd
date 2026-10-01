import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { problem, problemResponse, ProblemType } from "../dto/error";
import { CreateRoleBody, DeleteRoleQuery, PatchRoleBody, RoleIdParam, RoleSchema, RolesResponse } from "../dto/roles";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import {
  createRole,
  CUSTOM_ROLE_LIMIT,
  deleteRole,
  listRolesFor,
  patchRole,
  type Forbidden,
  type RoleAdminDeps,
  type RoleGuardRule,
} from "../services/role-admin-service";
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

const PROBLEM = (c: Context<Env>) => ({ instance: c.req.path, request_id: c.get("requestId") });

function forbidden(c: Context<Env>, res: Forbidden) {
  const detail: Record<RoleGuardRule, string> = {
    admin_role: "The admin role is immutable through the API.",
    system_role: "System roles cannot be deleted.",
    own_role: "You cannot edit or delete a role you carry.",
    grant_not_held: "You cannot grant permissions you do not hold.",
  };
  return c.json(
    problem(403, "Forbidden", ProblemType.Forbidden, {
      ...PROBLEM(c),
      detail: detail[res.rule],
      rule: res.rule,
      ...(res.permissions !== undefined && { permissions: res.permissions }),
    }),
    403,
    PROBLEM_HEADERS,
  );
}

const notFound = (c: Context<Env>) =>
  c.json(problem(404, "Role not found", ProblemType.NotFound, PROBLEM(c)), 404, PROBLEM_HEADERS);
const stale = (c: Context<Env>) =>
  c.json(
    problem(409, "Role was changed by someone else", ProblemType.Stale, {
      ...PROBLEM(c),
      detail: "expected_version is out of date; reload the role and retry.",
    }),
    409,
    PROBLEM_HEADERS,
  );
const duplicate = (c: Context<Env>) =>
  c.json(
    problem(409, "Role label already exists", ProblemType.Duplicate, {
      ...PROBLEM(c),
      detail: "Another role already has this display name (case and spacing ignored).",
    }),
    409,
    PROBLEM_HEADERS,
  );

const deps = (c: Context<Env>): RoleAdminDeps => ({
  db: getDb(c.env),
  kv: c.env.SESSIONS,
  now: () => Math.floor(Date.now() / 1000),
});
const ipOf = (c: Context<Env>) => c.req.header("cf-connecting-ip") ?? null;

export function rolesRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", "/roles", requireAuth());
  app.on("post", "/roles", requireAuth(), requirePerm("roles:write"), withIdempotency());
  app.on(["patch", "delete"], "/roles/:id", requireAuth(), requirePerm("roles:write"));

  app.openapi(listRolesRoute, async (c) => {
    const principal = c.get("principal")!;
    return c.json(await listRolesFor(getDb(c.env), principal.id), 200);
  });

  app.openapi(createRoleRoute, async (c) => {
    const principal = c.get("principal")!;
    const body = c.req.valid("json");
    const res = await createRole(deps(c), {
      actorId: principal.id,
      label: body.label,
      description: body.description,
      permissions: body.permissions,
      ip: ipOf(c),
    });
    switch (res.kind) {
      case "ok":
        return c.json(res.role, 201);
      case "duplicate":
        return duplicate(c);
      case "role-limit":
        return c.json(
          problem(409, "Too many custom roles", ProblemType.RoleLimit, {
            ...PROBLEM(c),
            detail: `At most ${CUSTOM_ROLE_LIMIT} custom roles; delete one first.`,
          }),
          409,
          PROBLEM_HEADERS,
        );
      case "forbidden":
        return forbidden(c, res);
    }
  });

  app.openapi(patchRoleRoute, async (c) => {
    const principal = c.get("principal")!;
    const body = c.req.valid("json");
    const res = await patchRole(deps(c), {
      actorId: principal.id,
      roleId: c.req.valid("param").id,
      expectedVersion: body.expected_version,
      label: body.label,
      description: body.description,
      permissions: body.permissions,
      ip: ipOf(c),
    });
    switch (res.kind) {
      case "ok":
        return c.json(res.role, 200);
      case "not-found":
        return notFound(c);
      case "stale":
        return stale(c);
      case "duplicate":
        return duplicate(c);
      case "forbidden":
        return forbidden(c, res);
    }
  });

  app.openapi(deleteRoleRoute, async (c) => {
    const principal = c.get("principal")!;
    const res = await deleteRole(deps(c), {
      actorId: principal.id,
      roleId: c.req.valid("param").id,
      expectedVersion: c.req.valid("query").expected_version,
      ip: ipOf(c),
    });
    switch (res.kind) {
      case "ok":
        return c.body(null, 204);
      case "not-found":
        return notFound(c);
      case "stale":
        return stale(c);
      case "role-in-use":
        return c.json(
          problem(409, "Role is in use", ProblemType.RoleInUse, {
            ...PROBLEM(c),
            detail: `${res.holders} user(s) carry this role; move them to another role first.`,
            holders: res.holders,
          }),
          409,
          PROBLEM_HEADERS,
        );
      case "forbidden":
        return forbidden(c, res);
    }
  });
}
