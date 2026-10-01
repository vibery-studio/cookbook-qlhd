import { z } from "@hono/zod-openapi";
import { UlidSchema } from "./common";

/** SPEC-07 §3.2 — just-in-time admin grants (FR-5/6, DEC-5..8). Never written to user_roles. */

export const JitGrantSchema = z
  .object({
    id: UlidSchema,
    user_id: UlidSchema,
    user_name: z.string().nullable(),
    reason: z.string(),
    granted_by: z.string(),
    granted_by_name: z.string().nullable(),
    created_at: z.number().int(),
    expires_at: z.number().int(),
    revoked_at: z.number().int().nullable(),
    state: z.enum(["active", "revoked", "expired"]),
  })
  .openapi("JitGrant");

export const JitGrantList = z.object({ items: z.array(JitGrantSchema) }).openapi("JitGrantList");

export const JitGrantListQuery = z.object({
  /** `true` = only active grants; omitted = all. */
  active: z.enum(["true", "false"]).optional(),
});

export const CreateJitGrantBody = z
  .object({
    user_id: UlidSchema,
    reason: z.string().trim().min(10).max(500),
    minutes: z.number().int().min(15).max(480),
  })
  .strict()
  .openapi("CreateJitGrant");

export const JitGrantIdParam = z.object({ id: UlidSchema });

/** `GET /me` addition: the caller's active grant (from D1, never the cache). */
export const MeJitSchema = z.object({ expires_at: z.number().int() }).nullable();
