import { describe, expect, it } from "vitest";
import {
  LEVEL_STATUS_LABEL,
  NO_RIGHT_TEXT,
  VAT_OPTIONS,
  durationLabel,
  formatPlainMoney,
  nextPriceText,
  parseMoney,
  parseVatOption,
  priceIncVat,
  tomorrowIso,
  vatLabel,
} from "./product-view";

describe("product view helpers", () => {
  it("labels the tax rate: KCT is not 0%", () => {
    expect(vatLabel(null)).toBe("KCT");
    expect(vatLabel(0)).toBe("0%");
    expect(vatLabel(800)).toBe("8%");
    expect(vatLabel(1000)).toBe("10%");
    expect(VAT_OPTIONS.map((o) => o.label)).toEqual(["0%", "5%", "8%", "10%", "KCT"]);
    expect(parseVatOption("kct")).toBeNull();
    expect(parseVatOption("1000")).toBe(1000);
  });

  it("shows money as dot-grouped digits, and the scheduled level as '<price> từ dd/mm/yyyy'", () => {
    expect(formatPlainMoney(2_700_000)).toBe("2.700.000");
    expect(nextPriceText({ unit_price_ex_vat: 2_600_000, effective_from: "2027-01-01" })).toBe("2.600.000 từ 01/01/2027");
    expect(nextPriceText(null)).toBe("—");
  });

  it("mirrors the server's half-up VAT for display (55.000 for 50.000 + 10%, KCT unchanged, 8% of 1.005 rounds up)", () => {
    expect(priceIncVat(50_000, 1000)).toBe(55_000);
    expect(priceIncVat(2_700_000, null)).toBe(2_700_000);
    expect(priceIncVat(1_005, 800)).toBe(1_085); // 80,4 → 80
    expect(priceIncVat(1_006, 500)).toBe(1_056); // 50,3 → 50
    expect(priceIncVat(1_010, 500)).toBe(1_061); // 50,5 → 51 (half-up)
  });

  it("parses typed money into whole đồng, rejecting decimals and negatives", () => {
    expect(parseMoney("50000")).toBe(50_000);
    expect(parseMoney(" 2.700.000 ")).toBe(2_700_000);
    expect(parseMoney("0")).toBe(0);
    for (const bad of ["", "5,5", "-1", "abc", "1000000000001"]) expect(parseMoney(bad)).toBeNull();
  });

  it("names the three level statuses", () => {
    expect(LEVEL_STATUS_LABEL).toEqual({ scheduled: "Sắp áp dụng", current: "Đang áp dụng", past: "Đã hết" });
  });

  it("duration reads '6 tháng'; goods have none", () => {
    expect(durationLabel(6, "month")).toBe("6 tháng");
    expect(durationLabel(14, "day")).toBe("14 ngày");
    expect(durationLabel(null, null)).toBe("—");
  });

  it("tomorrow is computed on the Vietnam calendar day", () => {
    // 2026-12-31 18:00 UTC = 01/01/2027 01:00 in Vietnam → tomorrow = 2027-01-02
    expect(tomorrowIso(Date.UTC(2026, 11, 31, 18))).toBe("2027-01-02");
    expect(tomorrowIso(Date.UTC(2026, 11, 31, 10))).toBe("2027-01-01");
  });

  it("the lock sentence is the spec's", () => {
    expect(NO_RIGHT_TEXT).toBe("Chỉ Quản lý, Giám đốc sửa sản phẩm/đặt giá");
  });
});
