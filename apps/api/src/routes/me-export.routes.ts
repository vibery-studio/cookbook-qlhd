import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import { requireAuth } from "../middleware/auth";
import { buildUserExport } from "../privacy/export-service";
import { insertUserExport } from "../dao/user-exports-dao";
import { stampLastExport } from "../dao/user-dao";
import { SettingsService } from "../settings/settings-service";
import { generateUlid } from "../utils/id";

/**
 * `POST /me/export` — GDPR data export. Synchronous in v1.1: the
 * archive is built + signed + returned inline in the response body.
 * `docs/privacy.md` documents an R2-backed async path as v1.2 future
 * work.
 *
 * Rate limiting via `lastExportAt` (D1-persisted) — one export per
 * `privacy.export_retention_seconds` window. Rate-limit binding
 * integration is deferred to Phase 4's harness work.
 */
type Env = { Bindings: Bindings; Variables: Variables };

const ExportResponse = z
  .object({
    export_id: z.string(),
    generated_at: z.number(),
    archive: z.object({
      schema_version: z.literal(1),
      generated_at: z.number(),
      user_id: z.string(),
      tables: z.record(z.string(), z.array(z.unknown())),
      signature: z.string(),
    }),
  })
  .openapi("MeExportResponse");

const exportRoute = createRoute({
  method: "post",
  path: "/me/export",
  tags: ["me"],
  summary: "Export all data owned by the authenticated user",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Signed archive of the authenticated user's data",
      content: { "application/json": { schema: ExportResponse } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    429: {
      description: "Export requested too recently",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

export function meExportRoutes(app: OpenAPIHono<Env>): void {
  app.use("/me/export", requireAuth());

  app.openapi(exportRoute, async (c) => {
    const principal = c.get("principal");
    if (principal === undefined) {
      // requireAuth() rejected — belt-and-suspenders.
      return c.json(
        problem(401, "Not authenticated", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
        { "content-type": "application/problem+json" },
      );
    }

    const db = getDb(c.env);
    const settings = new SettingsService({ db, kv: c.env.SETTINGS });
    const retentionSeconds = await settings.get(
      "privacy.export_retention_seconds",
    );

    // Cheap self-throttle: reject if we already stamped a recent export.
    // Reads `users.last_export_at` directly.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const raw = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, principal.id),
    });
    if (raw?.lastExportAt !== null && raw?.lastExportAt !== undefined) {
      const elapsed = nowSeconds - raw.lastExportAt;
      // The retention window doubles as the rate-limit window (v1.1
      // simplification — if a user needs a fresh export within 24h the
      // operator can clear `last_export_at` out-of-band or reduce the
      // setting).
      const rateLimitSeconds = Math.min(retentionSeconds, 24 * 60 * 60);
      if (elapsed < rateLimitSeconds) {
        return c.json(
          problem(429, "Export requested too recently", ProblemType.RateLimited, {
            detail: `Retry after ${rateLimitSeconds - elapsed}s`,
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          429,
          {
            "content-type": "application/problem+json",
            "retry-after": String(rateLimitSeconds - elapsed),
          },
        );
      }
    }

    const archive = await buildUserExport({ db, env: c.env }, principal.id);
    const exportId = generateUlid();
    const expiresAt = nowSeconds + retentionSeconds;

    await insertUserExport(db, {
      id: exportId,
      userId: principal.id,
      status: "completed",
      archiveUrl: null,
      requestedAt: nowSeconds,
      completedAt: nowSeconds,
      expiresAt,
    });
    await stampLastExport(db, principal.id, nowSeconds);

    return c.json(
      {
        export_id: exportId,
        generated_at: archive.generated_at,
        archive,
      },
      200,
    );
  });
}
