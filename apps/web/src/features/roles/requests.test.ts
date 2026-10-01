import { describe, expect, it } from "vitest";
import { approvableCount, diffText, formatDayMonth } from "./requests";

const r = (status: string, approve: boolean) => ({ status, can: { approve, reject: approve, withdraw: false } });

describe("approvableCount (nav badge)", () => {
  it("counts only pending requests the caller may approve", () => {
    expect(approvableCount([r("pending", true), r("pending", false), r("approved", true), r("pending", true)])).toBe(2);
  });
  it("is undefined (no pill) at 0 or before the list loads", () => {
    expect(approvableCount([r("pending", false)])).toBeUndefined();
    expect(approvableCount(undefined)).toBeUndefined();
  });
});

describe("diffText", () => {
  it("added first, removed after, U+2212 minus", () => {
    expect(diffText(["a", "b"], ["c"])).toBe("+2 · −1");
    expect(diffText([], ["c"])).toBe("−1");
    expect(diffText(["a"], [])).toBe("+1");
  });
});

describe("formatDayMonth", () => {
  it("renders dd/mm in Vietnam time", () => {
    expect(formatDayMonth(Date.UTC(2026, 9, 7, 20) / 1000)).toBe("08/10"); // 03:00 on the 8th in Hà Nội
  });
});
