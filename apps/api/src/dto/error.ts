import { z } from "@hono/zod-openapi";

/**
 * RFC 7807 Problem Details for HTTP APIs. Every error response — validation,
 * auth, not-found, rate-limit, internal — uses this exact envelope. Success
 * responses return the resource directly (no wrapper); see plan.md "Success
 * envelope".
 *
 * The `.openapi({ ref_id: "Problem" })` call registers this schema as a
 * reusable `#/components/schemas/Problem` component in the emitted spec.
 * Route responses reference it via `content: { 'application/problem+json': { schema: ProblemDto } }`.
 */
export const ProblemDto = z
  .object({
    type: z.string().url(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    request_id: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .openapi("Problem");

export type Problem = z.infer<typeof ProblemDto>;

export const PROBLEM_TYPE_BASE = "https://runway.dev/errors";

/**
 * Well-known problem-type slugs. Append `PROBLEM_TYPE_BASE + '/' + slug` to
 * build the `type` URI, or use `problem()` below which does this for you.
 */
export const ProblemType = {
  NotImplemented: "not-implemented",
  Validation: "validation",
  Unauthorized: "unauthorized",
  Forbidden: "forbidden",
  NotFound: "not-found",
  Conflict: "conflict",
  IdempotencyConflict: "idempotency-conflict",
  IdempotencyInFlight: "idempotency-in-flight",
  IdempotencyRequiresAuth: "idempotency-requires-auth",
  RateLimited: "rate-limited",
  Internal: "internal",
  ServiceUnavailable: "service-unavailable",
} as const;

export type ProblemTypeSlug = (typeof ProblemType)[keyof typeof ProblemType];

export interface ProblemOptions {
  /** Overrides the default `PROBLEM_TYPE_BASE + '/' + slug` URI. */
  type?: string;
  detail?: string;
  instance?: string;
  request_id?: string;
  errors?: Problem["errors"];
}

/**
 * Canonical Problem constructor. `title` is caller-supplied (not derived
 * from the slug) so callers control the human-readable summary while the
 * slug drives the machine-readable `type` URI.
 */
export function problem(
  status: number,
  title: string,
  slugOrOpts?: ProblemTypeSlug | ProblemOptions,
  opts?: ProblemOptions,
): Problem {
  const isSlug = typeof slugOrOpts === "string";
  const slug = isSlug ? slugOrOpts : undefined;
  const options = (isSlug ? opts : slugOrOpts) ?? {};

  return {
    type: options.type ?? `${PROBLEM_TYPE_BASE}/${slug ?? ProblemType.Internal}`,
    title,
    status,
    ...(options.detail !== undefined && { detail: options.detail }),
    ...(options.instance !== undefined && { instance: options.instance }),
    ...(options.request_id !== undefined && { request_id: options.request_id }),
    ...(options.errors !== undefined && { errors: options.errors }),
  };
}

// `ProblemDto` self-registers as `#/components/schemas/Problem` via the
// `.openapi("Problem")` chained call above. No separate registration
// function needed with @hono/zod-openapi v1.x.
