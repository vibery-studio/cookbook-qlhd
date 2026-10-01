import { roleLabels } from "../../app/me";

/** FIX-03 (SPEC-06 DEC-5). The server is the guard (403 self_role / admin_only); this only avoids offering dead ends. */
export const SELF_ROLE_REASON = "Không tự đổi vai trò của mình";
export const SELF_DISABLE_REASON = "Không tự khóa tài khoản của mình";

export const NOT_GRANTABLE_REASON = "Bạn không có quyền này nên không cấp được";

/** FIX-05 R3: a role carrying roles:write (admin, giam_doc, custom) is given only by Giám đốc (server: 403 owner_only). */
export const OWNER_ONLY_REASON = "Chỉ Giám đốc gán vai trò có quyền Quản lý vai trò";
/** FIX-05: only Giám đốc changes a Giám đốc's role (server: 403 owner_only). */
export const OWNER_TARGET_REASON = "Chỉ Giám đốc đổi vai trò của Giám đốc";

export type RoleOption = { name: string; label: string; permissions: readonly string[]; holders?: number };
export type SelectableRole = { name: string; label: string; locked?: string };
export type SelectCtx = {
  mode: "invite" | "assign";
  callerIsAdmin: boolean;
  /** Carries `giam_doc` (the owner). */
  callerIsOwner: boolean;
  callerPermissions: readonly string[];
};

/** Shown while GET /roles has not loaded: the built-in business roles (no permission info → no 🔒). */
export const FALLBACK_ROLES: RoleOption[] = ["giam_doc", "quan_ly", "nhan_vien", "admin"].map((name) => ({
  name,
  label: roleLabels[name] ?? name,
  permissions: [],
}));

function notHeld(role: RoleOption, callerIsAdmin: boolean, callerPermissions: readonly string[]): boolean {
  return !callerIsAdmin && role.permissions.some((p) => !callerPermissions.includes(p));
}

/** The role carries roles:write (`admin` counts even before GET /roles loads its permissions). */
const carriesRolesWrite = (role: RoleOption) => role.name === "admin" || role.permissions.includes("roles:write");

/** FIX-05 R3: the caller may not give this role — not an owner, and not the bootstrap (first Giám đốc). */
function ownerOnly(role: RoleOption, ctx: SelectCtx): boolean {
  if (ctx.callerIsOwner || !carriesRolesWrite(role)) return false;
  return !(role.name === "giam_doc" && role.holders === 0);
}

/**
 * Roles for the invite / change-role select (SPEC-06 §3.4, FR-12, FIX-05). Never `member`. A role carrying roles:write
 * is 🔒 for a non-owner (owner_only); a role whose permissions the caller lacks is 🔒 (admin exempt; an owner exempt
 * for roles:write roles) — listed so the reason shows; the server decides.
 */
export function selectableRoles(roles: readonly RoleOption[], ctx: SelectCtx): SelectableRole[] {
  return roles
    .filter((r) => r.name !== "member")
    .map((r) => {
      const locked = ownerOnly(r, ctx)
        ? OWNER_ONLY_REASON
        : !(ctx.callerIsOwner && carriesRolesWrite(r)) && notHeld(r, ctx.callerIsAdmin, ctx.callerPermissions)
          ? NOT_GRANTABLE_REASON
          : undefined;
      return { name: r.name, label: r.label, ...(locked !== undefined ? { locked } : {}) };
    });
}

/** FIX-05: a non-owner cannot change the role of a user who holds `giam_doc`. */
export function ownerTargetLocked(targetRoles: readonly string[], myRoles: readonly string[]): boolean {
  return targetRoles.includes("giam_doc") && !myRoles.includes("giam_doc");
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
