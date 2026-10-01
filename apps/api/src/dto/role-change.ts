import { z } from "@hono/zod-openapi";
import { UlidSchema } from "./common";
import { PermissionSet, RoleIdSchema, RoleSchema } from "./roles";

/**
 * SPEC-07 §3.2 / PLAN-07 §2b — four-eyes role permission change requests. A request carries the full new set; the
 * stored diff (`added`/`removed`) is applied on approval. `can` / `locked_reason` are computed for the caller.
 */

export const ChangeRequestStatus = z.enum(["pending", "approved", "rejected", "withdrawn", "expired", "cancelled"]);

export const ChangeRequestSchema = z
  .object({
    id: UlidSchema,
    role_id: RoleIdSchema,
    role_name: z.string(),
    role_label: z.string(),
    base_version: z.number().int().min(1),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    note: z.string().nullable(),
    /** `expired` is computed on read for a pending request past `expires_at`. */
    status: ChangeRequestStatus,
    requested_by: z.string(),
    requested_by_name: z.string().nullable(),
    requested_at: z.number().int(),
    expires_at: z.number().int(),
    decided_by: z.string().nullable(),
    decided_by_name: z.string().nullable(),
    decided_at: z.number().int().nullable(),
    decision_note: z.string().nullable(),
    can: z.object({ approve: z.boolean(), reject: z.boolean(), withdraw: z.boolean() }),
    locked_reason: z.enum(["self_approve", "jit_actor", "owner_only", "own_role"]).nullable(),
  })
  .openapi("ChangeRequest");

export const ChangeRequestList = z.object({ items: z.array(ChangeRequestSchema) }).openapi("ChangeRequestList");

const Note = z.string().trim().max(500);

export const CreateChangeRequestBody = z
  .object({
    expected_version: z.number().int().min(1),
    /** The complete new set (not a diff); catalog codes, no repeats. */
    permissions: PermissionSet,
    note: Note.optional(),
  })
  .strict()
  .openapi("CreateChangeRequest");

export const ApproveChangeRequestBody = z.object({ note: Note.optional() }).strict().openapi("ApproveChangeRequest");

export const RejectChangeRequestBody = z
  .object({ note: z.string().trim().min(1).max(500) })
  .strict()
  .openapi("RejectChangeRequest");

export const ApproveChangeRequestResponse = z
  .object({ request: ChangeRequestSchema, role: RoleSchema })
  .openapi("ApproveChangeRequestResponse");

export const ChangeRequestListQuery = z.object({ status: ChangeRequestStatus.optional() });

export const ChangeRequestIdParam = z.object({ id: UlidSchema });
