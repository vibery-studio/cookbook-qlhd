/**
 * Write circuit-breaker gate. When the `system.writes_disabled` flag is
 * ON, every state-changing request receives a 503; reads (GET/HEAD/OPTIONS)
 * pass through unaffected.
 *
 * Distinct from `require-not-maintenance` (which blocks reads too). The
 * two middlewares compose: maintenance mode is strictly stronger and
 * runs first; if maintenance is OFF but writes are disabled, only
 * mutations are rejected.
 *
 * The `/admin/flags/*` prefix is exempt so operators can turn the
 * circuit back off (mirrors the maintenance-mode safelist).
 */
import type { Context, MiddlewareHandler } from "hono";
import { FlagsService } from "../flags/flags-service";
import { getDb } from "../db/client";
import { problem, ProblemType } from "../dto/error";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";

type Env = { Bindings: Bindings; Variables: Variables };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireWritesEnabled(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (SAFE_METHODS.has(method)) {
      await next();
      return;
    }
    if (isSafelisted(c)) {
      await next();
      return;
    }

    const flags = new FlagsService({ db: getDb(c.env), kv: c.env.SETTINGS });
    const off = await flags.get("system.writes_disabled");
    if (!off) {
      await next();
      return;
    }

    return c.json(
      problem(503, "Writes temporarily disabled", ProblemType.ServiceUnavailable, {
        detail: "State-changing requests are paused; reads remain available.",
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
  const path = c.req.path;
  return path === "/admin/flags" || path.startsWith("/admin/flags/");
}
