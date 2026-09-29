import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { problemResponse } from "../dto/error";
import { RolesResponse } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { listRolesWithPermissions } from "../dao/role-dao";
import { requireAuth } from "../middleware/auth";

type Env = { Bindings: Bindings; Variables: Variables };

const listRolesRoute = createRoute({
  method: "get",
  path: "/roles",
  tags: ["roles"],
  summary: "Role x permission matrix",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Roles with their permissions",
      content: { "application/json": { schema: RolesResponse } },
    },
    401: problemResponse("Not authenticated"),
  },
});

export function rolesRoutes(app: OpenAPIHono<Env>): void {
  app.use("/roles", requireAuth());
  app.openapi(listRolesRoute, async (c) => {
    const items = await listRolesWithPermissions(getDb(c.env));
    return c.json({ items }, 200);
  });
}
