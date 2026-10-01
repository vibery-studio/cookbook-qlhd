import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { writeAuditEvent } from "../dao/audit-dao";
import { problem, problemResponse, ProblemType } from "../dto/error";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { getTwoLayer, setTwoLayer } from "../services/security-service";

/**
 * C-11-001 — cơ chế duyệt 2 lớp khi đổi quyền (two-layer approval of role permission changes).
 *   GET /security/two-layer  → roles:write OR security:write (the Phân quyền screen and the Bảo mật screen)
 *   PUT /security/two-layer  → security:write (the seeder-only `root` role)
 */
type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const tags = ["security"];

export const TwoLayerSchema = z
  .object({
    enabled: z.boolean(),
    updated_at: z.number().int().nullable(),
    updated_by_name: z.string().nullable(),
  })
  .openapi("TwoLayerSetting");

const TwoLayerBody = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict()
  .openapi("TwoLayerUpdateRequest");

const getRoute = createRoute({
  method: "get",
  path: "/security/two-layer",
  tags,
  summary: "Two-layer approval of role permission changes: on (default) or off",
  security,
  responses: {
    200: { description: "Current state", content: { "application/json": { schema: TwoLayerSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Needs roles:write or security:write (one permission.denied row)"),
  },
});

const putRoute = createRoute({
  method: "put",
  path: "/security/two-layer",
  tags,
  summary:
    "Turn two-layer approval on/off (reason required). Off: admin / Giám đốc change role permissions directly via PUT /roles/{id}/permissions",
  security,
  request: { body: { content: { "application/json": { schema: TwoLayerBody } } } },
  responses: {
    200: {
      description: "State after the write (same value → nothing written, no audit row)",
      content: { "application/json": { schema: TwoLayerSchema } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing security:write"),
    422: problemResponse("Validation failed (reason 10–500)"),
  },
});

export function securityRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", "/security/two-layer", requireAuth());
  app.on("put", "/security/two-layer", requireAuth(), requirePerm("security:write"));

  app.openapi(getRoute, async (c) => {
    const principal = c.get("principal")!;
    const db = getDb(c.env);
    if (!principal.permissions.includes("roles:write") && !principal.permissions.includes("security:write")) {
      await writeAuditEvent(db, {
        actor: principal.id,
        action: "permission.denied",
        target: c.req.path,
        metadata: { permission: "security:write", method: "GET", path: c.req.path },
        ip: c.req.header("cf-connecting-ip") ?? null,
      });
      return c.json(
        problem(403, "Forbidden", ProblemType.Forbidden, {
          detail: "Needs roles:write or security:write.",
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        403,
        { "content-type": "application/problem+json" },
      );
    }
    return c.json(await getTwoLayer(db), 200);
  });

  app.openapi(putRoute, async (c) => {
    const principal = c.get("principal")!;
    const body = c.req.valid("json");
    const view = await setTwoLayer(
      { db: getDb(c.env), now: () => Math.floor(Date.now() / 1000) },
      { actorId: principal.id, enabled: body.enabled, reason: body.reason, ip: c.req.header("cf-connecting-ip") ?? null },
    );
    return c.json(view, 200);
  });
}
