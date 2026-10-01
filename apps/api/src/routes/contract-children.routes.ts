import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { UlidSchema } from "../dto/common";
import { ContractSchema, CreateChildBody } from "../dto/contracts";
import { notImplementedProblem, problemResponse } from "../dto/error";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-09 §3.6 / PLAN-09 §2b — make a child document (HĐ from a BG, DNTT from a HĐ) with the parent's frozen lines.
 * Contract locked by C-09-002 (middleware real, handler 501); handler by C-09-007. Route gate = `contract:read`; the
 * service checks `WRITE_PERM[type]` of the child (DEC-10 B, P-3).
 */

type Env = { Bindings: Bindings; Variables: Variables };

const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const createChildRoute = createRoute({
  method: "post",
  path: "/contracts/{id}/children",
  tags: ["contracts"],
  summary: "Make a child document from an issued parent (BG → HĐ, HĐ → DNTT); lines + prices frozen from the parent",
  security: [{ cookieAuth: [] }],
  request: {
    params: z.object({ id: UlidSchema }),
    headers: IdempotencyKeyHeader,
    body: { required: true, content: { "application/json": { schema: CreateChildBody } } },
  },
  responses: {
    201: { description: "Child draft created (number = null)", content: { "application/json": { schema: ContractSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:read, or the child type's write code (quote:write | contract:write | payment_request:write | delivery_note:write; permission.denied audited)"),
    404: problemResponse("Parent (or template_id) not found"),
    409: problemResponse(
      "parent-not-issued | quote-expired | child-exists (existing_id = the live child) | idempotency-conflict",
    ),
    422: problemResponse(
      "validation (schema; errors[].path `lines` = the BG breaks the HĐ line rule, DEC-7) | child-type (pair not in CHILD_OF) | lines-locked (values.giam_gia sent) | template-type (template of another type) | nothing-to-pay (HĐ total 0) | missing-fields (missing_fields[])",
    ),
    501: problemResponse("Not implemented"),
  },
});

export function contractChildrenRoutes(app: OpenAPIHono<Env>): void {
  app.on("post", "/contracts/:id/children", requireAuth(), requirePerm("contract:read"), withIdempotency());

  app.openapi(createChildRoute, (c) =>
    c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS),
  );
}
