import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { getDb } from "../db/client";
import { ApprovalQueueQuery, ApprovalQueueResponse } from "../dto/contracts";
import { problem, ProblemType, problemResponse } from "../dto/error";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { approvalQueue } from "../services/contract/read-service";

type Env = { Bindings: Bindings; Variables: Variables };
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const mineRoute = createRoute({
  method: "get",
  path: "/approvals/mine",
  tags: ["contracts"],
  summary: "Approval steps the caller may act on now (permission + role, not creator, not yet decided)",
  security: [{ cookieAuth: [] }],
  request: { query: ApprovalQueueQuery },
  responses: {
    200: { description: "Queue", content: { "application/json": { schema: ApprovalQueueResponse } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:approve permission"),
    422: problemResponse("Validation failed"),
  },
});

export function approvalsRoutes(app: OpenAPIHono<Env>): void {
  app.use("/approvals/mine", requireAuth(), requirePerm("contract:approve"));
  app.openapi(mineRoute, async (c) => {
    const base = { instance: c.req.path, request_id: c.get("requestId") };
    const r = await approvalQueue(getDb(c.env), c.get("principal")!, c.req.valid("query"));
    if (r.kind === "invalid") {
      return c.json(
        problem(422, "Validation failed", ProblemType.Validation, { ...base, errors: r.errors }),
        422,
        PROBLEM_HEADERS,
      );
    }
    return c.json({ items: r.items, next_cursor: r.next_cursor }, 200);
  });
}
