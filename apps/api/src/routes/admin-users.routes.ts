import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { UlidSchema } from "../dto/common";
import { problem, problemResponse, ProblemType } from "../dto/error";
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
import { getDb } from "../db/client";
import {
  activationUrl,
  inviteUser,
  reinviteUser,
  updateUser,
  type AdminUserView,
  type EscalationRule,
  type UserAdminDeps,
} from "../services/user-admin-service";


type Env = { Bindings: Bindings; Variables: Variables };

const ESCALATION_DETAIL: Record<EscalationRule, string> = {
  self_role: "Không tự đổi vai trò của mình.",
  admin_only: "Chỉ Quản trị hệ thống mới gán vai trò Quản trị hệ thống hoặc sửa tài khoản quản trị.",
};

function escalationProblem(rule: EscalationRule, instance: string, requestId: string | undefined) {
  return problem(403, "Forbidden", ProblemType.Forbidden, {
    detail: ESCALATION_DETAIL[rule],
    rule,
    instance,
    request_id: requestId,
  });
}

/**
 * TEMPORARY (C-06-002 → removed in C-06-004): `role` is now a string in the contract, but the service still only
 * knows the seed roles. Anything else → 422 `unknown-role` here, so no user can end up with a role that may vanish.
 */
const ASSIGNABLE_ROLES_UNTIL_C06004 = new Set(["giam_doc", "quan_ly", "nhan_vien", "admin"]);

function unknownRoleProblem(instance: string, requestId: string | undefined) {
  return problem(422, "Unknown role", ProblemType.UnknownRole, {
    detail: "Vai trò không tồn tại.",
    instance,
    request_id: requestId,
  });
}

const IdParam = z.object({ id: UlidSchema });
const security = [{ cookieAuth: [] }];

function deps(env: Bindings): UserAdminDeps {
  return { db: getDb(env), kv: env.SESSIONS, env, now: () => Math.floor(Date.now() / 1000) };
}

function toDto(u: AdminUserView) {
  return { id: u.id, email: u.email, display_name: u.displayName, status: u.status, roles: u.roles };
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
    403: problemResponse("Missing users:write permission, or rule admin_only (only an admin assigns the admin role)"),
    409: problemResponse("Email already registered"),
    422: problemResponse("Validation failed, or unknown-role (role name does not exist / is not assignable)"),
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
    403: problemResponse(
      "Missing users:write permission, or rule self_role (own role) | admin_only (only an admin assigns the admin role or edits an admin user)",
    ),
    404: problemResponse("User not found"),
    409: problemResponse("last_admin: cannot disable or demote the last active admin"),
    422: problemResponse("Validation failed, or unknown-role (role name does not exist / is not assignable)"),
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

  app.openapi(createUserRoute, async (c) => {
    const body = c.req.valid("json");
    const actor = c.get("principal")!;
    if (!ASSIGNABLE_ROLES_UNTIL_C06004.has(body.role)) {
      return c.json(unknownRoleProblem(c.req.path, c.get("requestId")), 422, { "content-type": "application/problem+json" });
    }
    const res = await inviteUser(deps(c.env), {
      actorId: actor.id,
      email: body.email,
      displayName: body.display_name,
      role: body.role,
      ip: c.req.header("cf-connecting-ip") ?? null,
    });
    if (res.kind === "forbidden") {
      return c.json(escalationProblem(res.rule, c.req.path, c.get("requestId")), 403, {
        "content-type": "application/problem+json",
      });
    }
    if (res.kind === "duplicate-email") {
      return c.json(
        problem(409, "Email already registered", ProblemType.Conflict, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        409,
        { "content-type": "application/problem+json" },
      );
    }
    return c.json(
      {
        user: toDto(res.user),
        activation_url: activationUrl(c.env, res.rawToken),
        expires_at: res.expiresAt,
      },
      201,
    );
  });

  app.openapi(updateUserRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = c.get("principal")!;
    if (body.role !== undefined && !ASSIGNABLE_ROLES_UNTIL_C06004.has(body.role)) {
      return c.json(unknownRoleProblem(c.req.path, c.get("requestId")), 422, { "content-type": "application/problem+json" });
    }
    const res = await updateUser(deps(c.env), {
      actorId: actor.id,
      userId: id,
      role: body.role,
      status: body.status,
      displayName: body.display_name,
      ip: c.req.header("cf-connecting-ip") ?? null,
    });
    const opts = { instance: c.req.path, request_id: c.get("requestId") };
    const hdr = { "content-type": "application/problem+json" };
    if (res.kind === "not-found") {
      return c.json(problem(404, "User not found", ProblemType.NotFound, opts), 404, hdr);
    }
    if (res.kind === "forbidden") {
      return c.json(escalationProblem(res.rule, c.req.path, c.get("requestId")), 403, hdr);
    }
    if (res.kind === "last-admin") {
      return c.json(
        problem(409, "Cannot disable or demote the last active admin", ProblemType.LastAdmin, opts),
        409,
        hdr,
      );
    }
    if (res.kind === "pending") {
      return c.json(
        problem(409, "User has not activated yet; re-send the invite instead", ProblemType.Conflict, opts),
        409,
        hdr,
      );
    }
    return c.json(toDto(res.user), 200);
  });

  app.openapi(reinviteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const actor = c.get("principal")!;
    const res = await reinviteUser(deps(c.env), { actorId: actor.id, userId: id });
    const opts = { instance: c.req.path, request_id: c.get("requestId") };
    const hdr = { "content-type": "application/problem+json" };
    if (res.kind === "not-found") {
      return c.json(problem(404, "User not found", ProblemType.NotFound, opts), 404, hdr);
    }
    if (res.kind === "already-active") {
      return c.json(problem(409, "User has already activated", ProblemType.AlreadyActive, opts), 409, hdr);
    }
    return c.json({ activation_url: activationUrl(c.env, res.rawToken), expires_at: res.expiresAt }, 200);
  });
}
