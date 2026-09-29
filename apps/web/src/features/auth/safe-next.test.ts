import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("accepts an internal path with one leading slash", () => {
    expect(safeNext("/khach-hang")).toBe("/khach-hang");
    expect(safeNext("/khach-hang?q=hoa#chi-tiet")).toBe("/khach-hang?q=hoa#chi-tiet");
  });

  it.each(["//evil.com", "https://evil.com", "javascript:alert(1)", "/\\evil"]) (
    "rejects an unsafe next value: %s",
    (value) => {
      expect(safeNext(value)).toBeNull();
    },
  );

  it("rejects missing and non-path values", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext("khach-hang")).toBeNull();
  });
});
