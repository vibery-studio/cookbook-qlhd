import { z } from "@hono/zod-openapi";
import { UlidSchema } from "./common";

/** SPEC-07 §3.2 / PLAN-07 §2b — quarterly access reviews (FR-7/8, DEC-10..12). */

export const AccessReviewSchema = z
  .object({
    id: UlidSchema,
    /** 'YYYY-Qn' in Asia/Ho_Chi_Minh */
    period: z.string(),
    status: z.enum(["open", "closed"]),
    /** 'system:cron' or a user id */
    opened_by: z.string(),
    opened_at: z.number().int(),
    due_at: z.number().int(),
    closed_at: z.number().int().nullable(),
  })
  .openapi("AccessReview");

export const AccessReviewItemSchema = z
  .object({
    user: z.object({ id: UlidSchema, display_name: z.string().nullable() }),
    role: z.object({ name: z.string(), label: z.string() }),
    decision: z.enum(["keep", "remove"]).nullable(),
    decided_by_name: z.string().nullable(),
    decided_at: z.number().int().nullable(),
    /** decided if decision ≠ null; changed if role/status changed since the snapshot; else open. */
    state: z.enum(["open", "decided", "changed"]),
    can: z.object({ keep: z.boolean(), remove: z.boolean() }),
    locked_reason: z.enum(["self_review", "admin_only", "not_reviewer"]).nullable(),
  })
  .openapi("AccessReviewItem");

export const CurrentAccessReviewResponse = z
  .object({
    review: AccessReviewSchema.nullable(),
    items: z.array(AccessReviewItemSchema),
    progress: z.object({ decided: z.number().int(), total: z.number().int() }),
    overdue: z.boolean(),
  })
  .openapi("CurrentAccessReview");

export const DecideReviewItemBody = z
  .object({ decision: z.enum(["keep", "remove"]) })
  .strict()
  .openapi("DecideReviewItem");

export const AccessReviewIdParam = z.object({ id: UlidSchema });
export const AccessReviewItemParam = z.object({ id: UlidSchema, userId: UlidSchema });
