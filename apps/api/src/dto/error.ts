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
    /** 403 separation-of-duties rule: `creator_cannot_approve` | `one_person_one_step` */
    rule: z.string().optional(),
    /** 403 `grant_not_held` (SPEC-06): permission codes the caller does not hold */
    permissions: z.array(z.string()).optional(),
    /** 409 `role-in-use` (SPEC-06): how many users carry the role */
    holders: z.number().int().optional(),
    /** 409 `sod-conflict` (SPEC-07) on a role's permission set: the violated pairs `[perm_a, perm_b]` */
    pairs: z.array(z.array(z.string())).optional(),
    /** 422 `docx-invalid` (SPEC-10): not_docx | macro_enabled | no_document | xml_invalid | too_large_inflated | too_many_entries */
    reason: z.string().optional(),
    /** 409 `has-children` (SPEC-09 FR-9): the parent's live children */
    children: z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
          number: z.string().nullable(),
          status: z.string(),
          total: z.number().int(),
          doc_date: z.string(),
        }),
      )
      .optional(),
    /** 409 `sod-conflict` (SPEC-07) on a new pair: roles already holding both codes */
    roles: z.array(z.object({ id: z.string(), name: z.string(), label: z.string() })).optional(),
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
  RoleInUse: "role-in-use",
  RoleLimit: "role-limit",
  UnknownRole: "unknown-role",
  // SPEC-07 (row 2b)
  RequestPending: "request-pending",
  NotPending: "not-pending",
  Expired: "expired",
  SodConflict: "sod-conflict",
  JitActive: "jit-active",
  AlreadyAdmin: "already-admin",
  NotActive: "not-active",
  ItemChanged: "item-changed",
  ReviewClosed: "review-closed",
  ReviewIncomplete: "review-incomplete",
  // SPEC-08 (row 3)
  PriceBackdated: "price-backdated",
  PriceInEffect: "price-in-effect",
  NoPrice: "no-price",
  ProductInactive: "product-inactive",
  ProductLimit: "product-limit",
  // SPEC-10 (row 5)
  DocxInvalid: "docx-invalid",
  PayloadTooLarge: "payload-too-large",
  UnsupportedMediaType: "unsupported-media-type",
  // SPEC-09 (row 4) — PLAN-09 §2b
  ParentNotIssued: "parent-not-issued",
  ChildExists: "child-exists",
  QuoteExpired: "quote-expired",
  ChildType: "child-type",
  LinesLocked: "lines-locked",
  HasChildren: "has-children",
  ParentRequired: "parent-required",
  TemplateType: "template-type",
  NothingToPay: "nothing-to-pay",
  // C-11-001
  TwoLayerOn: "two-layer-on",
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
  rule?: string;
  permissions?: string[];
  holders?: number;
  pairs?: string[][];
  roles?: { id: string; name: string; label: string }[];
  reason?: string;
  children?: Problem["children"];
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
    ...(options.permissions !== undefined && { permissions: options.permissions }),
    ...(options.holders !== undefined && { holders: options.holders }),
    ...(options.pairs !== undefined && { pairs: options.pairs }),
    ...(options.roles !== undefined && { roles: options.roles }),
    ...(options.reason !== undefined && { reason: options.reason }),
    ...(options.children !== undefined && { children: options.children }),
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
