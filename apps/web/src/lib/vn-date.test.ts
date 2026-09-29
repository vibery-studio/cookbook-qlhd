import { describe, expect, it } from "vitest";
import { formatIsoDate } from "./vn-date";

describe("formatIsoDate", () => {
  it("reorders YYYY-MM-DD to dd/mm/yyyy without timezone drift", () => {
    expect(formatIsoDate("2026-09-28")).toBe("28/09/2026");
    expect(formatIsoDate("2026-01-01")).toBe("01/01/2026");
    expect(formatIsoDate("2026-12-31")).toBe("31/12/2026");
  });

  it("returns a dash for empty or malformed input", () => {
    expect(formatIsoDate("")).toBe("—");
    expect(formatIsoDate(null)).toBe("—");
    expect(formatIsoDate("28/09/2026")).toBe("—");
  });
});
