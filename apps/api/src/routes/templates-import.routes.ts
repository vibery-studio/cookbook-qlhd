import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { problem, ProblemType, problemResponse } from "../dto/error";
import { TemplateImportPreviewSchema, TemplateImportQuery } from "../dto/template-import";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { previewImport } from "../services/template-import-service";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-10 §3.4 / PLAN-10 §2b — stateless preview of a .docx import. Contract locked by C-10-001; handler C-10-003
 * (415 check → bytes → service). Not idempotent-wrapped: it writes nothing.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const DOCX_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 2 * 1024 * 1024;
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const previewRoute = createRoute({
  method: "post",
  path: "/templates/import/preview",
  tags: ["templates"],
  summary: "Preview a Word (.docx) template import: placeholders, suggested fields, base policy, warnings (director only; stores nothing)",
  security: [{ cookieAuth: [] }],
  request: {
    query: TemplateImportQuery,
    body: {
      required: true,
      content: { [DOCX_CT]: { schema: z.string().openapi({ type: "string", format: "binary" }) } },
    },
  },
  responses: {
    200: { description: "Preview", content: { "application/json": { schema: TemplateImportPreviewSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing template:write permission (permission.denied audited)"),
    404: problemResponse("template_id not found"),
    413: problemResponse("payload-too-large: file over 2 MB"),
    415: problemResponse("unsupported-media-type: Content-Type is not the .docx type"),
    422: problemResponse(
      "validation (lines_table beyond the table count) | docx-invalid with `reason` (not_docx | macro_enabled | no_document | xml_invalid | too_large_inflated | too_many_entries)",
    ),
    // TODO(driver): drop with the next `pnpm openapi:export && pnpm client:generate` (handler is live since C-10-003)
    501: problemResponse("Not implemented"),
  },
});

export function templatesImportRoutes(app: OpenAPIHono<Env>): void {
  app.on(
    "post",
    "/templates/import/preview",
    bodyLimit({
      maxSize: MAX_BYTES,
      onError: (c: Context<Env>) =>
        c.json(
          problem(413, "File too large", ProblemType.PayloadTooLarge, {
            detail: "The .docx file is larger than 2 MB.",
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          413,
          PROBLEM_HEADERS,
        ),
    }),
    requireAuth(),
    requirePerm("template:write"),
  );

  app.openapi(previewRoute, async (c) => {
    const base = { instance: c.req.path, request_id: c.get("requestId") };
    const mediaType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (mediaType !== DOCX_CT) {
      return c.json(
        problem(415, "Unsupported media type", ProblemType.UnsupportedMediaType, {
          ...base,
          detail: "Chỉ nhận file Word .docx.",
        }),
        415,
        PROBLEM_HEADERS,
      );
    }
    const q = c.req.valid("query");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const res = await previewImport(
      { db: getDb(c.env) },
      {
        bytes,
        ...(q.template_id !== undefined && { templateId: q.template_id }),
        ...(q.lines_table !== undefined && { linesTable: q.lines_table }),
      },
    );
    switch (res.kind) {
      case "ok":
        return c.json(res.preview, 200);
      case "not_found":
        return c.json(problem(404, "Template not found", ProblemType.NotFound, base), 404, PROBLEM_HEADERS);
      case "invalid":
        return c.json(
          problem(422, "Validation failed", ProblemType.Validation, {
            ...base,
            detail: "lines_table không trỏ tới bảng nào có trường.",
            errors: res.errors,
          }),
          422,
          PROBLEM_HEADERS,
        );
      case "docx_invalid":
        return c.json(
          problem(422, "Invalid .docx file", ProblemType.DocxInvalid, {
            ...base,
            detail: "File không đọc được như một tài liệu Word .docx hợp lệ.",
            reason: res.reason,
          }),
          422,
          PROBLEM_HEADERS,
        );
    }
  });
}
