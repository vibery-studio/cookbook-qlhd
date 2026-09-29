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

export const BusinessRole = z.enum(["giam_doc", "quan_ly", "nhan_vien"]);

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
    role: BusinessRole,
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
    role: z.enum(["giam_doc", "quan_ly", "nhan_vien", "admin"]).optional(),
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

export const RoleItem = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    permissions: z.array(z.string()),
  })
  .openapi("RoleItem");

export const RolesResponse = z.object({ items: z.array(RoleItem) }).openapi("RolesResponse");
