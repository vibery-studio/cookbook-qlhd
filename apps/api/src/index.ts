import { swaggerUI } from "@hono/swagger-ui";
import type { Bindings } from "./env";
import { createApp } from "./openapi";
import { requestId } from "./middleware/request-id";
import { logger } from "./middleware/logger";
import { errorHandler } from "./middleware/error-handler";
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

  app.get("/healthz", (c) => c.json({ ok: true }));

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

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return buildApp(env).fetch(request, env, ctx);
  },
  // TODO(Phase 7/10): add `queue()` (email retry consumer) and
  // `scheduled()` (verify-email sweeper cron) handlers here.
};
