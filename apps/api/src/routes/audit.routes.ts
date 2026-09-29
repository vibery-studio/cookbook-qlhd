import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { AuditListResponse, AuditQuery } from "../dto/audit";
import { notImplementedProblem, problemResponse } from "../dto/error";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

type Env = { Bindings: Bindings; Variables: Variables };

const listAuditRoute = createRoute({
  method: "get",
  path: "/audit",
  tags: ["audit"],
  summary: "Audit log (newest first, cursor-paginated)",
  security: [{ cookieAuth: [] }],
  request: { query: AuditQuery },
  responses: {
    200: {
      description: "Audit events",
      content: { "application/json": { schema: AuditListResponse } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing audit:read permission"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

export function auditRoutes(app: OpenAPIHono<Env>): void {
  app.use("/audit", requireAuth(), requirePerm("audit:read"));
  app.openapi(listAuditRoute, (c) =>
    c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, {
      "content-type": "application/problem+json",
    }),
  );
}
