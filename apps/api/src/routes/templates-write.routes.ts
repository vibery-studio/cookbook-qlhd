import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { UlidSchema } from "../dto/common";
import { problem, ProblemType, problemResponse } from "../dto/error";
import {
  CreateTemplateBody,
  CreateTemplateVersionBody,
  TemplateDetailSchema,
} from "../dto/templates";
import { IdempotencyKeyHeader } from "../dto/users";
import { getDb } from "../db/client";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";
import { addTemplateVersion, createTemplate, type WriteOutcome } from "../services/template-write-service";

type Env = { Bindings: Bindings; Variables: Variables };

const IdParam = z.object({ id: UlidSchema });
const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const createTemplateRoute = createRoute({
  method: "post",
  path: "/templates",
  tags: ["templates"],
  summary: "Create a template with its version 1 (director only)",
  security,
  request: {
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateTemplateBody } } },
  },
  responses: {
    201: { description: "Template created at v1", content: { "application/json": { schema: TemplateDetailSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing template:write permission"),
    409: problemResponse("duplicate name; body carries existing_id"),
    422: problemResponse("validation (shape) or template-check-failed (errors[] with code/key/source)"),
  },
});

const createVersionRoute = createRoute({
  method: "post",
  path: "/templates/{id}/versions",
  tags: ["templates"],
  summary: "Append a new version; it becomes current (director only)",
  security,
  request: {
    params: IdParam,
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateTemplateVersionBody } } },
  },
  responses: {
    201: { description: "Version appended", content: { "application/json": { schema: TemplateDetailSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing template:write permission"),
    404: problemResponse("Template not found"),
    409: problemResponse("stale: expected_version_no is not the current version"),
    422: problemResponse("validation (shape) or template-check-failed (errors[] with code/key/source)"),
  },
});

type Failure = Exclude<WriteOutcome, { kind: "ok" | "not_found" }>;

function failure(c: Context<Env>, res: Failure) {
  const base = { instance: c.req.path, request_id: c.get("requestId") };
  switch (res.kind) {
    case "check_failed":
      return c.json(
        problem(422, "Template check failed", ProblemType.TemplateCheckFailed, { ...base, errors: res.errors }),
        422,
        PROBLEM_HEADERS,
      );
    case "stale":
      return c.json(
        problem(409, "Template changed", ProblemType.Stale, {
          ...base,
          detail: "expected_version_no is not the current version; reload and retry.",
        }),
        409,
        PROBLEM_HEADERS,
      );
    case "duplicate":
      return c.json(
        problem(409, "Template name already exists", ProblemType.Duplicate, {
          ...base,
          detail: "A template with this name already exists.",
          ...(res.existingId !== null && { existing_id: res.existingId }),
        }),
        409,
        PROBLEM_HEADERS,
      );
  }
}

export function templatesWriteRoutes(app: OpenAPIHono<Env>): void {
  app.on(
    "post",
    ["/templates", "/templates/:id/versions"],
    requireAuth(),
    requirePerm("template:write"),
    withIdempotency(),
  );
  app.openapi(createTemplateRoute, async (c) => {
    const principal = c.get("principal")!;
    const res = await createTemplate(
      getDb(c.env),
      { id: principal.id, ip: c.req.header("cf-connecting-ip") ?? null },
      c.req.valid("json"),
    );
    return res.kind === "ok" ? c.json(res.template, 201) : failure(c, res);
  });

  app.openapi(createVersionRoute, async (c) => {
    const principal = c.get("principal")!;
    const res = await addTemplateVersion(
      getDb(c.env),
      { id: principal.id, ip: c.req.header("cf-connecting-ip") ?? null },
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    if (res.kind === "not_found") {
      return c.json(
        problem(404, "Template not found", ProblemType.NotFound, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        404,
        PROBLEM_HEADERS,
      );
    }
    return res.kind === "ok" ? c.json(res.template, 201) : failure(c, res);
  });
}
