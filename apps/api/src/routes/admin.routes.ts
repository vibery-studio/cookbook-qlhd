import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import { EmailSchema, UlidSchema } from "../dto/common";
import { CursorQuery, paginatedResponse } from "../dto/pagination";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";

/**
 * Admin route stubs (Phase 4). `GET /admin/users` requires `users:read`;
 * `PUT /admin/settings/:key` requires `settings:write`. RBAC enforcement
 * lands in Phase 6; System Settings registry (per-key Zod validation) lands
 * in Phase 8 — the `value: unknown` body here is a placeholder shape that
 * Phase 8 replaces with a per-key discriminated schema.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const AdminUserItem = z
  .object({
    id: UlidSchema,
    email: EmailSchema,
    status: z.enum(["pending", "active", "disabled"]),
    roles: z.array(z.string()),
  })
  .openapi("AdminUserItem");

const SettingsKeyParam = z.object({
  key: z.string().min(1).max(128).openapi({ param: { name: "key", in: "path" } }),
});

// Phase 8 narrows this to a per-key discriminated union validated against
// the Settings registry. `z.unknown()` is intentionally used only here (not
// a public response shape) as an explicit placeholder for that follow-up.
const SettingsUpdateBody = z.object({ value: z.unknown() }).openapi("SettingsUpdateRequest");

function notImplemented(c: Context<Env>) {
  return c.json(
    problem(501, "Not Implemented", ProblemType.NotImplemented, {
      instance: c.req.path,
      request_id: c.get("requestId"),
    }),
    501,
  );
}

const listUsersRoute = createRoute({
  method: "get",
  path: "/admin/users",
  tags: ["admin"],
  summary: "List users (cursor-paginated)",
  security: [{ cookieAuth: [] }],
  request: { query: CursorQuery },
  responses: {
    200: {
      description: "Paginated user list",
      content: { "application/json": { schema: paginatedResponse(AdminUserItem) } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing users:read permission",
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

const updateSettingRoute = createRoute({
  method: "put",
  path: "/admin/settings/{key}",
  tags: ["admin"],
  summary: "Update a runtime-mutable system setting",
  security: [{ cookieAuth: [] }],
  request: {
    params: SettingsKeyParam,
    body: { content: { "application/json": { schema: SettingsUpdateBody } } },
  },
  responses: {
    200: {
      description: "Setting updated",
      content: { "application/json": { schema: z.object({ key: z.string(), value: z.unknown() }) } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing settings:write permission",
      content: { "application/json": { schema: ProblemDto } },
    },
    404: {
      description: "Unknown setting key",
      content: { "application/json": { schema: ProblemDto } },
    },
    422: {
      description: "Validation failed",
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

export function adminRoutes(app: OpenAPIHono<Env>): void {
  app.openapi(listUsersRoute, notImplemented);
  app.openapi(updateSettingRoute, notImplemented);
}
