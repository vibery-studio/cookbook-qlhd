import { describe, expect, it } from "vitest";
import { normalizePhone } from "../../src/utils/phone";

describe("normalizePhone", () => {
  it("maps every common spelling of one number to the same domestic form", () => {
    for (const raw of ["0901 234 567", "+84901234567", "0901.234.567", "84901234567", " +84 901-234-567 "]) {
      expect(normalizePhone(raw)).toBe("0901234567");
    }
  });

  it("keeps an 11-digit domestic number and converts its +84 form", () => {
    expect(normalizePhone("0123456789")).toBe("0123456789");
    expect(normalizePhone("+841234567890")).toBe("01234567890");
  });

  it("rejects numbers that are too short, too long, or not domestic after normalising", () => {
    for (const raw of ["", "abc", "12345", "090123", "090123456789", "+8412345", "901234567"]) {
      expect(normalizePhone(raw)).toBeNull();
    }
  });
});
