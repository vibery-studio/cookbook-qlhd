import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ProblemDto } from "../dto/error";
import { CursorQuery } from "../dto/pagination";
import { AdminUsersPageSchema } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { listUsersFor } from "../services/user-admin-service";

/**
 * Admin user-management routes. RBAC is enforced by `requirePerm`
 * after `requireAuth` populates the principal. Settings routes live
 * in `admin-settings.routes.ts` (Phase 8) so this file stays focused
 * on user CRUD.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const listUsersRoute = createRoute({
  method: "get",
  path: "/admin/users",
  tags: ["admin"],
  summary: "List users (cursor-paginated) with what the caller may do to each (FIX-06)",
  security: [{ cookieAuth: [] }],
  request: { query: CursorQuery },
  responses: {
    200: {
      description: "Paginated user list",
      content: { "application/json": { schema: AdminUsersPageSchema } },
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
  // GET only: POST /admin/users (invite) carries its own `users:write` guard, so a refused invite is
  // audited with the permission it actually lacked.
  app.on("GET", "/admin/users", requireAuth(), requirePerm("users:read"));

  app.openapi(listUsersRoute, async (c) => {
    const query = c.req.valid("query");
    const principal = c.get("principal")!;
    const page = await listUsersFor(getDb(c.env), {
      actorId: principal.id,
      callerPermissions: principal.permissions,
      cursor: query.cursor,
      limit: query.limit,
      now: Math.floor(Date.now() / 1000),
    });
    return c.json(
      {
        items: page.items.map(({ displayName, ...u }) => ({ ...u, display_name: displayName })),
        next_cursor: page.next_cursor,
        invite_roles: page.invite_roles,
      },
      200,
    );
  });
}
