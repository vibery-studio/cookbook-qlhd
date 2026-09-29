import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { notImplementedProblem, problemResponse } from "../dto/error";
import { RolesResponse } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
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
    501: problemResponse("Not implemented"),
  },
});

export function rolesRoutes(app: OpenAPIHono<Env>): void {
  app.use("/roles", requireAuth());
  app.openapi(listRolesRoute, (c) =>
    c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, {
      "content-type": "application/problem+json",
    }),
  );
}
