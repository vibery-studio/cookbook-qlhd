import { swaggerUI } from "@hono/swagger-ui";
import type { Bindings } from "./env";
import { createApp } from "./openapi";
import { requestId } from "./middleware/request-id";
import { logger } from "./middleware/logger";
import { errorHandler } from "./middleware/error-handler";
import { requireOrigin } from "./middleware/origin";
import { requireFetchHeader } from "./middleware/require-fetch-header";
import { securityHeaders } from "./middleware/security-headers";
import { mountRoutes } from "./routes";
import { problem, ProblemType } from "./dto/error";

// `createApp` needs a concrete `env` to gate `/openapi.json` on `APP_ENV`
// and to close the error handler over it, but Workers only hand us `env`
// per request (via `fetch(request, env, ctx)`), not at module load. Each
// deployed Worker (dev/preview/prod) is a distinct isolate bound to its own
// env — never multiple envs sharing one isolate — so rebuilding per request
// is not a cross-env leak risk; it's just re-running cheap route
// registration, which is negligible next to the request itself.
function buildApp(env: Bindings) {
  const app = createApp(env);

  // Middleware order: request-id (so every later stage + the error handler
  // can read c.get('requestId')) -> logger (wraps the full request incl.
  // downstream errors) -> error-handler (installed via onError, catches
  // anything thrown by logger's `next()` chain or route handlers).
  app.use("*", requestId());
  app.use("*", logger());
  // Security headers apply on every response, including error paths.
  // Installed AFTER logger so the log line captures the final status
  // BEFORE headers are stamped — headers don't affect status.
  app.use("*", securityHeaders());
  // CSRF defense (Phase 5). Both middlewares no-op on GET/HEAD/OPTIONS,
  // so applying globally is safe for read-only endpoints (/healthz,
  // /openapi.json, /docs) — those never trigger the header/origin check.
  app.use("*", requireOrigin());
  app.use("*", requireFetchHeader());
  app.onError(errorHandler(env));

  // Unmatched routes (incl. `/openapi.json` and `/docs` in production,
  // where they're deliberately never registered) return Problem+JSON, not
  // Hono's default plain-text 404 — RFC 7807 envelope applies uniformly.
  app.notFound((c) => {
    const body = problem(404, "Not found", ProblemType.NotFound, {
      instance: c.req.path,
      request_id: c.get("requestId"),
    });
    return c.json(body, 404, { "content-type": "application/problem+json" });
  });

  // `/healthz` + `/readyz` live in `routes/health.routes.ts` (mounted
  // by `mountRoutes` below) — split into shallow (public) and deep
  // (token-gated + rate-limited) per Phase 10.

  // `/openapi.json` is only registered by `createApp` outside production
  // (see openapi.ts) — in prod it's simply never routed, so it falls
  // through to Hono's default 404 (converted to Problem+JSON by
  // `notFound()` below). Mirror the same gate for `/docs`.
  if (env.APP_ENV !== "production") {
    app.get("/docs", swaggerUI({ url: "/openapi.json" }));
  }

  mountRoutes(app);

  return app;
}

import { emailRetryConsumer } from "./queues/email-retry-consumer";
import { verifyEmailSweeper } from "./crons/verify-email-sweeper";
import { pruneExpiredRows } from "./crons/expired-rows-pruner";
import type { EmailRetryPayload } from "./services/email-service";

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return buildApp(env).fetch(request, env, ctx);
  },
  async queue(batch: MessageBatch<EmailRetryPayload>, env: Bindings) {
    // Single consumer for now (`email-retry`). If we add a DLQ consumer
    // via wrangler.toml, dispatch here on `batch.queue`.
    await emailRetryConsumer(batch, env);
  },
  scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Dispatch by cron string. `event.cron` matches the exact
    // pattern from wrangler.toml — dispatch table stays in sync with
    // that config.
    //   `*/5 * * * *` → verify-email sweeper (see docs/email.md)
    //   `0 3 * * *`   → nightly pruner of expired jwt_revocations +
    //                    idempotency_keys (see docs/observability.md)
    if (event.cron === "0 3 * * *") {
      ctx.waitUntil(pruneExpiredRows(env));
    } else if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(verifyEmailSweeper(env));
    } else {
      // Explicit no-op for unknown schedules. Silently running the
      // sweeper on a new cron would produce log noise and race with
      // the real `*/5` sweeper. Force new-cron correctness at review
      // time via this warn log rather than at runtime.
      console.warn(
        JSON.stringify({
          ts: Date.now(),
          kind: "cron.unknown_schedule",
          schedule: event.cron,
          note: "add a handler to scheduled() dispatch table in apps/api/src/index.ts",
        }),
      );
    }
  },
};
