import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { UlidSchema } from "../dto/common";
import { notImplementedProblem, problemResponse } from "../dto/error";
import {
  TemplateDetailQuery,
  TemplateDetailSchema,
  TemplateListQuery,
  TemplateListResponse,
} from "../dto/templates";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

type Env = { Bindings: Bindings; Variables: Variables };

const IdParam = z.object({ id: UlidSchema });
const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const listRoute = createRoute({
  method: "get",
  path: "/templates",
  tags: ["templates"],
  summary: "List contract templates with their current version (cursor-paginated)",
  security,
  request: { query: TemplateListQuery },
  responses: {
    200: { description: "Templates", content: { "application/json": { schema: TemplateListResponse } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:read permission"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/templates/{id}",
  tags: ["templates"],
  summary: "Get a template at a version (default: the current version)",
  security,
  request: { params: IdParam, query: TemplateDetailQuery },
  responses: {
    200: { description: "Template", content: { "application/json": { schema: TemplateDetailSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:read permission"),
    404: problemResponse("Template or version_no not found"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

function notImplemented(c: Context<Env>) {
  return c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);
}

export function templatesRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", ["/templates", "/templates/:id"], requireAuth(), requirePerm("contract:read"));
  app.openapi(listRoute, notImplemented);
  app.openapi(getRoute, notImplemented);
}
