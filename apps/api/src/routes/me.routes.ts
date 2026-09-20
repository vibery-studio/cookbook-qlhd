import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import { EmailSchema, UlidSchema } from "../dto/common";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";

/**
 * `GET /me` stub (Phase 4). Real handler lands in Phase 5/6 once auth
 * middleware + RBAC are wired; this only declares the contract.
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

function notImplemented(c: Context<Env>) {
  return c.json(
    problem(501, "Not Implemented", ProblemType.NotImplemented, {
      instance: c.req.path,
      request_id: c.get("requestId"),
    }),
    501,
  );
}

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
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

export function meRoutes(app: OpenAPIHono<Env>): void {
  app.openapi(meRoute, notImplemented);
}
