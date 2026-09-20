import { describe, expect, it } from "vitest";
import { timingSafeEqual, timingSafeEqualStr } from "../src/compare";

describe("timingSafeEqual", () => {
  it("returns true for equal buffers of equal length", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("returns false when first byte differs, equal length", () => {
    const a = new Uint8Array([9, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns false when last byte differs, equal length", () => {
    const a = new Uint8Array([1, 2, 3, 4, 9]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns false for different lengths without throwing", () => {
    const a = new Uint8Array(10).fill(7);
    const b = new Uint8Array(20).fill(7);
    expect(() => timingSafeEqual(a, b)).not.toThrow();
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns true for empty vs empty", () => {
    expect(timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it("returns false for empty vs non-empty", () => {
    expect(timingSafeEqual(new Uint8Array(0), new Uint8Array([1]))).toBe(false);
  });
});

describe("timingSafeEqualStr", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualStr("hello world", "hello world")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(timingSafeEqualStr("hello", "world")).toBe(false);
  });

  it("handles UTF-8 multi-byte characters", () => {
    expect(timingSafeEqualStr("héllo", "héllo")).toBe(true);
    expect(timingSafeEqualStr("héllo", "hello")).toBe(false);
  });
});
