import type { MiddlewareHandler } from "hono";

/**
 * Applies a fixed set of security headers to every response. Installed
 * globally in `index.ts` — cheap (one map iteration per request) and
 * catches every route including error paths.
 *
 * Header choices:
 *   - HSTS with `preload`: force https for 1y; ok because the app is
 *     https-only in preview/production. Local dev over http bypasses
 *     because browsers ignore HSTS on http origins.
 *   - CSP `default-src 'self'`: this is an API-only Worker in v1 —
 *     any HTML surface (Swagger UI in dev) is same-origin. Once a
 *     third-party SPA is served, callers must tighten to a specific
 *     origin allowlist.
 *   - `frame-ancestors 'none'`: cannot be iframed. Belt+braces with
 *     X-Frame-Options DENY for legacy browsers.
 *   - Permissions-Policy: deny all sensor/media APIs. The API doesn't
 *     use them; explicit denial narrows attack surface.
 */
const HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "content-security-policy":
    "default-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
};

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [key, value] of Object.entries(HEADERS)) {
      // `header()` overwrites any existing value — safer than `.append`
      // (which would allow route handlers to weaken policies).
      c.header(key, value);
    }
  };
}
