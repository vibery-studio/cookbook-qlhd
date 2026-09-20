import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { EmailSchema, UlidSchema } from "../dto/common";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { findUserById } from "../dao/user-dao";
import { requireAuth } from "../middleware/auth";

/**
 * `GET /me` (Phase 5). Reads the authenticated principal from context
 * (populated by `requireAuth` middleware) and joins `email` from the D1
 * users table. Roles + permissions are stubbed as empty arrays until
 * Phase 6 (RBAC) fills the real values.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const MeResponse = z
  .object({
    id: UlidSchema,
    email: EmailSchema,
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
  })
  .openapi("MeResponse");

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["me"],
  summary: "Get the current authenticated user",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Current user profile with roles and permissions",
      content: { "application/json": { schema: MeResponse } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

export function meRoutes(app: OpenAPIHono<Env>): void {
  app.use("/me", requireAuth());
  app.openapi(meRoute, async (c) => {
    const principal = c.get("principal");
    if (principal === undefined) {
      return c.json(
        problem(401, "Not authenticated", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
      );
    }
    const db = getDb(c.env);
    const user = await findUserById(db, principal.id);
    if (user === null) {
      return c.json(
        problem(401, "Principal user not found", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
      );
    }
    return c.json(
      {
        id: user.id,
        email: user.email,
        roles: [...principal.roles],
        permissions: [...principal.permissions],
      },
      200,
    );
  });
}
