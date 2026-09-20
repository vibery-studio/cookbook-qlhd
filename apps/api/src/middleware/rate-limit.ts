/**
 * Rate limit middleware factory. Uses Cloudflare's GA `[[ratelimits]]`
 * binding — `env.<name>.limit({ key })` returns `{ success: boolean }`.
 * On denial: 429 Problem+JSON with `Retry-After` header.
 *
 * Usage:
 *   app.on('post', '/auth/login',
 *     rateLimit({
 *       binding: 'RL_AUTH_LOGIN',
 *       keyFn: async (c) => `login:${normalize(email)}:${ip(c)}`,
 *       onBreach: (c) => audit({ action: 'auth.login.rate_limited', ...}, { sync: true }),
 *     }),
 *     ...
 *   );
 */
import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { problem, ProblemType } from "../dto/error";

type Env = { Bindings: Bindings; Variables: Variables };

/** Names of the rate-limit bindings — must match wrangler.toml. */
export type RateLimitBinding =
  | "RL_AUTH_LOGIN"
  | "RL_AUTH_SIGNUP"
  | "RL_AUTH_VERIFY"
  | "RL_AUTH_REFRESH"
  | "RL_READYZ";

export interface RateLimitOptions {
  /** Which binding to consume. */
  binding: RateLimitBinding;
  /**
   * Compute the key for this request. Async so callers can peek at
   * the request body if needed (e.g., extract email from login body).
   * Return the FULL key (`login:<email>:<ip>`); the middleware does
   * not add any prefix.
   */
  keyFn: (c: Context<Env>) => string | Promise<string>;
  /**
   * Optional hook fired when a request is denied (before the 429 is
   * emitted). Used for sync audit events like
   * `auth.login.rate_limited`. Errors thrown from onBreach are
   * swallowed — the 429 still fires.
   */
  onBreach?: (c: Context<Env>) => void | Promise<void>;
  /** `Retry-After` seconds. Default 60 (matches the 60s bucket). */
  retryAfterSeconds?: number;
  /**
   * When the rate-limit binding itself is missing (e.g. wrangler
   * config typo), fail closed (503) by default. Auth endpoints MUST
   * stay closed — a silent misconfiguration otherwise means
   * unlimited login attempts. Explicitly set `false` on read-only
   * probes like `/readyz` where a broken limiter locking out
   * probes is worse than no throttling.
   */
  failClosedOnMissingBinding?: boolean;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler<Env> {
  return async (c, next) => {
    // Rate limits are enforced on preview + production only. In
    // development (local `wrangler dev`, miniflare integration
    // tests), the bindings still exist but a shared bucket across
    // parallel tests would false-positive on legitimate traffic.
    // The threat model that motivates the limit (attacker-scale
    // credential stuffing, signup spam) does not apply to a
    // developer's local iteration loop.
    if (c.env.APP_ENV === "development") {
      await next();
      return;
    }

    const key = await options.keyFn(c);
    const limiter = c.env[options.binding] as RateLimit | undefined;
    if (limiter === undefined) {
      console.error(
        JSON.stringify({
          ts: Date.now(),
          kind: "error.ratelimit.missing_binding",
          binding: options.binding,
        }),
      );
      // Default fail-closed for auth-critical bindings; only
      // /readyz explicitly opts out.
      const failClosed = options.failClosedOnMissingBinding ?? true;
      if (failClosed) {
        return c.json(
          problem(503, "Rate limiter unavailable", ProblemType.ServiceUnavailable, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          503,
          { "content-type": "application/problem+json" },
        );
      }
      await next();
      return;
    }

    const result = await limiter.limit({ key });
    if (!result.success) {
      if (options.onBreach !== undefined) {
        try {
          await options.onBreach(c);
        } catch {
          // Best-effort audit; don't fail the 429 emit.
        }
      }
      return c.json(
        problem(429, "Too many requests", ProblemType.RateLimited, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        429,
        {
          "content-type": "application/problem+json",
          "retry-after": String(options.retryAfterSeconds ?? 60),
        },
      );
    }

    await next();
  };
}

/**
 * Extract the caller IP. Cloudflare sets `CF-Connecting-IP` on every
 * request; fallback to `unknown` if the header is missing (unit
 * tests, misconfigured proxies).
 */
export function clientIp(c: Context<Env>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

/**
 * Normalize an email for rate-limit key stability. Lowercase + trim
 * so `Alice@Foo.com ` and `alice@foo.com` share a bucket, preventing
 * per-account throttle bypass via casing.
 */
export function normalizeEmailForRateLimit(email: string): string {
  return email.trim().toLowerCase();
}
