import { describe, expect, it } from "vitest";
import { quarterOf } from "./review-period";

const s = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("quarterOf (Asia/Ho_Chi_Minh)", () => {
  it("30/09 17:30 UTC is already 01/10 in Vietnam → Q4", () => {
    expect(quarterOf(s("2026-09-30T17:30:00Z"))).toBe("2026-Q4");
  });
  it("30/09 16:59 UTC is still 30/09 in Vietnam → Q3", () => {
    expect(quarterOf(s("2026-09-30T16:59:59Z"))).toBe("2026-Q3");
  });
  it("31/12 17:30 UTC rolls into the next year → 2027-Q1", () => {
    expect(quarterOf(s("2026-12-31T17:30:00Z"))).toBe("2027-Q1");
  });
  it("the 0 3 cron on 01/10 (10:00 VN) → Q4", () => {
    expect(quarterOf(s("2026-10-01T03:00:00Z"))).toBe("2026-Q4");
  });
  it("quarter edges: 31/03 17:00Z → Q2, 30/06 17:00Z → Q3", () => {
    expect(quarterOf(s("2026-03-31T17:00:00Z"))).toBe("2026-Q2");
    expect(quarterOf(s("2026-06-30T17:00:00Z"))).toBe("2026-Q3");
  });
});
