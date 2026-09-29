import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { EmailSchema, UlidSchema } from "../dto/common";
import { ProblemDto } from "../dto/error";
import { CursorQuery, paginatedResponse } from "../dto/pagination";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { listUsers } from "../services/admin-service";

/**
 * Admin user-management routes. RBAC is enforced by `requirePerm`
 * after `requireAuth` populates the principal. Settings routes live
 * in `admin-settings.routes.ts` (Phase 8) so this file stays focused
 * on user CRUD.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const AdminUserItem = z
  .object({
    id: UlidSchema,
    email: EmailSchema,
    display_name: z.string().nullable(),
    status: z.enum(["pending", "active", "disabled"]),
    roles: z.array(z.string()),
  })
  .openapi("AdminUserItem");

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
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing users:read permission",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

export function adminRoutes(app: OpenAPIHono<Env>): void {
  app.use("/admin/users", requireAuth(), requirePerm("users:read"));

  app.openapi(listUsersRoute, async (c) => {
    const query = c.req.valid("query");
    const db = getDb(c.env);
    const page = await listUsers(
      { db, kv: c.env.SESSIONS, env: c.env },
      { cursor: query.cursor, limit: query.limit },
    );
    // TODO(C-01-004): read display_name from the DAO; the service does not carry it yet.
    return c.json(
      { ...page, items: page.items.map((u) => ({ ...u, display_name: null })) },
      200,
    );
  });
}
