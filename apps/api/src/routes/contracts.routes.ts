import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getDb } from "../db/client";
import { UlidSchema } from "../dto/common";
import {
  ApproveBody,
  ContractAuditQuery,
  ContractListQuery,
  ContractListResponse,
  ContractSchema,
  CreateContractBody,
  EmptyBody,
  RejectBody,
  UpdateContractBody,
  VoidBody,
} from "../dto/contracts";
import { AuditListResponse } from "../dto/audit";
import { problem, ProblemType, problemResponse, type ProblemOptions, type ProblemTypeSlug } from "../dto/error";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";
import { copyContract } from "../services/contract/copy-service";
import { createContract } from "../services/contract/create-service";
import { deleteContract } from "../services/contract/delete-service";
import { decideContract } from "../services/contract/decide-service";
import { issueContract } from "../services/contract/issue-service";
import { contractAudit, contractDetail, listContracts } from "../services/contract/read-service";
import { renderContract } from "../services/contract/render-service";
import { downloadContractPdf } from "../services/contract/pdf-download-service";
import { submitContract } from "../services/contract/submit-service";
import type { BuildFailure, CommandCtx } from "../services/contract/types";
import { updateContract } from "../services/contract/update-service";
import { voidContract } from "../services/contract/void-service";
import { withdrawContract } from "../services/contract/withdraw-service";

type Env = { Bindings: Bindings; Variables: Variables };
type Ctx = Context<Env>;

const IdParam = z.object({ id: UlidSchema });
const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const RENDER_CSP = "default-src 'none'; style-src 'unsafe-inline'";

const json = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

/** Problem+JSON response with the request's instance + id filled in. */
function fail<S extends 401 | 403 | 404 | 409 | 422>(
  c: Ctx,
  status: S,
  title: string,
  slug: ProblemTypeSlug,
  opts: ProblemOptions = {},
) {
  return c.json(
    problem(status, title, slug, { instance: c.req.path, request_id: c.get("requestId"), ...opts }),
    status,
    PROBLEM_HEADERS,
  );
}

const notFound = (c: Ctx, what = "Contract") => fail(c, 404, `${what} not found`, ProblemType.NotFound);
const stateConflict = (c: Ctx, current: string) =>
  fail(c, 409, "Contract is not in a state that allows this", ProblemType.StateConflict, {
    detail: `Hợp đồng đang ở trạng thái "${current}", không thực hiện được thao tác này.`,
    current_status: current,
  });

function buildFailure(c: Ctx, r: BuildFailure) {
  switch (r.kind) {
    case "invalid":
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
}

function cmdCtx(c: Ctx): CommandCtx {
  return { actor: c.get("principal")!, ip: c.req.header("cf-connecting-ip") ?? null, now: new Date() };
}

const baseErrors = {
  401: problemResponse("Not authenticated"),
};

const createRouteDef = createRoute({
  method: "post",
  path: "/contracts",
  tags: ["contracts"],
  summary: "Create a draft contract (prices + totals computed server-side)",
  security,
  request: {
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateContractBody } } },
  },
  responses: {
    201: json(ContractSchema, "Draft created (number = null)"),
    ...baseErrors,
    403: problemResponse("Missing contract:write permission"),
    404: problemResponse("template or customer not found"),
    409: problemResponse("idempotency-conflict"),
    422: problemResponse("validation | missing-fields (missing_fields[]) | unresolved-placeholder (placeholders[])"),
  },
});

const listRouteDef = createRoute({
  method: "get",
  path: "/contracts",
  tags: ["contracts"],
  summary: "List contracts (team-wide) with status counts",
  security,
  request: { query: ContractListQuery },
  responses: {
    200: json(ContractListResponse, "Contracts + counts"),
    ...baseErrors,
    403: problemResponse("Missing contract:read permission"),
    422: problemResponse("Validation failed"),
  },
});

const getRouteDef = createRoute({
  method: "get",
  path: "/contracts/{id}",
  tags: ["contracts"],
  summary: "Contract detail: snapshot, steps, timeline, can{}",
  security,
  request: { params: IdParam },
  responses: {
    200: json(ContractSchema, "Contract"),
    ...baseErrors,
    403: problemResponse("Missing contract:read permission"),
    404: problemResponse("Contract not found"),
  },
});

const patchRouteDef = createRoute({
  method: "patch",
  path: "/contracts/{id}",
  tags: ["contracts"],
  summary: "Edit a draft (creator only, optimistic lock)",
  security,
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: UpdateContractBody } } },
  },
  responses: {
    200: json(ContractSchema, "Draft updated (version + 1)"),
    ...baseErrors,
    403: problemResponse("Missing contract:write, or not the creator (permission.denied)"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict (current_status) | stale"),
    422: problemResponse("validation | missing-fields | unresolved-placeholder"),
  },
});

const submitRouteDef = createRoute({
  method: "post",
  path: "/contracts/{id}/submit",
  tags: ["contracts"],
  summary: "Submit a draft for approval (creator only)",
  security,
  request: { params: IdParam, headers: IdempotencyKeyHeader, body: { content: { "application/json": { schema: EmptyBody } }, required: false } },
  responses: {
    200: json(ContractSchema, "Contract pending, steps created"),
    ...baseErrors,
    403: problemResponse("Missing contract:submit, or not the creator"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict | no-eligible-approver (step_no, label)"),
  },
});

const approveRouteDef = createRoute({
  method: "post",
  path: "/contracts/{id}/approve",
  tags: ["contracts"],
  summary: "Approve the current step",
  security,
  request: { params: IdParam, headers: IdempotencyKeyHeader, body: { content: { "application/json": { schema: ApproveBody } }, required: false } },
  responses: {
    200: json(ContractSchema, "Step approved (contract pending or approved)"),
    ...baseErrors,
    403: problemResponse("Missing permission/role for the step, or SoD (rule: creator_cannot_approve | one_person_one_step)"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict | would-block-later-step (step_no, label) | changed-after-approval"),
  },
});

const rejectRouteDef = createRoute({
  method: "post",
  path: "/contracts/{id}/reject",
  tags: ["contracts"],
  summary: "Reject the contract (note required) — terminal",
  security,
  request: { params: IdParam, headers: IdempotencyKeyHeader, body: { content: { "application/json": { schema: RejectBody } } } },
  responses: {
    200: json(ContractSchema, "Contract rejected"),
    ...baseErrors,
    403: problemResponse("Missing permission/role for the step, or SoD (rule)"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict"),
    422: problemResponse("Validation failed (note required)"),
  },
});

const issueRouteDef = createRoute({
  method: "post",
  path: "/contracts/{id}/issue",
  tags: ["contracts"],
  summary: "Issue an approved contract: gap-free number + stored print",
  security,
  request: { params: IdParam, headers: IdempotencyKeyHeader, body: { content: { "application/json": { schema: EmptyBody } }, required: false } },
  responses: {
    200: json(ContractSchema, "Contract issued (number)"),
    ...baseErrors,
    403: problemResponse("Missing contract:issue permission"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict | changed-after-approval"),
  },
});

const voidRouteDef = createRoute({
  method: "post",
  path: "/contracts/{id}/void",
  tags: ["contracts"],
  summary: "Void an issued contract (reason required; number kept)",
  security,
  request: { params: IdParam, headers: IdempotencyKeyHeader, body: { content: { "application/json": { schema: VoidBody } } } },
  responses: {
    200: json(ContractSchema, "Contract voided"),
    ...baseErrors,
    403: problemResponse("Missing contract:issue permission"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict"),
    422: problemResponse("Validation failed (reason required)"),
  },
});

const copyRouteDef = createRoute({
  method: "post",
  path: "/contracts/{id}/copy",
  tags: ["contracts"],
  summary: "Copy a rejected/voided contract into a new draft (today's prices + current template)",
  security,
  request: { params: IdParam, headers: IdempotencyKeyHeader, body: { content: { "application/json": { schema: EmptyBody } }, required: false } },
  responses: {
    201: json(ContractSchema, "New draft (source_contract_id set)"),
    ...baseErrors,
    403: problemResponse("Missing contract:write permission"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict (source not rejected/voided, or voided already replaced)"),
    422: problemResponse("missing-fields | validation (today's data)"),
  },
});

const renderRouteDef = createRoute({
  method: "get",
  path: "/contracts/{id}/render",
  tags: ["contracts"],
  summary: "Printable HTML (stored bytes once issued; ETag = rendered_hash)",
  security,
  request: { params: IdParam },
  responses: {
    200: {
      description: "HTML; CSP default-src 'none'; ETag when issued",
      content: { "text/html": { schema: z.string() } },
    },
    ...baseErrors,
    403: problemResponse("Missing contract:read permission"),
    404: problemResponse("Contract not found"),
  },
});

const pdfRouteDef = createRoute({
  method: "get",
  path: "/contracts/{id}/pdf",
  tags: ["contracts"],
  summary: "Download the issued PDF (made once after issue; voided keeps the original file)",
  security,
  request: { params: IdParam },
  responses: {
    200: {
      description: 'PDF bytes; Content-Disposition attachment; filename="<number>.pdf"; ETag = sha256 of the file',
      content: { "application/pdf": { schema: z.string().openapi({ type: "string", format: "binary" }) } },
    },
    ...baseErrors,
    403: problemResponse("Missing contract:read permission"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict (not issued; current_status) | pdf-not-ready (pdf_status pending|failed; Retry-After: 60)"),
  },
});

const withdrawRouteDef = createRoute({
  method: "post",
  path: "/contracts/{id}/withdraw",
  tags: ["contracts"],
  summary: "Withdraw a pending contract back to draft (creator only, no step decided yet)",
  security,
  request: { params: IdParam, body: { content: { "application/json": { schema: EmptyBody } }, required: false } },
  responses: {
    200: json(ContractSchema, "Contract back to draft (waiting steps removed, version + 1)"),
    ...baseErrors,
    403: problemResponse("Missing contract:submit permission, or not the creator (rule creator_only)"),
    404: problemResponse("Contract not found"),
    409: problemResponse("already-decided (a step was decided) | state-conflict (not pending)"),
  },
});

const deleteRouteDef = createRoute({
  method: "delete",
  path: "/contracts/{id}",
  tags: ["contracts"],
  summary: "Hard-delete a draft (creator only); audit keeps the id only",
  security,
  request: { params: IdParam },
  responses: {
    204: { description: "Draft deleted" },
    ...baseErrors,
    403: problemResponse("Missing contract:write permission, or not the creator (rule creator_only)"),
    404: problemResponse("Contract not found"),
    409: problemResponse("state-conflict (current_status) — only drafts can be deleted"),
  },
});

const auditRouteDef = createRoute({
  method: "get",
  path: "/contracts/{id}/audit",
  tags: ["contracts"],
  summary: "Audit trail of one contract (newest first)",
  security,
  request: { params: IdParam, query: ContractAuditQuery },
  responses: {
    200: json(AuditListResponse, "Audit events"),
    ...baseErrors,
    403: problemResponse("Missing audit:read permission"),
    404: problemResponse("Contract not found"),
    422: problemResponse("Validation failed"),
  },
});

export function contractsRoutes(app: OpenAPIHono<Env>): void {
  app.on(
    "get",
    ["/contracts", "/contracts/:id", "/contracts/:id/render", "/contracts/:id/pdf"],
    requireAuth(),
    requirePerm("contract:read"),
  );
  app.on("post", "/contracts", requireAuth(), requirePerm("contract:write"), withIdempotency());
  app.on("delete", "/contracts/:id", requireAuth(), requirePerm("contract:write"));
  app.on("patch", "/contracts/:id", requireAuth(), requirePerm("contract:write"));
  app.on("post", "/contracts/:id/submit", requireAuth(), requirePerm("contract:submit"), withIdempotency());
  app.on("post", ["/contracts/:id/approve", "/contracts/:id/reject"], requireAuth(), requirePerm("contract:approve"), withIdempotency());
  app.on("post", ["/contracts/:id/issue", "/contracts/:id/void"], requireAuth(), requirePerm("contract:issue"), withIdempotency());
  app.on("post", "/contracts/:id/withdraw", requireAuth(), requirePerm("contract:submit"));
  app.on("post", "/contracts/:id/copy", requireAuth(), requirePerm("contract:write"), withIdempotency());
  app.on("get", "/contracts/:id/audit", requireAuth(), requirePerm("audit:read"));

  app.openapi(createRouteDef, async (c) => {
    const r = await createContract(getDb(c.env), cmdCtx(c), c.req.valid("json"));
    if (r.kind === "ok") return c.json(r.contract, 201);
    if (r.kind === "not-found") return notFound(c, r.what === "customer" ? "Customer" : "Template");
    return buildFailure(c, r);
  });

  app.openapi(listRouteDef, async (c) => {
    const r = await listContracts(getDb(c.env), c.get("principal")!, c.req.valid("query"));
    if (r.kind === "invalid") return fail(c, 422, "Validation failed", ProblemType.Validation, { errors: r.errors });
    return c.json({ items: r.items, next_cursor: r.next_cursor, counts: r.counts }, 200);
  });

  app.openapi(getRouteDef, async (c) => {
    const d = await contractDetail(getDb(c.env), c.get("principal")!, c.req.valid("param").id);
    return d === null ? notFound(c) : c.json(d, 200);
  });

  app.openapi(patchRouteDef, async (c) => {
    const r = await updateContract(getDb(c.env), cmdCtx(c), c.req.valid("param").id, c.req.valid("json"));
    switch (r.kind) {
      case "ok":
        return c.json(r.contract, 200);
      case "not-found":
        return notFound(c);
      case "forbidden":
        return fail(c, 403, "Forbidden", ProblemType.Forbidden, {
          detail: "Chỉ người tạo mới được sửa hợp đồng nháp.",
          rule: "creator_only",
        });
      case "state-conflict":
        return stateConflict(c, r.current);
      case "stale":
        return fail(c, 409, "Contract was changed by someone else", ProblemType.Stale, {
          detail: "expected_version is out of date; reload the contract and retry.",
        });
      default:
        return buildFailure(c, r);
    }
  });

  app.openapi(submitRouteDef, async (c) => {
    const r = await submitContract(getDb(c.env), cmdCtx(c), c.req.valid("param").id);
    switch (r.kind) {
      case "ok":
        return c.json(r.contract, 200);
      case "not-found":
        return notFound(c);
      case "forbidden":
        return fail(c, 403, "Forbidden", ProblemType.Forbidden, {
          detail: "Chỉ người tạo mới được gửi duyệt hợp đồng này.",
          rule: "creator_only",
        });
      case "state-conflict":
        return stateConflict(c, r.current);
      case "no-eligible-approver":
        return fail(c, 409, "No eligible approver", ProblemType.NoEligibleApprover, {
          detail: `Chưa có người đủ điều kiện cho bước "${r.step.label}"; hãy thêm người có vai trò đó rồi gửi lại.`,
          step_no: r.step.step_no,
          label: r.step.label,
        });
    }
  });

  const decide = (action: "approve" | "reject") => async (c: Ctx, id: string, note: string | undefined) => {
    const r = await decideContract(getDb(c.env), cmdCtx(c), id, { action, note });
    switch (r.kind) {
      case "ok":
        return c.json(r.contract, 200);
      case "not-found":
        return notFound(c);
      case "forbidden-permission":
        return fail(c, 403, "Forbidden", ProblemType.Forbidden, {
          detail: `Bạn không có quyền hoặc vai trò cho bước này (${r.permission}).`,
        });
      case "sod":
        return fail(c, 403, "Forbidden", ProblemType.Forbidden, {
          detail:
            r.rule === "creator_cannot_approve"
              ? "Người tạo hợp đồng không được tự duyệt."
              : "Mỗi người chỉ được quyết một bước của cùng một hợp đồng.",
          rule: r.rule,
        });
      case "would-block-later-step":
        return fail(c, 409, "Would block a later step", ProblemType.WouldBlockLaterStep, {
          detail: `Nếu bạn quyết bước này, bước "${r.step.label}" sẽ không còn ai duyệt được.`,
          step_no: r.step.step_no,
          label: r.step.label,
        });
      case "state-conflict":
        return stateConflict(c, r.current);
    }
  };
  const approve = decide("approve");
  const reject = decide("reject");

  app.openapi(approveRouteDef, async (c) => {
    const body = c.req.valid("json") as { note?: string } | undefined;
    return approve(c, c.req.valid("param").id, body?.note);
  });
  app.openapi(rejectRouteDef, async (c) => reject(c, c.req.valid("param").id, c.req.valid("json").note));

  app.openapi(issueRouteDef, async (c) => {
    const r = await issueContract(getDb(c.env), cmdCtx(c), c.req.valid("param").id);
    switch (r.kind) {
      case "ok":
        return c.json(r.contract, 200);
      case "not-found":
        return notFound(c);
      case "state-conflict":
        return stateConflict(c, r.current);
      case "changed-after-approval":
        return fail(c, 409, "Contract changed after approval", ProblemType.ChangedAfterApproval, {
          detail: "Nội dung hợp đồng đã đổi sau khi được duyệt; cần gửi duyệt lại.",
        });
    }
  });

  app.openapi(voidRouteDef, async (c) => {
    const r = await voidContract(getDb(c.env), cmdCtx(c), c.req.valid("param").id, c.req.valid("json").reason);
    switch (r.kind) {
      case "ok":
        return c.json(r.contract, 200);
      case "not-found":
        return notFound(c);
      case "state-conflict":
        return stateConflict(c, r.current);
    }
  });

  app.openapi(copyRouteDef, async (c) => {
    const r = await copyContract(getDb(c.env), cmdCtx(c), c.req.valid("param").id);
    switch (r.kind) {
      case "ok":
        return c.json(r.contract, 201);
      case "not-found":
        return notFound(c);
      case "state-conflict":
        return stateConflict(c, r.current);
      default:
        return buildFailure(c, r);
    }
  });

  app.openapi(deleteRouteDef, async (c) => {
    const r = await deleteContract(getDb(c.env), cmdCtx(c), c.req.valid("param").id);
    switch (r.kind) {
      case "ok":
        return c.body(null, 204);
      case "not-found":
        return notFound(c);
      case "forbidden":
        return fail(c, 403, "Forbidden", ProblemType.Forbidden, {
          detail: "Chỉ người tạo mới được xóa hợp đồng nháp.",
          rule: "creator_only",
        });
      case "state-conflict":
        return stateConflict(c, r.current);
    }
  });

  app.openapi(withdrawRouteDef, async (c) => {
    const r = await withdrawContract(getDb(c.env), cmdCtx(c), c.req.valid("param").id);
    switch (r.kind) {
      case "ok":
        return c.json(r.contract, 200);
      case "not-found":
        return notFound(c);
      case "forbidden":
        return fail(c, 403, "Forbidden", ProblemType.Forbidden, {
          detail: "Chỉ người tạo mới được rút hợp đồng về nháp.",
          rule: "creator_only",
        });
      case "already-decided":
        return fail(c, 409, "A step was already decided", ProblemType.AlreadyDecided, {
          detail: "Đã có người quyết một bước duyệt nên không rút về nháp được.",
          current_status: "pending",
        });
      case "state-conflict":
        return stateConflict(c, r.current);
    }
  });

  app.openapi(renderRouteDef, async (c) => {
    const r = await renderContract(getDb(c.env), c.req.valid("param").id);
    if (r.kind === "not-found") return notFound(c);
    const headers: Record<string, string> = {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": RENDER_CSP,
    };
    if (r.etag !== null) headers.etag = `"${r.etag}"`;
    return c.body(r.html, 200, headers) as never;
  });

  app.openapi(pdfRouteDef, async (c) => {
    const r = await downloadContractPdf(getDb(c.env), c.env.FILES, c.req.valid("param").id);
    switch (r.kind) {
      case "not-found":
        return notFound(c);
      case "state-conflict":
        return stateConflict(c, r.current);
      case "not-ready":
        c.header("retry-after", "60");
        return fail(c, 409, "PDF is not ready yet", ProblemType.PdfNotReady, {
          detail: r.pdfStatus === "failed" ? "Chưa tạo được PDF, hệ thống sẽ tự thử lại." : "PDF đang được tạo, thử lại sau ít phút.",
          pdf_status: r.pdfStatus,
        });
      case "ok":
        return c.body(r.body, 200, {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${r.filename}"`,
          "content-length": String(r.size),
          etag: `"${r.etag}"`,
          "cache-control": "private, no-cache",
        }) as never;
    }
  });

  app.openapi(auditRouteDef, async (c) => {
    const r = await contractAudit(getDb(c.env), c.req.valid("param").id, c.req.valid("query"));
    if (r === null) return notFound(c);
    if (r.kind === "invalid") return fail(c, 422, "Validation failed", ProblemType.Validation, { errors: r.errors });
    return c.json({ items: r.items, next_cursor: r.next_cursor }, 200);
  });
}
