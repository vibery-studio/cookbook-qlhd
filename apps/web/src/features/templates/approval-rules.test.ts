import { describe, expect, it } from "vitest";
import { bpsToPercentText, policySteps, ruleSentence } from "./approval-rules";

const director = { label: "Giám đốc duyệt", permission: "contract:approve", role: "giam_doc" };

describe("ruleSentence", () => {
  it("builds the discount rule sentence", () => {
    expect(ruleSentence({ when: { var: "discount_bps", op: "gt", value: 1000 }, add_steps: [director] })).toBe(
      "giảm > 10% → thêm Giám đốc duyệt",
    );
  });
  it("formats fractional bps without float", () => {
    expect(bpsToPercentText(750)).toBe("7,5");
    expect(bpsToPercentText(725)).toBe("7,25");
    expect(bpsToPercentText(1000)).toBe("10");
  });
  it("skips unknown variables and malformed rules instead of breaking", () => {
    expect(ruleSentence({ when: { var: "total", op: "gt", value: 5 }, add_steps: [director] })).toBeNull();
    expect(ruleSentence({ when: { var: "discount_bps", op: "gt", value: 1000 }, add_steps: [] })).toBeNull();
    expect(ruleSentence({ when: { var: "discount_bps", op: "zz", value: 1000 }, add_steps: [director] })).toBeNull();
    expect(ruleSentence(null)).toBeNull();
    expect(ruleSentence({})).toBeNull();
  });
});

describe("policySteps", () => {
  it("lists steps and known rules, drops unknown rules", () => {
    const out = policySteps({
      mode: "combined",
      steps: [{ label: "Quản lý duyệt", permission: "contract:approve" }],
      rules: [
        { when: { var: "discount_bps", op: "gt", value: 1000 }, add_steps: [director] },
        { when: { var: "x", op: "gt", value: 1 }, add_steps: [director] },
      ],
    });
    expect(out).toEqual({ steps: ["Quản lý duyệt"], rules: ["giảm > 10% → thêm Giám đốc duyệt"], none: false });
  });
  it("mode none", () => {
    expect(policySteps({ mode: "none" }).none).toBe(true);
  });
});
