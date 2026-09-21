/**
 * Maintenance-mode gate. When the `system.maintenance_mode` flag is ON,
 * every non-safelisted request receives a 503 with `Retry-After: 60`.
 *
 * Safelist (HARD-CODED — deliberately not configurable so the operator
 * cannot brick the app):
 *   - GET/HEAD /healthz, /readyz  (probes must survive maintenance)
 *   - Any /admin/flags/* method   (operator must be able to turn it OFF)
 *
 * Install AFTER `securityHeaders` and BEFORE `requireOrigin` +
 * `requireWritesEnabled`. GET/HEAD requests to non-safelisted routes
 * still 503 in maintenance mode — this is stronger than the writes
 * circuit; a maintenance window blocks reads too.
 */
import type { Context, MiddlewareHandler } from "hono";
import { FlagsService } from "../flags/flags-service";
import { getDb } from "../db/client";
import { problem, ProblemType } from "../dto/error";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";

type Env = { Bindings: Bindings; Variables: Variables };

export function requireNotMaintenance(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (isSafelisted(c)) {
      await next();
      return;
    }

    const flags = new FlagsService({ db: getDb(c.env), kv: c.env.SETTINGS });
    const on = await flags.get("system.maintenance_mode");
    if (!on) {
      await next();
      return;
    }

    return c.json(
      problem(503, "Service under maintenance", ProblemType.ServiceUnavailable, {
        detail: "The service is temporarily in maintenance mode; retry shortly.",
        instance: c.req.path,
        request_id: c.get("requestId"),
      }),
      503,
      {
        "content-type": "application/problem+json",
        "retry-after": "60",
      },
    );
  };
}

function isSafelisted(c: Context<Env>): boolean {
  const method = c.req.method.toUpperCase();
  const path = c.req.path;

  if (method === "GET" || method === "HEAD") {
    if (path === "/healthz" || path === "/readyz") return true;
  }
  // Admin-flags routes stay reachable in every method so operators can
  // turn maintenance mode back off. GET, PUT, and (future) DELETE all
  // exempt. Path prefix match to cover `/admin/flags` and
  // `/admin/flags/:key`.
  if (path === "/admin/flags" || path.startsWith("/admin/flags/")) return true;

  return false;
}
