import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { UlidSchema } from "../dto/common";
import { notImplementedProblem, problemResponse } from "../dto/error";
import {
  CreateTemplateBody,
  CreateTemplateVersionBody,
  TemplateDetailSchema,
  TemplateVersionSchema,
} from "../dto/templates";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";

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
    501: problemResponse("Not implemented"),
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
    201: { description: "Version appended", content: { "application/json": { schema: TemplateVersionSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing template:write permission"),
    404: problemResponse("Template not found"),
    409: problemResponse("stale: expected_version_no is not the current version"),
    422: problemResponse("validation (shape) or template-check-failed (errors[] with code/key/source)"),
    501: problemResponse("Not implemented"),
  },
});

function notImplemented(c: Context<Env>) {
  return c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);
}

export function templatesWriteRoutes(app: OpenAPIHono<Env>): void {
  app.on(
    "post",
    ["/templates", "/templates/:id/versions"],
    requireAuth(),
    requirePerm("template:write"),
    withIdempotency(),
  );
  app.openapi(createTemplateRoute, notImplemented);
  app.openapi(createVersionRoute, notImplemented);
}
