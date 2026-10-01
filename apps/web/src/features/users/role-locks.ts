import type { components } from "@runway/client";
import type { AdminUser } from "./api";

/**
 * FIX-06 — wording only. Every lock of the Người dùng screen is DECIDED by the API (`GET /admin/users` `can` /
 * `locked_reason` / `role_options` / `invite_roles`, built from the same rules the write guards use). This file maps a
 * reason code to its Vietnamese sentence; it holds no rule.
 */
export type AssignableRole = components["schemas"]["AssignableRole"];
type OptionLock = NonNullable<AssignableRole["locked_reason"]>;
type ChangeRoleLock = NonNullable<AdminUser["locked_reason"]["change_role"]>;
type StatusLock = NonNullable<AdminUser["locked_reason"]["set_status"]>;
type JitLock = NonNullable<AdminUser["locked_reason"]["grant_jit"]>;

export const SELF_ROLE_REASON = "Không tự đổi vai trò của mình";
export const SELF_DISABLE_REASON = "Không tự khóa tài khoản của mình";
export const NOT_GRANTABLE_REASON = "Bạn không có quyền này nên không cấp được";
export const OWNER_ONLY_REASON = "Chỉ Giám đốc gán vai trò có quyền Quản lý vai trò";
export const OWNER_TARGET_REASON = "Chỉ Giám đốc đổi vai trò của Giám đốc";
export const ADMIN_TARGET_REASON = "Chỉ quản trị hệ thống sửa được tài khoản quản trị";
const ROOT_REASON = "Root admin chỉ tạo bằng công cụ cài đặt, không gán hay gỡ trong ứng dụng";

/** A locked option of the role select (invite / Đổi vai trò). */
export const OPTION_LOCK_TEXT: Record<OptionLock, string> = {
  owner_only: OWNER_ONLY_REASON,
  grant_not_held: NOT_GRANTABLE_REASON,
  root_role: ROOT_REASON,
  self_role: SELF_ROLE_REASON,
  admin_only: ADMIN_TARGET_REASON,
};

/** "Đổi vai trò" of a row is locked. `owner_only` here = the row is a Giám đốc. */
export const CHANGE_ROLE_LOCK_TEXT: Record<ChangeRoleLock, string> = {
  self_role: SELF_ROLE_REASON,
  admin_only: ADMIN_TARGET_REASON,
  owner_only: OWNER_TARGET_REASON,
  root_role: ROOT_REASON,
  grant_not_held: NOT_GRANTABLE_REASON,
  no_role_option: "Không có vai trò nào bạn gán được cho người này",
};

export const STATUS_LOCK_TEXT: Record<StatusLock, string> = {
  admin_only: ADMIN_TARGET_REASON,
  self_disable: SELF_DISABLE_REASON,
  pending: "Tài khoản chưa kích hoạt — dùng Tạo lại link",
};

export const JIT_LOCK_TEXT: Record<JitLock, string> = {
  self_grant: "Không tự cấp cho mình",
  jit_actor: "Bạn đang có quyền quản trị tạm thời nên không cấp được",
  not_active: "Chỉ cấp cho tài khoản đang hoạt động",
  already_admin: "Đã là quản trị hệ thống thường trực",
  jit_active: "Đang có quyền quản trị tạm thời",
};

/** The 🔒 lines under a row's buttons: the API's reasons for the locked actions, each sentence once. */
export function rowLockNotes(user: Pick<AdminUser, "can" | "locked_reason">): string[] {
  const notes: string[] = [];
  if (!user.can.change_role && user.locked_reason.change_role) notes.push(CHANGE_ROLE_LOCK_TEXT[user.locked_reason.change_role]);
  if (!user.can.set_status && user.locked_reason.set_status) notes.push(STATUS_LOCK_TEXT[user.locked_reason.set_status]);
  return [...new Set(notes)];
}

/** First option the API leaves open, preferring `prefer` (the current role) then Nhân viên. */
export function firstOpen(options: readonly AssignableRole[], prefer?: string): string {
  const open = (name: string | undefined) => options.find((o) => o.name === name && o.locked_reason === null)?.name;
  return open(prefer) ?? open("nhan_vien") ?? options.find((o) => o.locked_reason === null)?.name ?? "";
}
