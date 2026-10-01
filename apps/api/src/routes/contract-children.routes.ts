import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getDb } from "../db/client";
import { writeAuditEvent } from "../dao/audit-dao";
import { UlidSchema } from "../dto/common";
import { ContractSchema, CreateChildBody } from "../dto/contracts";
import { problem, ProblemType, problemResponse, type ProblemOptions, type ProblemTypeSlug } from "../dto/error";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";
import { createChild } from "../services/contract/children-service";

/**
 * SPEC-09 §3.6 / PLAN-09 §2b — make a child document (HĐ from a BG, DNTT from a HĐ) with the parent's frozen lines.
 * Contract locked by C-09-002; handler by C-09-007. Route gate = `contract:read`; the
 * service checks `WRITE_PERM[type]` of the child (DEC-10 B, P-3).
 */

type Env = { Bindings: Bindings; Variables: Variables };
type Ctx = Context<Env>;

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
  },
});

function fail<S extends 403 | 404 | 409 | 422>(c: Ctx, status: S, title: string, slug: ProblemTypeSlug, opts: ProblemOptions = {}) {
  return c.json(
    problem(status, title, slug, { instance: c.req.path, request_id: c.get("requestId"), ...opts }),
    status,
    PROBLEM_HEADERS,
  );
}

export function contractChildrenRoutes(app: OpenAPIHono<Env>): void {
  app.on("post", "/contracts/:id/children", requireAuth(), requirePerm("contract:read"), withIdempotency());

  app.openapi(createChildRoute, async (c) => {
    const principal = c.get("principal")!;
    const ip = c.req.header("cf-connecting-ip") ?? null;
    const db = getDb(c.env);
    const r = await createChild(db, { actor: principal, ip, now: new Date() }, c.req.valid("param").id, c.req.valid("json"));
    switch (r.kind) {
      case "ok":
        return c.json(r.contract, 201);
      case "not-found":
        return fail(c, 404, `${r.what === "contract" ? "Contract" : r.what === "template" ? "Template" : "Customer"} not found`, ProblemType.NotFound);
      case "child-type":
        return fail(c, 422, "This document type cannot be made from this parent", ProblemType.ChildType, {
          detail: "Chỉ lập được hợp đồng từ báo giá và đề nghị thanh toán từ hợp đồng.",
        });
      case "forbidden": {
        // P-3: the per-type write code is checked in the service; the denial is audited before the 403 (like requirePerm)
        const meta = { permission: r.permission, method: c.req.method, path: c.req.path };
        await writeAuditEvent(db, { actor: principal.id, action: "permission.denied", target: c.req.path, metadata: meta, ip });
        return fail(c, 403, "Forbidden", ProblemType.Forbidden, { detail: `Bạn không có quyền ${r.permission}.` });
      }
      case "lines-locked":
        return fail(c, 422, "Lines and discount are locked to the parent", ProblemType.LinesLocked, {
          detail: "Tài liệu con giữ nguyên dòng và giảm giá của tài liệu cha.",
        });
      case "template-type":
        return fail(c, 422, "Template is of another document type", ProblemType.TemplateType, {
          detail: "Mẫu đã chọn không dùng cho loại tài liệu này.",
        });
      case "parent-not-issued":
        return fail(c, 409, "Parent is not issued", ProblemType.ParentNotIssued, {
          detail: "Chỉ lập tài liệu con từ tài liệu đã phát hành.",
          current_status: r.current,
        });
      case "quote-expired":
        return fail(c, 409, "Quote has expired", ProblemType.QuoteExpired, {
          detail: r.validUntil === null ? "Báo giá không có hạn hiệu lực." : `Báo giá đã hết hạn (hiệu lực đến ${r.validUntil}).`,
        });
      case "nothing-to-pay":
        return fail(c, 422, "Nothing to request", ProblemType.NothingToPay, {
          detail: "Hợp đồng có tổng tiền 0 đ, không có gì để đề nghị thanh toán.",
        });
      case "child-exists":
        return fail(c, 409, "A live child of this type already exists", ProblemType.ChildExists, {
          detail: "Tài liệu cha đã có một tài liệu con loại này chưa bị hủy/từ chối.",
          ...(r.existingId === null ? {} : { existing_id: r.existingId }),
        });
      case "invalid":
        return fail(c, 422, "Validation failed", ProblemType.Validation, { errors: r.errors });
      case "line-invalid":
        return fail(c, 422, "Validation failed", ProblemType.Validation, { errors: r.errors });
      case "missing-fields":
        return fail(c, 422, "Missing required fields", ProblemType.MissingFields, {
          detail: `Thiếu: ${r.missing.map((m) => m.label).join(", ")}.`,
          missing_fields: r.missing,
        });
      case "unresolved-placeholder":
        return fail(c, 422, "Template has unresolved placeholders", ProblemType.UnresolvedPlaceholder, {
          placeholders: r.placeholders,
        });
    }
  });
}
