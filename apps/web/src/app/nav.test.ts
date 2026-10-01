import { describe, expect, it } from "vitest";
import { canAccessNavItem, navRegistry, visibleNavItems } from "./nav";
import type { NavItem } from "./route-types";
import type { Me } from "./me";

const me = (permissions: string[]): Me => ({ id: "u", email: "a@b.c", display_name: null, roles: [], permissions });

describe("nav registry", () => {
  it("orders items as the design says", () => {
    expect(navRegistry.map((i) => i.to)).toEqual([
      "/hop-dong", "/mau-hop-dong", "/cho-toi-duyet", "/khach-hang", "/san-pham", "/phan-quyen", "/ra-soat-quyen", "/nhat-ky", "/nguoi-dung", "/bao-mat",
    ]);
  });

  it("C-11-001: Bảo mật only with security:write (root), never for admin", () => {
    expect(visibleNavItems(me(["security:write", "audit:read"])).map((i) => i.to)).toContain("/bao-mat");
    expect(visibleNavItems(me(["roles:write", "users:write", "settings:write"])).map((i) => i.to)).not.toContain("/bao-mat");
  });

  it("the /hop-dong sidebar entry is called Tài liệu (route unchanged)", () => {
    expect(navRegistry.find((i) => i.to === "/hop-dong")?.label).toBe("Tài liệu");
  });

  it("shows Sản phẩm & giá to anyone with contract:read, and hides it from admin", () => {
    expect(visibleNavItems(me(["contract:read"])).map((i) => i.to)).toContain("/san-pham");
    expect(visibleNavItems(me(["users:read", "audit:read"])).map((i) => i.to)).not.toContain("/san-pham");
  });

  it("hides contract items from a user without contract permissions (admin)", () => {
    const tos = visibleNavItems(me(["users:read", "audit:read"])).map((i) => i.to);
    expect(tos).not.toContain("/hop-dong");
    expect(tos).not.toContain("/mau-hop-dong");
    expect(tos).not.toContain("/cho-toi-duyet");
  });

  it("shows approvals only with contract:approve", () => {
    expect(visibleNavItems(me(["contract:read"])).map((i) => i.to)).not.toContain("/cho-toi-duyet");
    expect(visibleNavItems(me(["contract:read", "contract:approve"])).map((i) => i.to)).toContain("/cho-toi-duyet");
  });

  it("anyPermissions: one code is enough (R-15 Rà soát quyền)", () => {
    const tos = (perms: string[]) => visibleNavItems(me(perms)).map((i) => i.to);
    expect(tos(["reviews:write"])).toContain("/ra-soat-quyen");
    expect(tos(["roles:write"])).toContain("/ra-soat-quyen");
    expect(tos(["contract:read"])).not.toContain("/ra-soat-quyen");
  });

  it("requiredPermissions (all) and anyPermissions (one) combine", () => {
    const item: NavItem = { id: "x", label: "X", to: "/x", icon: "users", section: "system", requiredPermissions: ["a"], anyPermissions: ["b", "c"] };
    expect(canAccessNavItem(item, me(["a", "c"]))).toBe(true);
    expect(canAccessNavItem(item, me(["a"]))).toBe(false);
    expect(canAccessNavItem(item, me(["b", "c"]))).toBe(false);
  });
});
