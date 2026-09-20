import type { MiddlewareHandler } from "hono";
import type { Principal } from "../openapi";

/**
 * Emits one structured JSON line per request via `console.log` (Workers
 * Logpush ingests stdout). Line-oriented only — no request/response body or
 * headers here; `deepScrub`'d payload logging is Phase 9's concern, not
 * this middleware's.
 */
export function logger(): MiddlewareHandler<{
  Variables: { requestId: string; principal?: Principal };
}> {
  return async (c, next) => {
    const start = Date.now();

    await next();

    const principal = c.get("principal");

    console.log(
      JSON.stringify({
        ts: Date.now(),
        kind: "request",
        request_id: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Date.now() - start,
        principal_id: principal?.id ?? null,
      }),
    );
  };
}
