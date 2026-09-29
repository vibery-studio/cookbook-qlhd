import { describe, expect, it } from "vitest";
import { eligibleAssignment, isEligible } from "../../src/domain/contract/assignment";
import type { Candidate, RequiredStep } from "../../src/domain/contract/types";

const manager: Candidate = { id: "ql", roles: ["quan_ly"], permissions: ["contract:approve"] };
const director: Candidate = { id: "gd", roles: ["giam_doc"], permissions: ["contract:approve"] };
const steps: RequiredStep[] = [
  { step_no: 1, label: "Quản lý duyệt", required_permission: "contract:approve", required_role: null },
  { step_no: 2, label: "Giám đốc duyệt", required_permission: "contract:approve", required_role: "giam_doc" },
];

describe("distinct approval assignment", () => {
  it("finds a distinct assignment and excludes the creator", () => {
    expect(isEligible(steps[1]!, director, new Set(["creator"]))).toBe(true);
    expect(eligibleAssignment(steps, [director, manager], new Set(["creator"]))).toEqual({
      ok: true,
      assignment: { 1: "ql", 2: "gd" },
    });
  });

  it("names the first step that cannot be added", () => {
    expect(eligibleAssignment(steps, [director, manager], new Set(["ql"]))).toEqual({ ok: false, step: steps[1] });
  });

  it("can detect the DEC-10 deadlock after the director takes step one", () => {
    expect(eligibleAssignment([steps[1]!], [director], new Set(["creator", "gd"]))).toEqual({ ok: false, step: steps[1] });
    expect(eligibleAssignment([steps[1]!], [director], new Set(["creator"]))).toEqual({
      ok: true,
      assignment: { 2: "gd" },
    });
  });
});
