import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { UlidSchema } from "../dto/common";
import { problem, ProblemType, problemResponse } from "../dto/error";
import {
  TemplateDetailQuery,
  TemplateDetailSchema,
  TemplateListQuery,
  TemplateListResponse,
} from "../dto/templates";
import { getDb } from "../db/client";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { listTemplatePage, readTemplate } from "../services/template-read-service";

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
  },
});

export function templatesRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", ["/templates", "/templates/:id"], requireAuth(), requirePerm("contract:read"));

  app.openapi(listRoute, async (c) => {
    const res = await listTemplatePage(getDb(c.env), c.req.valid("query"));
    if (res.kind === "invalid") {
      return c.json(
        problem(422, "Validation failed", ProblemType.Validation, {
          errors: res.errors,
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        422,
        PROBLEM_HEADERS,
      );
    }
    return c.json({ items: res.items, next_cursor: res.next_cursor }, 200);
  });

  app.openapi(getRoute, async (c) => {
    const res = await readTemplate(getDb(c.env), c.req.valid("param").id, c.req.valid("query").version_no);
    if (res.kind === "not_found") {
      return c.json(
        problem(404, "Template or version not found", ProblemType.NotFound, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        404,
        PROBLEM_HEADERS,
      );
    }
    return c.json(res.template, 200);
  });
}
