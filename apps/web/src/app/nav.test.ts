import { describe, expect, it } from "vitest";
import { navRegistry, visibleNavItems } from "./nav";
import type { Me } from "./me";

const me = (permissions: string[]): Me => ({ id: "u", email: "a@b.c", display_name: null, roles: [], permissions });

describe("nav registry", () => {
  it("orders items as the design says", () => {
    expect(navRegistry.map((i) => i.to)).toEqual([
      "/hop-dong", "/mau-hop-dong", "/cho-toi-duyet", "/khach-hang", "/phan-quyen", "/nhat-ky", "/nguoi-dung",
    ]);
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
});
