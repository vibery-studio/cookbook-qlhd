import { describe, expect, it } from "vitest";
import { requiredSteps } from "../../src/domain/contract/policy";
import type { ApprovalPolicy } from "../../src/domain/contract/types";

const policy: ApprovalPolicy = {
  mode: "combined",
  steps: [{ step_no: 1, label: "Quản lý duyệt", permission: "contract:approve" }],
  rules: [
    {
      when: { var: "discount_bps", op: "gt", value: 1_000 },
      add_steps: [{ label: "Giám đốc duyệt", permission: "contract:approve", role: "giam_doc" }],
    },
  ],
};

describe("approval policy", () => {
  it("adds the director only above 10% and renumbers steps", () => {
    expect(requiredSteps(policy, { discount_bps: 500 })).toEqual([
      { step_no: 1, label: "Quản lý duyệt", required_permission: "contract:approve", required_role: null },
    ]);
    expect(requiredSteps(policy, { discount_bps: 1_001 })).toEqual([
      { step_no: 1, label: "Quản lý duyệt", required_permission: "contract:approve", required_role: null },
      { step_no: 2, label: "Giám đốc duyệt", required_permission: "contract:approve", required_role: "giam_doc" },
    ]);
  });

  it("fails closed when a rule variable is missing", () => {
    expect(requiredSteps(policy, {})).toHaveLength(2);
    expect(requiredSteps(policy, { discount_bps: undefined })).toHaveLength(2);
  });
});
