import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { FLAG_REGISTRY, isFlagKey } from "../flags/registry";
import { FlagsService } from "../flags/flags-service";

/**
 * Admin flags routes (Phase 2 v1.1). RBAC:
 *   - GET /admin/flags        → flags:read
 *   - GET /admin/flags/:key   → flags:read
 *   - PUT /admin/flags/:key   → flags:write
 *
 * PUT body accepts partial updates: `{ enabled?, percentage?, allowlist? }`.
 * Unknown keys → 404 (registry membership is authoritative). Invalid
 * percentage or allowlist → 422 with Problem+JSON.
 *
 * These routes are exempt from `require-not-maintenance` and
 * `require-writes-enabled` (both middlewares safelist `/admin/flags/*`)
 * so an operator can always turn maintenance mode OFF, even from a
 * degraded state.
 */
type Env = { Bindings: Bindings; Variables: Variables };

const FlagKeyParam = z.object({
  key: z.string().min(1).max(128).openapi({ param: { name: "key", in: "path" } }),
});

const FlagUpdateBody = z
  .object({
    enabled: z.boolean().optional(),
    percentage: z.number().int().min(0).max(100).nullable().optional(),
    allowlist: z.array(z.string().min(1)).nullable().optional(),
  })
  .openapi("FlagUpdateRequest");

const FlagSnapshotSchema = z
  .object({
    key: z.string(),
    kind: z.enum(["boolean", "percentage"]),
    enabled: z.boolean(),
    percentage: z.number().nullable(),
    allowlist: z.array(z.string()).nullable(),
    description: z.string(),
    updated_at: z.number().nullable(),
    updated_by: z.string().nullable(),
  })
  .openapi("FlagSnapshot");

const listFlagsRoute = createRoute({
  method: "get",
  path: "/admin/flags",
  tags: ["admin"],
  summary: "List all feature flags",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "All registered flags + current state",
      content: {
        "application/json": {
          schema: z.object({ items: z.array(FlagSnapshotSchema) }),
        },
      },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing flags:read permission",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const getFlagRoute = createRoute({
  method: "get",
  path: "/admin/flags/{key}",
  tags: ["admin"],
  summary: "Read a single feature flag",
  security: [{ cookieAuth: [] }],
  request: { params: FlagKeyParam },
  responses: {
    200: {
      description: "The flag's current state",
      content: { "application/json": { schema: FlagSnapshotSchema } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing flags:read permission",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    404: {
      description: "Unknown flag key",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const updateFlagRoute = createRoute({
  method: "put",
  path: "/admin/flags/{key}",
  tags: ["admin"],
  summary: "Update a feature flag",
  security: [{ cookieAuth: [] }],
  request: {
    params: FlagKeyParam,
    body: { content: { "application/json": { schema: FlagUpdateBody } } },
  },
  responses: {
    200: {
      description: "Updated snapshot",
      content: { "application/json": { schema: FlagSnapshotSchema } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing flags:write permission",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    404: {
      description: "Unknown flag key",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    422: {
      description: "Update body failed validation",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

function notFound(c: Context<Env>, key: string) {
  return c.json(
    problem(404, "Unknown flag key", ProblemType.NotFound, {
      detail: `No flag registered with key '${key}'`,
      instance: c.req.path,
      request_id: c.get("requestId"),
    }),
    404,
    { "content-type": "application/problem+json" },
  );
}

function snapshotToWire(snap: Awaited<ReturnType<FlagsService["list"]>>[number]) {
  return {
    key: snap.key,
    kind: snap.kind,
    enabled: snap.enabled,
    percentage: snap.percentage,
    allowlist: snap.allowlist,
    description: snap.description,
    updated_at: snap.updatedAt,
    updated_by: snap.updatedBy,
  };
}

export function adminFlagsRoutes(app: OpenAPIHono<Env>): void {
  app.use("/admin/flags", requireAuth(), requirePerm("flags:read"));
  app.use("/admin/flags/*", requireAuth());
  app.on("get", "/admin/flags/:key", requirePerm("flags:read"));
  app.on("put", "/admin/flags/:key", requirePerm("flags:write"));

  app.openapi(listFlagsRoute, async (c) => {
    const service = new FlagsService({ db: getDb(c.env), kv: c.env.SETTINGS });
    const items = await service.list();
    return c.json({ items: items.map(snapshotToWire) }, 200);
  });

  app.openapi(getFlagRoute, async (c) => {
    const { key } = c.req.valid("param");
    if (!isFlagKey(key)) return notFound(c, key);

    const service = new FlagsService({ db: getDb(c.env), kv: c.env.SETTINGS });
    const items = await service.list();
    const item = items.find((s) => s.key === key);
    if (item === undefined) return notFound(c, key);
    return c.json(snapshotToWire(item), 200);
  });

  app.openapi(updateFlagRoute, async (c) => {
    const { key } = c.req.valid("param");
    const patch = c.req.valid("json");

    if (!isFlagKey(key)) return notFound(c, key);

    // Registry-shape sanity: percentage flags can accept a percentage;
    // boolean flags reject it (guards against operators mis-setting a
    // gradual rollout on a kill switch that expects strict on/off).
    if (
      patch.percentage !== undefined &&
      patch.percentage !== null &&
      FLAG_REGISTRY[key].kind === "boolean"
    ) {
      return c.json(
        problem(
          422,
          "Boolean flag cannot accept a percentage",
          ProblemType.Validation,
          {
            detail: `Flag '${key}' is boolean-only; omit percentage or set to null`,
            instance: c.req.path,
            request_id: c.get("requestId"),
          },
        ),
        422,
        { "content-type": "application/problem+json" },
      );
    }

    const principal = c.get("principal");
    const actor = principal?.id ?? "unknown";

    const service = new FlagsService({ db: getDb(c.env), kv: c.env.SETTINGS });
    try {
      await service.set(key, patch, actor);
    } catch (err) {
      return c.json(
        problem(422, "Flag update failed validation", ProblemType.Validation, {
          detail: err instanceof Error ? err.message : String(err),
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        422,
        { "content-type": "application/problem+json" },
      );
    }

    const items = await service.list();
    const item = items.find((s) => s.key === key);
    if (item === undefined) return notFound(c, key);
    return c.json(snapshotToWire(item), 200);
  });
}
