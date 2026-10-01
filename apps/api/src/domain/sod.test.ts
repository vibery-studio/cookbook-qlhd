import { describe, expect, it } from "vitest";
import { sodViolations } from "./sod";

const pairs = [
  { perm_a: "contract:issue", perm_b: "settings:write" },
  { perm_a: "contract:approve", perm_b: "contract:write" },
];

describe("sodViolations (SPEC-07 FR-2)", () => {
  it("returns every pair whose two codes are both in the set, as [perm_a, perm_b]", () => {
    expect(sodViolations(["settings:write", "contract:issue", "contract:read"], pairs)).toEqual([
      ["contract:issue", "settings:write"],
    ]);
    expect(
      sodViolations(["contract:write", "contract:approve", "settings:write", "contract:issue"], pairs),
    ).toEqual([
      ["contract:issue", "settings:write"],
      ["contract:approve", "contract:write"],
    ]);
  });

  it("does not care about order inside the set or inside a stored pair", () => {
    const reversed = [{ perm_a: "settings:write", perm_b: "contract:issue" }];
    expect(sodViolations(["contract:issue", "settings:write"], reversed)).toEqual([
      ["settings:write", "contract:issue"],
    ]);
  });

  it("does not flag a set holding only one code of a pair", () => {
    expect(sodViolations(["contract:issue", "contract:write"], pairs)).toEqual([]);
    expect(sodViolations([], pairs)).toEqual([]);
    expect(sodViolations(["contract:issue", "settings:write"], [])).toEqual([]);
  });
});
