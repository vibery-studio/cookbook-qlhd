import { roleLabels } from "../../app/me";

/** FIX-03 (SPEC-06 DEC-5). The server is the guard (403 self_role / admin_only); this only avoids offering dead ends. */
export const SELF_ROLE_REASON = "Không tự đổi vai trò của mình";
export const SELF_DISABLE_REASON = "Không tự khóa tài khoản của mình";

export const NOT_GRANTABLE_REASON = "Bạn không có quyền này nên không cấp được";

export type RoleOption = { name: string; label: string; permissions: readonly string[] };
export type SelectableRole = { name: string; label: string; locked?: string };
export type SelectCtx = { mode: "invite" | "assign"; callerIsAdmin: boolean; callerPermissions: readonly string[] };

/** Shown while GET /roles has not loaded: the built-in business roles (no permission info → no 🔒). */
export const FALLBACK_ROLES: RoleOption[] = ["giam_doc", "quan_ly", "nhan_vien", "admin"].map((name) => ({
  name,
  label: roleLabels[name] ?? name,
  permissions: [],
}));

function notHeld(role: RoleOption, callerIsAdmin: boolean, callerPermissions: readonly string[]): boolean {
  return !callerIsAdmin && role.permissions.some((p) => !callerPermissions.includes(p));
}

/**
 * Roles for the invite / change-role select (SPEC-06 §3.4, FR-12). Never `member`; `admin` only for an admin caller.
 * A role whose permissions the caller lacks (admin exempt) stays listed but `locked` — the server (grant_not_held) decides.
 */
export function selectableRoles(roles: readonly RoleOption[], ctx: SelectCtx): SelectableRole[] {
  return roles
    .filter((r) => r.name !== "member" && (r.name !== "admin" || ctx.callerIsAdmin))
    .map((r) => ({
      name: r.name,
      label: r.label,
      ...(notHeld(r, ctx.callerIsAdmin, ctx.callerPermissions) ? { locked: NOT_GRANTABLE_REASON } : {}),
    }));
}

/** The target holds a role the caller could not grant → "Đổi vai trò" is 🔒 (server: grant_not_held on removal). */
export function targetRoleLocked(
  targetRoles: readonly string[],
  roles: readonly RoleOption[],
  callerIsAdmin: boolean,
  callerPermissions: readonly string[],
): boolean {
  return targetRoles.some((name) => {
    const role = roles.find((r) => r.name === name);
    return role !== undefined && notHeld(role, callerIsAdmin, callerPermissions);
  });
}

export const ADMIN_TARGET_REASON = "Chỉ quản trị hệ thống sửa được tài khoản quản trị";

/** A non-admin cannot change role/status/name of a user who holds `admin` (server: 403 admin_only). */
export function adminTargetLocked(targetRoles: readonly string[], myRoles: readonly string[]): boolean {
  return targetRoles.includes("admin") && !myRoles.includes("admin");
}
