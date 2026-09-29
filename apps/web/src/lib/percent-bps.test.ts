import { describe, expect, it } from "vitest";
import { parsePercentToBps } from "./percent-bps";

describe("parsePercentToBps", () => {
  it.each([
    ["7,5", 750],
    ["7.5", 750],
    ["100", 10000],
    ["0", 0],
    ["0,05", 5],
    ["12,34", 1234],
    [" 7,5 ", 750],
  ])("%s -> %s", (input, bps) => {
    expect(parsePercentToBps(input)).toBe(bps);
  });

  it.each(["100,01", "100.5", "abc", "1,234", "", "  ", "-1", "7,", ",5", "1e2", "7,5%", "1,2,3"])("rejects %j", (input) => {
    expect(parsePercentToBps(input)).toBeNull();
  });
});
