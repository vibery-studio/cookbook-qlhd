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
    errors: z
      .array(
        z.object({
          path: z.string(),
          message: z.string(),
          /** `template-check-failed` items (SPEC-02 §3.8) */
          code: z.string().optional(),
          key: z.string().optional(),
          source: z.string().optional(),
        }),
      )
      .optional(),
    /** Extension on 409 `duplicate` (customers): id of the record that already exists. */
    existing_id: z.string().optional(),
    /** 422 `missing-fields` (SPEC-03 §3.5) */
    missing_fields: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
    /** 422 `unresolved-placeholder` */
    placeholders: z.array(z.string()).optional(),
    /** 409 `no-eligible-approver` / `would-block-later-step` */
    step_no: z.number().int().optional(),
    label: z.string().optional(),
    /** 409 `state-conflict` */
    current_status: z.string().optional(),
    pdf_status: z.enum(["pending", "failed"]).optional(),
    /** 403 separation-of-duties rule: `creator_cannot_approve` | `one_person_one_step` */
    rule: z.string().optional(),
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
  LastAdmin: "last-admin",
  Stale: "stale",
  Duplicate: "duplicate",
  AlreadyActive: "already-active",
  InvalidOrExpiredToken: "invalid-or-expired-token",
  TemplateCheckFailed: "template-check-failed",
  MissingFields: "missing-fields",
  UnresolvedPlaceholder: "unresolved-placeholder",
  NoEligibleApprover: "no-eligible-approver",
  StateConflict: "state-conflict",
  AlreadyDecided: "already-decided",
  ChangedAfterApproval: "changed-after-approval",
  WouldBlockLaterStep: "would-block-later-step",
  PdfNotReady: "pdf-not-ready",
} as const;

export type ProblemTypeSlug = (typeof ProblemType)[keyof typeof ProblemType];

export interface ProblemOptions {
  /** Overrides the default `PROBLEM_TYPE_BASE + '/' + slug` URI. */
  type?: string;
  detail?: string;
  instance?: string;
  request_id?: string;
  errors?: Problem["errors"];
  existing_id?: string;
  missing_fields?: Problem["missing_fields"];
  placeholders?: string[];
  step_no?: number;
  label?: string;
  current_status?: string;
  pdf_status?: "pending" | "failed";
  rule?: string;
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
    ...(options.existing_id !== undefined && { existing_id: options.existing_id }),
    ...(options.missing_fields !== undefined && { missing_fields: options.missing_fields }),
    ...(options.placeholders !== undefined && { placeholders: options.placeholders }),
    ...(options.step_no !== undefined && { step_no: options.step_no }),
    ...(options.label !== undefined && { label: options.label }),
    ...(options.current_status !== undefined && { current_status: options.current_status }),
    ...(options.rule !== undefined && { rule: options.rule }),
    ...(options.pdf_status !== undefined && { pdf_status: options.pdf_status }),
  };
}

/** Shared 501 body for contract-only stubs (handlers land in later cards). */
export function notImplementedProblem(instance: string, requestId?: string): Problem {
  return problem(501, "Not Implemented", ProblemType.NotImplemented, {
    instance,
    request_id: requestId,
  });
}

// `ProblemDto` self-registers as `#/components/schemas/Problem` via the
// `.openapi("Problem")` chained call above. No separate registration
// function needed with @hono/zod-openapi v1.x.

/** OpenAPI response entry for a Problem+JSON error. */
export function problemResponse(description: string) {
  return {
    description,
    content: { "application/problem+json": { schema: ProblemDto } },
  };
}
