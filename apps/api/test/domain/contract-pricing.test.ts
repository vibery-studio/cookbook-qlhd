import { describe, expect, it } from "vitest";
import { computeAmounts } from "../../src/domain/contract/pricing";

describe("contract pricing", () => {
  it("calculates the Nhật Minh examples with integer half-up money", () => {
    expect(computeAmounts({ unitPrice: 2_700_000, qty: 1, discountBps: 500 })).toEqual({
      gross: 2_700_000,
      discountAmount: 135_000,
      total: 2_565_000,
    });
    expect(computeAmounts({ unitPrice: 4_800_000, qty: 2, discountBps: 1_500 })).toEqual({
      gross: 9_600_000,
      discountAmount: 1_440_000,
      total: 8_160_000,
    });
  });

  it("rounds a half đồng upward and permits 100% discount", () => {
    expect(computeAmounts({ unitPrice: 1_000_001, qty: 1, discountBps: 5_000 })).toEqual({
      gross: 1_000_001,
      discountAmount: 500_001,
      total: 500_000,
    });
    expect(computeAmounts({ unitPrice: 12_345, qty: 1, discountBps: 10_000 }).total).toBe(0);
  });

  it("rejects non-integers and out-of-range quantities or discounts", () => {
    expect(() => computeAmounts({ unitPrice: 1.5, qty: 1, discountBps: 0 })).toThrow(RangeError);
    expect(() => computeAmounts({ unitPrice: 1, qty: 0, discountBps: 0 })).toThrow(RangeError);
    expect(() => computeAmounts({ unitPrice: 1, qty: 1_000, discountBps: 0 })).toThrow(RangeError);
    expect(() => computeAmounts({ unitPrice: 1, qty: 1, discountBps: 10_001 })).toThrow(RangeError);
  });
});
