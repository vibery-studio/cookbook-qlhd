import { describe, expect, it } from "vitest";
import { adminTargetLocked, assignableRoles } from "./role-locks";

describe("assignableRoles (FIX-03)", () => {
  it("never offers admin to a non-admin (Giám đốc)", () => {
    expect(assignableRoles(["giam_doc"])).toEqual(["giam_doc", "quan_ly", "nhan_vien"]);
  });
  it("offers admin to an admin", () => {
    expect(assignableRoles(["admin"])).toContain("admin");
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
