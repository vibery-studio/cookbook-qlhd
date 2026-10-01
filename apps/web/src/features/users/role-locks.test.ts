import { describe, expect, it } from "vitest";
import { adminTargetLocked, NOT_GRANTABLE_REASON, selectableRoles, targetRoleLocked } from "./role-locks";
import type { RoleOption } from "./role-locks";

const roles: RoleOption[] = [
  { name: "admin", label: "Quản trị hệ thống", permissions: ["settings:write", "users:write", "roles:write"] },
  { name: "member", label: "Thành viên (nền)", permissions: [] },
  { name: "giam_doc", label: "Giám đốc", permissions: ["contract:read", "contract:approve", "users:write"] },
  { name: "nhan_vien", label: "Nhân viên", permissions: ["contract:read"] },
  { name: "r_01abc", label: "Kế toán", permissions: ["contract:read"] },
  { name: "r_01xyz", label: "Vận hành", permissions: ["settings:write"] },
];
const gd = { callerIsAdmin: false, callerPermissions: ["contract:read", "contract:approve", "users:write", "roles:write"] };
const admin = { callerIsAdmin: true, callerPermissions: ["settings:write", "users:write", "roles:write"] };

describe("selectableRoles (SPEC-06 FR-9, FR-12)", () => {
  it("never lists member; admin only for an admin caller; custom roles included with their label", () => {
    const names = (c: typeof gd) => selectableRoles(roles, { ...c, mode: "assign" }).map((r) => r.name);
    expect(names(gd)).toEqual(["giam_doc", "nhan_vien", "r_01abc", "r_01xyz"]);
    expect(names(admin)).toEqual(["admin", "giam_doc", "nhan_vien", "r_01abc", "r_01xyz"]);
    expect(selectableRoles(roles, { ...gd, mode: "invite" }).find((r) => r.name === "r_01abc")?.label).toBe("Kế toán");
  });
  it("locks a role whose permissions the caller lacks (Giám đốc → settings:write); admin is exempt", () => {
    const gdList = selectableRoles(roles, { ...gd, mode: "invite" });
    expect(gdList.find((r) => r.name === "r_01xyz")?.locked).toBe(NOT_GRANTABLE_REASON);
    expect(gdList.find((r) => r.name === "r_01abc")?.locked).toBeUndefined();
    expect(selectableRoles(roles, { ...admin, mode: "invite" }).some((r) => r.locked)).toBe(false);
  });
});

describe("targetRoleLocked (FR-12)", () => {
  it("locks Đổi vai trò for a target holding a role the caller cannot grant", () => {
    expect(targetRoleLocked(["r_01xyz"], roles, false, gd.callerPermissions)).toBe(true);
    expect(targetRoleLocked(["r_01xyz"], roles, true, admin.callerPermissions)).toBe(false);
    expect(targetRoleLocked(["nhan_vien"], roles, false, gd.callerPermissions)).toBe(false);
    expect(targetRoleLocked(["unknown"], roles, false, gd.callerPermissions)).toBe(false);
  });
});

describe("adminTargetLocked (FIX-03)", () => {
  it("locks an admin row for a Giám đốc", () => {
    expect(adminTargetLocked(["admin"], ["giam_doc"])).toBe(true);
  });
  it("leaves non-admin rows and admin callers alone", () => {
    expect(adminTargetLocked(["quan_ly"], ["giam_doc"])).toBe(false);
    expect(adminTargetLocked(["admin"], ["admin"])).toBe(false);
  });
});
