import { describe, expect, it } from "vitest";
import {
  adminTargetLocked,
  NOT_GRANTABLE_REASON,
  OWNER_ONLY_REASON,
  ownerTargetLocked,
  selectableRoles,
  targetRoleLocked,
} from "./role-locks";
import type { RoleOption } from "./role-locks";

const roles: RoleOption[] = [
  { name: "admin", label: "Quản trị hệ thống", permissions: ["settings:write", "users:write", "roles:write"], holders: 1 },
  { name: "member", label: "Thành viên (nền)", permissions: [], holders: 0 },
  { name: "giam_doc", label: "Giám đốc", permissions: ["contract:read", "contract:approve", "users:write", "roles:write"], holders: 1 },
  { name: "nhan_vien", label: "Nhân viên", permissions: ["contract:read"], holders: 3 },
  { name: "r_01abc", label: "Kế toán", permissions: ["contract:read"], holders: 0 },
  { name: "r_01xyz", label: "Vận hành", permissions: ["settings:write"], holders: 0 },
];
const gd = { callerIsAdmin: false, callerIsOwner: true, callerPermissions: ["contract:read", "contract:approve", "users:write", "roles:write"] };
const admin = { callerIsAdmin: true, callerIsOwner: false, callerPermissions: ["settings:write", "users:write", "roles:write"] };

describe("selectableRoles (SPEC-06 FR-9, FR-12, FIX-05)", () => {
  it("never lists member; every other role is listed (locked ones show why); custom roles keep their label", () => {
    const names = (c: typeof gd) => selectableRoles(roles, { ...c, mode: "assign" }).map((r) => r.name);
    expect(names(gd)).toEqual(["admin", "giam_doc", "nhan_vien", "r_01abc", "r_01xyz"]);
    expect(names(admin)).toEqual(["admin", "giam_doc", "nhan_vien", "r_01abc", "r_01xyz"]);
    expect(selectableRoles(roles, { ...gd, mode: "invite" }).find((r) => r.name === "r_01abc")?.label).toBe("Kế toán");
  });
  it("FIX-05: roles carrying roles:write are 🔒 owner-only for admin; Giám đốc gives them (exempt from FR-12 there)", () => {
    const adminList = selectableRoles(roles, { ...admin, mode: "invite" });
    expect(adminList.find((r) => r.name === "admin")?.locked).toBe(OWNER_ONLY_REASON);
    expect(adminList.find((r) => r.name === "giam_doc")?.locked).toBe(OWNER_ONLY_REASON);
    expect(adminList.filter((r) => r.locked).map((r) => r.name)).toEqual(["admin", "giam_doc"]);
    const gdList = selectableRoles(roles, { ...gd, mode: "invite" });
    expect(gdList.find((r) => r.name === "admin")?.locked).toBeUndefined();
  });
  it("FIX-05 bootstrap: nobody carries giam_doc yet → admin may invite the first Giám đốc", () => {
    const fresh = roles.map((r) => (r.name === "giam_doc" ? { ...r, holders: 0 } : r));
    expect(selectableRoles(fresh, { ...admin, mode: "invite" }).find((r) => r.name === "giam_doc")?.locked).toBeUndefined();
  });
  it("locks a role whose permissions the caller lacks (Giám đốc → settings:write); admin is exempt", () => {
    const gdList = selectableRoles(roles, { ...gd, mode: "invite" });
    expect(gdList.find((r) => r.name === "r_01xyz")?.locked).toBe(NOT_GRANTABLE_REASON);
    expect(gdList.find((r) => r.name === "r_01abc")?.locked).toBeUndefined();
    expect(selectableRoles(roles, { ...admin, mode: "invite" }).some((r) => r.locked === NOT_GRANTABLE_REASON)).toBe(false);
  });
});

describe("ownerTargetLocked (FIX-05)", () => {
  it("only Giám đốc changes a Giám đốc's role", () => {
    expect(ownerTargetLocked(["giam_doc"], ["admin"])).toBe(true);
    expect(ownerTargetLocked(["giam_doc"], ["giam_doc"])).toBe(false);
    expect(ownerTargetLocked(["quan_ly"], ["admin"])).toBe(false);
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
