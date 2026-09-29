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
 * The authenticated principal, populated by the auth middleware.
 *
 * `permissions` is a JSON-serializable `readonly string[]`, NOT a `Set<string>`
 * — a Set silently serializes to `{}` through `c.json()`, and MeResponse in
 * `me.routes.ts` declares the wire shape as `z.array(z.string())`. The
 * `rbac.can()` gate wraps this into a `Set<Permission>` at the middleware
 * boundary (see `requirePermission` glue in `middleware/require-permission.ts`),
 * so the on-context shape stays serializable while the check itself is O(1).
 *
 * `roles` is the list of ROLE NAMES the user carries (e.g., ["admin"]).
 * rbac policy uses it for admin-bypass ownership checks.
 */
export type Principal = {
  id: string;
  roles: readonly string[];
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
  const app = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>({
    // Without a hook, zod-openapi answers a failed request schema with a raw 400 ZodError body.
    // Re-throw so the error handler returns the house 422 Problem+JSON (scrubbed messages).
    defaultHook: (result) => {
      if (!result.success) throw result.error;
    },
  });

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
