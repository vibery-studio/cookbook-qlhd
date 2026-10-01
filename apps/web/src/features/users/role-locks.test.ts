import { describe, expect, it } from "vitest";
import {
  ADMIN_TARGET_REASON,
  CHANGE_ROLE_LOCK_TEXT,
  firstOpen,
  OPTION_LOCK_TEXT,
  OWNER_ONLY_REASON,
  OWNER_TARGET_REASON,
  rowLockNotes,
  SELF_DISABLE_REASON,
  SELF_ROLE_REASON,
} from "./role-locks";
import type { AssignableRole } from "./role-locks";

/** FIX-06: the API decides every lock; these only check that each API reason code gets its sentence. */
const can = { change_role: true, set_status: true, reinvite: false, grant_jit: false, revoke_jit: false };
const none = { change_role: null, set_status: null, reinvite: null, grant_jit: null };

describe("rowLockNotes (API reasons → 🔒 lines)", () => {
  it("own row: both locks, each sentence once", () => {
    const row = { can: { ...can, change_role: false, set_status: false }, locked_reason: { ...none, change_role: "self_role" as const, set_status: "self_disable" as const } };
    expect(rowLockNotes(row)).toEqual([SELF_ROLE_REASON, SELF_DISABLE_REASON]);
  });
  it("an admin row seen by a Giám đốc: admin_only on both → one line", () => {
    const row = { can: { ...can, change_role: false, set_status: false }, locked_reason: { ...none, change_role: "admin_only" as const, set_status: "admin_only" as const } };
    expect(rowLockNotes(row)).toEqual([ADMIN_TARGET_REASON]);
  });
  it("owner_only on the row = the row is a Giám đốc; nothing locked → no line", () => {
    expect(CHANGE_ROLE_LOCK_TEXT.owner_only).toBe(OWNER_TARGET_REASON);
    expect(rowLockNotes({ can, locked_reason: none })).toEqual([]);
  });
});

describe("role select options", () => {
  const options: AssignableRole[] = [
    { name: "admin", label: "Quản trị hệ thống", locked_reason: "owner_only" },
    { name: "quan_ly", label: "Quản lý", locked_reason: "grant_not_held" },
    { name: "nhan_vien", label: "Nhân viên", locked_reason: null },
    { name: "r_01abc", label: "Kế toán", locked_reason: null },
  ];
  it("owner_only on an option = the role carries roles:write", () => {
    expect(OPTION_LOCK_TEXT.owner_only).toBe(OWNER_ONLY_REASON);
  });
  it("firstOpen keeps the current role if open, else Nhân viên, else the first open one", () => {
    expect(firstOpen(options, "r_01abc")).toBe("r_01abc");
    expect(firstOpen(options, "admin")).toBe("nhan_vien");
    expect(firstOpen(options.filter((o) => o.name !== "nhan_vien"))).toBe("r_01abc");
    expect(firstOpen([{ name: "admin", label: "x", locked_reason: "owner_only" }])).toBe("");
  });
});
