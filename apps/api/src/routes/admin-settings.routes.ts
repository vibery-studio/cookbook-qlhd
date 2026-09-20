import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { SETTINGS_REGISTRY, isSettingKey } from "../settings/registry";
import { SettingsService } from "../settings/settings-service";
import { z as zRaw } from "zod";

/**
 * Admin settings routes (Phase 8). RBAC:
 *   - GET  /admin/settings         → settings:read
 *   - GET  /admin/settings/:key    → settings:read
 *   - PUT  /admin/settings/:key    → settings:write
 *
 * The write route validates `{value}` against the per-key Zod schema
 * from the registry. Unknown keys return 404 (registered ≠ existing
 * D1 row; we treat "not a registered key" as absent). Registered
 * keys always exist because seed migration 0003 inserts a default
 * row for each.
 */
type Env = { Bindings: Bindings; Variables: Variables };

const SettingsKeyParam = z.object({
  key: z.string().min(1).max(128).openapi({ param: { name: "key", in: "path" } }),
});

const SettingsUpdateBody = z
  .object({ value: z.unknown() })
  .openapi("SettingsUpdateRequest");

const SettingSnapshotSchema = z
  .object({
    key: z.string(),
    value: z.unknown(),
    description: z.string(),
    updated_at: z.number().nullable(),
    updated_by: z.string().nullable(),
  })
  .openapi("SettingSnapshot");

const listSettingsRoute = createRoute({
  method: "get",
  path: "/admin/settings",
  tags: ["admin"],
  summary: "List all system settings",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "All registered settings + current values",
      content: {
        "application/json": {
          schema: z.object({ items: z.array(SettingSnapshotSchema) }),
        },
      },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing settings:read permission",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const getSettingRoute = createRoute({
  method: "get",
  path: "/admin/settings/{key}",
  tags: ["admin"],
  summary: "Read a single system setting",
  security: [{ cookieAuth: [] }],
  request: { params: SettingsKeyParam },
  responses: {
    200: {
      description: "The setting's current value",
      content: { "application/json": { schema: SettingSnapshotSchema } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing settings:read permission",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    404: {
      description: "Unknown setting key",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const updateSettingRoute = createRoute({
  method: "put",
  path: "/admin/settings/{key}",
  tags: ["admin"],
  summary: "Update a system setting",
  security: [{ cookieAuth: [] }],
  request: {
    params: SettingsKeyParam,
    body: { content: { "application/json": { schema: SettingsUpdateBody } } },
  },
  responses: {
    200: {
      description: "Updated snapshot",
      content: { "application/json": { schema: SettingSnapshotSchema } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing settings:write permission",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    404: {
      description: "Unknown setting key",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    422: {
      description: "Value failed the registry schema",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

function notFound(c: Context<Env>, key: string) {
  return c.json(
    problem(404, "Unknown setting key", ProblemType.NotFound, {
      detail: `No setting registered with key '${key}'`,
      instance: c.req.path,
      request_id: c.get("requestId"),
    }),
    404,
    { "content-type": "application/problem+json" },
  );
}

function snapshotToWire(snap: Awaited<ReturnType<SettingsService["list"]>>[number]) {
  return {
    key: snap.key,
    value: snap.value,
    description: snap.description,
    updated_at: snap.updatedAt,
    updated_by: snap.updatedBy,
  };
}

export function adminSettingsRoutes(app: OpenAPIHono<Env>): void {
  // Read + write share the same auth gate; permission gates differ.
  app.use("/admin/settings", requireAuth(), requirePerm("settings:read"));
  app.use("/admin/settings/*", requireAuth());
  // GET :key is settings:read; PUT :key is settings:write. Use a
  // per-method middleware split — Hono's `app.on(method, path, ...)`
  // wraps per-verb.
  app.on("get", "/admin/settings/:key", requirePerm("settings:read"));
  app.on("put", "/admin/settings/:key", requirePerm("settings:write"));

  app.openapi(listSettingsRoute, async (c) => {
    const service = new SettingsService({ db: getDb(c.env), kv: c.env.SETTINGS });
    const items = await service.list();
    return c.json({ items: items.map(snapshotToWire) }, 200);
  });

  app.openapi(getSettingRoute, async (c) => {
    const { key } = c.req.valid("param");
    if (!isSettingKey(key)) return notFound(c, key);

    const service = new SettingsService({ db: getDb(c.env), kv: c.env.SETTINGS });
    const items = await service.list();
    const item = items.find((s) => s.key === key);
    if (item === undefined) return notFound(c, key);
    return c.json(snapshotToWire(item), 200);
  });

  app.openapi(updateSettingRoute, async (c) => {
    const { key } = c.req.valid("param");
    const { value } = c.req.valid("json");

    if (!isSettingKey(key)) return notFound(c, key);

    const schema = SETTINGS_REGISTRY[key].schema;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return c.json(
        problem(422, "Setting value failed schema validation", ProblemType.Validation, {
          detail: parsed.error.message,
          instance: c.req.path,
          request_id: c.get("requestId"),
          errors: parsed.error.issues.map((issue: zRaw.core.$ZodIssue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        }),
        422,
        { "content-type": "application/problem+json" },
      );
    }

    const principal = c.get("principal");
    const actor = principal?.id ?? "unknown";

    const service = new SettingsService({ db: getDb(c.env), kv: c.env.SETTINGS });
    await service.set(key, parsed.data, actor);

    const items = await service.list();
    const item = items.find((s) => s.key === key);
    if (item === undefined) return notFound(c, key);
    return c.json(snapshotToWire(item), 200);
  });
}
