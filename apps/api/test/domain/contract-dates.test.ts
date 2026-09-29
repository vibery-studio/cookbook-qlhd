import { describe, expect, it } from "vitest";
import { contractEnd, seriesYear } from "../../src/domain/contract/dates";

describe("contract dates", () => {
  it("uses anniversary minus one day", () => {
    expect(contractEnd("2026-09-28", 6)).toBe("2027-03-27");
    expect(contractEnd("2026-09-28", 12)).toBe("2027-09-27");
  });

  it("clamps a missing anniversary day to the target month's end", () => {
    expect(contractEnd("2026-08-31", 6)).toBe("2027-02-28");
    expect(contractEnd("2027-08-31", 6)).toBe("2028-02-29");
  });

  it("calculates the Vietnamese series year", () => {
    expect(seriesYear(new Date("2026-12-31T17:30:00Z"))).toBe(2027);
  });
});
