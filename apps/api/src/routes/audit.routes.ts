import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { AuditListResponse, AuditQuery } from "../dto/audit";
import { problem, ProblemType, problemResponse } from "../dto/error";
import { listAudit } from "../dao/audit-dao";
import { getDb } from "../db/client";
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
  app.openapi(listAuditRoute, async (c) => {
    const q = c.req.valid("query");
    const result = await listAudit(getDb(c.env), q);
    if (result.kind === "bad-cursor") {
      return c.json(
        problem(422, "Validation failed", ProblemType.Validation, {
          detail: "invalid cursor",
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        422,
        { "content-type": "application/problem+json" },
      );
    }
    return c.json({ items: result.items, next_cursor: result.nextCursor }, 200);
  });
}
