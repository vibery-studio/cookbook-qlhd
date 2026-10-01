import { z } from "@hono/zod-openapi";
import { PERMISSIONS } from "@runway/rbac";

/**
 * SPEC-06 §3.2 — role admin contract. `name` is the immutable identity (server-made `r_<ulid>` for custom roles);
 * `label` is the display name. `can` / `locked_reason` are computed for the caller (hints; the API decides).
 */

/** Role ids: ULID-shaped 26 chars. Seed ids (`01ROLE0000000000000ADMIN00`) contain O/L, so not strict Crockford. */
export const RoleIdSchema = z
  .string()
  .regex(/^[0-9A-Z]{26}$/, "invalid role id")
  .openapi({ example: "01ROLE000000000000QUANLY00" });

export const PermissionKeySchema = z.enum(PERMISSIONS);

const PermissionSet = z
  .array(PermissionKeySchema)
  .max(PERMISSIONS.length)
  .refine((xs) => new Set(xs).size === xs.length, { message: "permissions must not repeat" });

export const LockedReason = z.enum(["system", "own_role", "admin"]).nullable();

export const RoleSchema = z
  .object({
    id: RoleIdSchema,
    name: z.string(),
    label: z.string(),
    description: z.string().nullable(),
    is_system: z.boolean(),
    version: z.number().int().min(1),
    holders: z.number().int().min(0),
    permissions: z.array(z.string()),
    can: z.object({ edit: z.boolean(), delete: z.boolean() }),
    locked_reason: LockedReason,
  })
  .openapi("Role");

export const RolesResponse = z
  .object({
    items: z.array(RoleSchema),
    /** Full permission catalog (packages/rbac PERMISSIONS), so the screen can grant codes no role holds yet. */
    catalog: z.array(z.string()),
  })
  .openapi("RolesResponse");

const Label = z.string().trim().min(1).max(60);
const Description = z.string().trim().max(200);

export const CreateRoleBody = z
  .object({
    label: Label,
    description: Description.optional(),
    permissions: PermissionSet,
  })
  .strict()
  .openapi("CreateRoleRequest");

export const PatchRoleBody = z
  .object({
    expected_version: z.number().int().min(1),
    label: Label.optional(),
    description: Description.optional(),
    /** The complete new set (not a diff). */
    permissions: PermissionSet.optional(),
  })
  .strict()
  .openapi("PatchRoleRequest");

export const RoleIdParam = z.object({ id: RoleIdSchema });

export const DeleteRoleQuery = z.object({
  expected_version: z.coerce.number().int().min(1),
});
