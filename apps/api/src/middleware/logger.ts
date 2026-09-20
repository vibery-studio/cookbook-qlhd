import type { MiddlewareHandler } from "hono";
import type { Principal } from "../openapi";
import { deepScrub } from "../observability/logger";

/**
 * Emits one structured JSON line per request via `console.log`
 * (Workers Logpush ingests stdout). Fixed-shape fields only — no
 * body, no headers, no query string. The `deepScrub` pass is
 * defense-in-depth: if a future maintainer adds a header/body-echo
 * field, sensitive data gets redacted at the boundary automatically.
 */
export function logger(): MiddlewareHandler<{
  Variables: { requestId: string; principal?: Principal };
}> {
  return async (c, next) => {
    const start = Date.now();

    await next();

    const principal = c.get("principal");

    const payload = {
      ts: Date.now(),
      kind: "request" as const,
      request_id: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Date.now() - start,
      principal_id: principal?.id ?? null,
    };

    console.log(JSON.stringify(deepScrub(payload)));
  };
}
