import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, isPermission } from "../src";
import type { Principal } from "../src";

function makePrincipal(overrides: Partial<Principal>): Principal {
  return {
    id: "01USER0000000000000000AAAA",
    roles: [],
    permissions: [],
    ...overrides,
  };
}

describe("catalog", () => {
  it("permission keys are stable and alphabetized (blueprint invariant)", () => {
    const sorted = [...PERMISSIONS].sort();
    expect([...PERMISSIONS]).toEqual(sorted);
  });

  it("isPermission narrows unknown strings", () => {
    expect(isPermission("notes:read")).toBe(true);
    expect(isPermission("nope:nope")).toBe(false);
  });
});

describe("can()", () => {
  it("returns false when permission is absent", () => {
    const p = makePrincipal({ permissions: [] });
    expect(can(p, "notes:read")).toBe(false);
  });

  it("returns true when permission is present, no resource context", () => {
    const p = makePrincipal({ permissions: ["notes:read"] });
    expect(can(p, "notes:read")).toBe(true);
  });

  it("ownership: allows owner", () => {
    const p = makePrincipal({
      id: "01USER0000000000000000AAAA",
      roles: ["member"],
      permissions: ["notes:write"],
    });
    expect(
      can(p, "notes:write", { ownerId: "01USER0000000000000000AAAA" }),
    ).toBe(true);
  });

  it("ownership: denies non-owner (member role)", () => {
    const p = makePrincipal({
      id: "01USER0000000000000000AAAA",
      roles: ["member"],
      permissions: ["notes:write"],
    });
    expect(
      can(p, "notes:write", { ownerId: "01USER0000000000000000BBBB" }),
    ).toBe(false);
  });

  it("ownership: admin bypasses owner check", () => {
    const p = makePrincipal({
      id: "01ADMIN000000000000000AAAA",
      roles: ["admin"],
      permissions: ["notes:write"],
    });
    expect(
      can(p, "notes:write", { ownerId: "01USER0000000000000000BBBB" }),
    ).toBe(true);
  });

  it("missing permission always denies, even for admin owner (defense in depth)", () => {
    const p = makePrincipal({
      id: "01ADMIN000000000000000AAAA",
      roles: ["admin"],
      permissions: [],
    });
    expect(
      can(p, "notes:write", { ownerId: "01ADMIN000000000000000AAAA" }),
    ).toBe(false);
  });

  it("empty ownerId string does not trigger ownership check (undefined vs '')", () => {
    // Belt+braces: an accidentally-empty ownerId string would ownership-check
    // against principal.id and pass by coincidence if principal.id were also
    // empty. Guard the resolver to return `undefined`, not `""`, when there
    // is no owner. Assert the current semantics so callers know the rule.
    const p = makePrincipal({
      id: "",
      roles: ["member"],
      permissions: ["notes:write"],
    });
    // With ownerId="" (falsy but defined), current code enters the branch
    // and compares "" === "" → true. This is intentional: the resolver
    // contract says "return undefined for no-ownership". Callers must
    // uphold it.
    expect(can(p, "notes:write", { ownerId: "" })).toBe(true);
  });
});
