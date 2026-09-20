import { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "./env";
// Importing `ProblemDto` for the side effect of registering it as a shared
// component via its `.openapi("Problem")` self-registration.
import "./dto/error";
import { installZodErrorMap } from "./zod-error-map";

// The OpenAPI `info.version` is intentionally a simple constant here rather
// than a JSON import — tsconfig target ES2022 doesn't allow `with { type }`
// import attributes (ES2024), and a bundler-time JSON import ties CI's
// spec-diff to package.json version bumps for no gain. Bump when API
// contract shifts, not on every dep upgrade.
const OPENAPI_INFO_VERSION = "0.1.0";

installZodErrorMap();

/**
 * Placeholder for the authenticated principal shape. Phase 5 (session
 * management) and Phase 6 (RBAC) fill in the real fields.
 *
 * `permissions` is a JSON-serializable `readonly string[]`, NOT a `Set<string>`
 * — a Set silently serializes to `{}` through `c.json()`, and MeResponse in
 * `me.routes.ts` already declares the wire shape as `z.array(z.string())`.
 * If RBAC middleware needs O(1) `.has()` checks, it can memoize a Set at
 * middleware-entry time from this array; the Principal on context stays
 * serializable so ad-hoc `c.json(principal)` (e.g. for debug endpoints) works.
 */
export type Principal = {
  id: string;
  permissions: readonly string[];
};

/**
 * Hono context variables set by middleware and read by downstream
 * handlers/middleware. `principal` is optional because unauthenticated
 * routes (e.g. `/healthz`, `/auth/login`) never set it.
 */
export type Variables = {
  requestId: string;
  principal?: Principal;
};

/**
 * Builds a fresh `OpenAPIHono` instance with app-wide metadata and the
 * shared `Problem` component registered.
 *
 * `GET /openapi.json` is registered ONLY outside production — `env.APP_ENV`
 * gates it at construction time rather than being shadowed by a second
 * route, because Hono matches same-path routes in registration order (a
 * later `app.get('/openapi.json', ...)` would never win against `doc31`'s
 * earlier registration). `/docs` (Swagger UI) is mounted by the caller in
 * `index.ts`, guarded by the same env check, since it depends on
 * `@hono/swagger-ui` which this module intentionally stays free of.
 */
export function createApp(env: Bindings) {
  const app = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "runway_at",
  });

  if (env.APP_ENV !== "production") {
    app.doc31("/openapi.json", {
      openapi: "3.1.0",
      info: {
        title: "Runway API",
        version: OPENAPI_INFO_VERSION,
        description: "Members-only Cloudflare Workers API blueprint — password auth, RBAC, idempotency.",
      },
    });
  }

  return app;
}
