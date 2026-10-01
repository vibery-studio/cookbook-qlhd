import { z } from "@hono/zod-openapi";
import { EmailSchema, TimestampSchema, UlidSchema } from "./common";

export const IdempotencyKeyHeader = z.object({
  "Idempotency-Key": z
    .string()
    .regex(
      /^([0-9A-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
      "must be a ULID or UUID",
    )
    .optional(),
});

/** A role `name` that exists in `roles` (SPEC-06 FR-9); unknown → 422 `unknown-role`. */
export const RoleNameSchema = z.string().min(1).max(64);

export const AdminUserSchema = z
  .object({
    id: UlidSchema,
    email: EmailSchema,
    display_name: z.string().nullable(),
    status: z.enum(["pending", "active", "disabled"]),
    roles: z.array(z.string()),
  })
  .openapi("AdminUser");

export const InviteUserBody = z
  .object({
    // " KHANH@nhatminh.vn " is the same person as "khanh@nhatminh.vn" (SPEC-01 §4 Input)
    email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), EmailSchema),
    display_name: z.string().min(1).max(100),
    role: RoleNameSchema,
  })
  .openapi("InviteUserRequest");

export const InviteUserResponse = z
  .object({
    user: AdminUserSchema,
    activation_url: z.string(),
    expires_at: TimestampSchema,
  })
  .openapi("InviteUserResponse");

export const UpdateUserBody = z
  .object({
    role: RoleNameSchema.optional(),
    status: z.enum(["active", "disabled"]).optional(),
    display_name: z.string().min(1).max(100).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "at least one of role, status, display_name is required",
  })
  .openapi("UpdateUserRequest");

export const ReinviteResponse = z
  .object({ activation_url: z.string(), expires_at: TimestampSchema })
  .openapi("ReinviteResponse");

export const ActivateBody = z
  .object({
    token: z.string().min(16).max(128),
    password: z.string().min(12).max(256),
  })
  .openapi("ActivateRequest");

/** FIX-06: why the caller may not give a role (the rule the API would answer a PATCH / invite with). */
export const RoleOptionLockSchema = z.enum(["self_role", "admin_only", "owner_only", "root_role", "grant_not_held"]);

export const AssignableRoleSchema = z
  .object({ name: z.string(), label: z.string(), locked_reason: RoleOptionLockSchema.nullable() })
  .openapi("AssignableRole");

/**
 * FIX-06: `GET /admin/users` row for the caller — `can` / `locked_reason` come from the same rules the write guards use
 * (`domain/user-assign.ts`); the web renders them, it never re-derives a rule.
 * `set_status: "self_disable"` mirrors the 403 `self_disable` guard of `updateUser`.
 */
export const AdminUserItemSchema = z
  .object({
    id: UlidSchema,
    email: EmailSchema,
    display_name: z.string().nullable(),
    status: z.enum(["pending", "active", "disabled"]),
    roles: z.array(z.string()),
    can: z.object({
      change_role: z.boolean(),
      set_status: z.boolean(),
      reinvite: z.boolean(),
      grant_jit: z.boolean(),
      revoke_jit: z.boolean(),
    }),
    locked_reason: z.object({
      change_role: z.enum(["self_role", "admin_only", "owner_only", "root_role", "grant_not_held", "no_role_option"]).nullable(),
      set_status: z.enum(["admin_only", "self_disable", "pending"]).nullable(),
      reinvite: z.enum(["admin_only", "root_role", "owner_only"]).nullable(),
      grant_jit: z.enum(["self_grant", "jit_actor", "not_active", "already_admin", "jit_active"]).nullable(),
    }),
    /** Options of "Đổi vai trò" for this user (never `member` / `root`). Empty without users:write. */
    role_options: z.array(AssignableRoleSchema),
    /** The user's active temporary admin grant, if any. */
    jit_grant: z.object({ id: z.string(), expires_at: TimestampSchema }).nullable(),
  })
  .openapi("AdminUserItem");

export const AdminUsersPageSchema = z
  .object({
    items: z.array(AdminUserItemSchema),
    next_cursor: z.string().nullable(),
    /** Options of "Mời người dùng" for the caller (never `member` / `root`). Empty without users:write. */
    invite_roles: z.array(AssignableRoleSchema),
  })
  .openapi("AdminUsersPage");
