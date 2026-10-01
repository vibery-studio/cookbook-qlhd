import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS, groupCatalog, permissionGroup, permissionLabel, sortRoles, PERMISSION_GROUP_INFRA } from "./permission-labels";
import { roleLabels } from "../../app/me";

// Mirror of packages/rbac PERMISSIONS (GET /roles returns these codes).
const ALL_CODES = [
  "audit:read", "contract:approve", "contract:issue", "contract:read", "contract:submit", "contract:write",
  "flags:read", "flags:write", "notes:read", "notes:write", "roles:write", "settings:read", "settings:write",
  "template:write", "users:read", "users:write", "jit:grant", "reviews:write", "product:write", "price:write",
];

describe("permission labels", () => {
  it.each(ALL_CODES)("%s has a Vietnamese label, never the raw code", (code) => {
    const label = permissionLabel(code);
    expect(label).not.toBe(code);
    expect(label).not.toMatch(/^[a-z_]+:[a-z_]+$/);
    expect(PERMISSION_LABELS[code]).toBeDefined();
  });

  it("puts base RUNWAY permissions in the infrastructure group", () => {
    for (const code of ["flags:read", "flags:write", "notes:read", "notes:write", "settings:read", "settings:write"]) {
      expect(permissionGroup(code)).toBe(PERMISSION_GROUP_INFRA);
    }
    expect(permissionGroup("contract:read")).not.toBe(PERMISSION_GROUP_INFRA);
    expect(PERMISSION_GROUP_INFRA).toBe("Hạ tầng (nền hệ thống)");
  });

  it("splits the catalog into Hợp đồng · Quản trị · Hạ tầng and names roles:write", () => {
    expect(permissionLabel("roles:write")).toBe("Quản lý vai trò");
    const groups = groupCatalog(ALL_CODES);
    expect(groups.map((g) => g.group)).toEqual(["Hợp đồng", "Quản trị", "Hạ tầng (nền hệ thống)"]);
    expect(groups[1]?.codes).toEqual(["users:read", "users:write", "roles:write", "audit:read", "jit:grant", "reviews:write"]);
    expect(groups[0]?.codes).toContain("template:write");
  });

  it("labels the 2b permissions (Quản trị group)", () => {
    expect(permissionLabel("jit:grant")).toBe("Cấp quản trị tạm thời");
    expect(permissionLabel("reviews:write")).toBe("Rà soát quyền");
    expect(permissionGroup("jit:grant")).toBe("Quản trị");
    expect(permissionGroup("reviews:write")).toBe("Quản trị");
  });

  it("labels the product permissions (Hợp đồng group)", () => {
    expect(permissionLabel("product:write")).toBe("Sửa sản phẩm");
    expect(permissionLabel("price:write")).toBe("Đặt giá");
    expect(permissionGroup("product:write")).toBe("Hợp đồng");
    expect(permissionGroup("price:write")).toBe("Hợp đồng");
  });

  it("orders system roles first (member last of them), self-made roles by label after", () => {
    const names = sortRoles([
      { name: "r_2", label: "Kế toán" },
      { name: "member", label: "Thành viên (nền)" },
      { name: "nhan_vien", label: "Nhân viên" },
      { name: "r_1", label: "Bảo vệ" },
      { name: "giam_doc", label: "Giám đốc" },
    ]).map((r) => r.name);
    expect(names).toEqual(["giam_doc", "nhan_vien", "member", "r_1", "r_2"]);
  });

  it("labels the base member role", () => {
    expect(roleLabels["member"]).toBe("Thành viên (nền)");
  });
});
