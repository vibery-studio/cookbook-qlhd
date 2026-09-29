import { describe, expect, it } from "vitest";
import { isValidIsoDate, todayInVN } from "../../src/utils/vn-date";

describe("todayInVN", () => {
  it("maps a UTC evening to the next Vietnam day", () => {
    expect(todayInVN(new Date("2026-06-30T17:30:00Z"))).toBe("2026-07-01");
  });
  it("stays on the same day one second before VN midnight", () => {
    expect(todayInVN(new Date("2026-06-30T16:59:59Z"))).toBe("2026-06-30");
  });
  it("rolls the year at VN midnight", () => {
    expect(todayInVN(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
  });
});

describe("isValidIsoDate", () => {
  it.each(["2026-07-01", "2024-02-29", "2026-12-31"])("accepts %s", (s) => {
    expect(isValidIsoDate(s)).toBe(true);
  });
  it.each(["2026-02-30", "2026-13-40", "2025-02-29", "2026-00-10", "2026-07-1", "2026/07/01", "", "2026-07-01T00:00"])(
    "rejects %s",
    (s) => {
      expect(isValidIsoDate(s)).toBe(false);
    },
  );
});
