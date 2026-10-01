import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { problem, ProblemType, problemResponse } from "../dto/error";
import { TemplateImportPreviewSchema, TemplateImportQuery } from "../dto/template-import";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-10 §3.4 / PLAN-10 §2b — stateless preview of a .docx import. Contract locked by C-10-001 (middleware real,
 * handler 501); handler by C-10-003. Not idempotent-wrapped: it writes nothing.
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

  app.openapi(previewRoute, (c) =>
    c.json(
      problem(501, "Not Implemented", ProblemType.NotImplemented, {
        instance: c.req.path,
        request_id: c.get("requestId"),
      }),
      501,
      PROBLEM_HEADERS,
    ),
  );
}
