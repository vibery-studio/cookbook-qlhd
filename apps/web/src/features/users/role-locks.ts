import type { AssignableRole } from "./api";

/** FIX-03 (SPEC-06 DEC-5). The server is the guard (403 self_role / admin_only); this only avoids offering dead ends. */
export const SELF_ROLE_REASON = "Không tự đổi vai trò của mình";
export const SELF_DISABLE_REASON = "Không tự khóa tài khoản của mình";

const BASE_ROLES: AssignableRole[] = ["giam_doc", "quan_ly", "nhan_vien"];

/** Roles the current user may pick when changing someone's role: `admin` only for admins. */
export function assignableRoles(myRoles: readonly string[]): AssignableRole[] {
  return myRoles.includes("admin") ? [...BASE_ROLES, "admin"] : BASE_ROLES;
}

export const ADMIN_TARGET_REASON = "Chỉ quản trị hệ thống sửa được tài khoản quản trị";

/** A non-admin cannot change role/status/name of a user who holds `admin` (server: 403 admin_only). */
export function adminTargetLocked(targetRoles: readonly string[], myRoles: readonly string[]): boolean {
  return targetRoles.includes("admin") && !myRoles.includes("admin");
}
