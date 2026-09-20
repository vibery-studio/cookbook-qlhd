import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { problem, PROBLEM_TYPE_BASE, ProblemType } from "../dto/error";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

/**
 * Global error handler installed via `app.onError`. Every branch returns
 * RFC 7807 Problem+JSON. Always includes `request_id` (from context) and
 * `instance` (the request path) so callers can correlate against logs.
 *
 * Factory closes over `env` so it can check `APP_ENV` to suppress stack
 * traces / internals in production without threading env through Hono's
 * `onError` signature (which only receives `err` and `c`).
 */
export function errorHandler(env: Bindings) {
  return (err: Error, c: AppContext): Response => {
    const requestId = c.get("requestId");
    const instance = c.req.path;

    if (err instanceof ZodError) {
      const body = problem(422, "Validation failed", ProblemType.Validation, {
        detail: "The request did not match the expected schema",
        instance,
        request_id: requestId,
        // `issue.message` is already scrubbed by the global Zod error map
        // (zod-error-map.ts) — never `issue.received` or raw input here.
        errors: err.issues.map((issue) => ({
          path: issue.path.join(".") || "(root)",
          message: issue.message,
        })),
      });
      return c.json(body, 422, { "content-type": "application/problem+json" });
    }

    if (err instanceof HTTPException) {
      const status = err.status;
      const body = problem(status, err.message || "Request failed", {
        type: statusToSlugBase(status),
        detail: err.message,
        instance,
        request_id: requestId,
      });
      return c.json(body, status, { "content-type": "application/problem+json" });
    }

    const isProd = env.APP_ENV === "production";
    const body = problem(500, "Internal server error", ProblemType.Internal, {
      detail: isProd ? undefined : err.message,
      instance,
      request_id: requestId,
    });
    return c.json(body, 500, { "content-type": "application/problem+json" });
  };
}

/**
 * Best-effort `type` URI for HTTPException statuses that don't carry a
 * more specific Problem slug (auth/RBAC/idempotency middleware in later
 * phases should throw with explicit `problem()` bodies instead of relying
 * on this generic mapping).
 */
function statusToSlugBase(status: number): string {
  switch (status) {
    case 400:
    case 422:
      // Both are validation-shaped failures; 422 (Unprocessable Entity) is
      // what Zod raises through the app, 400 is what handlers raise for
      // request-shape rejections (e.g. missing Idempotency-Key on unauth).
      return `${PROBLEM_TYPE_BASE}/${ProblemType.Validation}`;
    case 401:
      return `${PROBLEM_TYPE_BASE}/${ProblemType.Unauthorized}`;
    case 403:
      return `${PROBLEM_TYPE_BASE}/${ProblemType.Forbidden}`;
    case 404:
      return `${PROBLEM_TYPE_BASE}/${ProblemType.NotFound}`;
    case 409:
      return `${PROBLEM_TYPE_BASE}/${ProblemType.Conflict}`;
    case 410:
      // Consumed / expired token (verify, password-reset). See phase-05.
      return `${PROBLEM_TYPE_BASE}/${ProblemType.NotFound}`;
    case 425:
      // Idempotency in-flight — the request is being processed by another
      // concurrent handler; caller should retry after Retry-After. See P9.
      return `${PROBLEM_TYPE_BASE}/${ProblemType.IdempotencyInFlight}`;
    case 429:
      return `${PROBLEM_TYPE_BASE}/${ProblemType.RateLimited}`;
    case 501:
      return `${PROBLEM_TYPE_BASE}/${ProblemType.NotImplemented}`;
    case 503:
      return `${PROBLEM_TYPE_BASE}/${ProblemType.ServiceUnavailable}`;
    default:
      // 5xx-and-friends: type=internal is appropriate; individual routes
      // that need a more specific slug should call `problem()` explicitly
      // rather than relying on this generic fall-through mapping.
      return `${PROBLEM_TYPE_BASE}/${ProblemType.Internal}`;
  }
}
