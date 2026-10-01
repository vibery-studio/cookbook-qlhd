/**
 * SPEC-08 §3.3 money rules (C-08-002, FR-11, DEC-2, DEC-3, DEC-4) + FR-3 "price at date D".
 * Pure functions, shared by contracts now and quotes / delivery notes later (row 4) — no `contract` import.
 * Written before the code: the modules are loaded with a dynamic import so this file compiles before C-08-002.
 *
 * Contract pinned here (PLAN-08 §2b):
 *   priceLines(lines, discountBps) — lines carry any extra fields (code, name…), returned with amount_ex_vat · discount_amount ·
 *     net_ex_vat; vat_groups ordered KCT (null) first, then rate ascending; only rates present; RangeError on bad input.
 *   unitPriceIncVat(price, rate) — display only, half-up.  vatRatesLabel(groups) — "KCT" · "KCT, 10%" · "8%, 10%".
 *   levelAt(levels, date) — greatest effective_from ≤ date, or null.  withEffectiveTo(levels) — newest first, effective_to =
 *     the day before the next newer level (null for the newest).  levelStatus(level, levels, today) — past | current | scheduled.
 */
import { beforeAll, describe, expect, it } from "vitest";

interface LineIn {
  qty: number;
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
}
interface LineOut {
  amount_ex_vat: number;
  discount_amount: number;
  net_ex_vat: number;
}
interface VatGroup {
  vat_rate_bps: number | null;
  base: number;
  vat: number;
}
interface Priced<T> {
  lines: Array<T & LineOut>;
  vat_groups: VatGroup[];
  subtotal_ex_vat: number;
  discount_amount: number;
  total_ex_vat: number;
  vat_total: number;
  total: number;
}
interface LinePricingModule {
  priceLines<T extends LineIn>(lines: readonly T[], discountBps: number): Priced<T>;
  unitPriceIncVat(unitPriceExVat: number, vatRateBps: number | null): number;
  vatRatesLabel(groups: ReadonlyArray<{ vat_rate_bps: number | null }>): string;
}
interface Dated {
  effective_from: string;
}
interface PriceAtModule {
  levelAt<T extends Dated>(levels: readonly T[], date: string): T | null;
  withEffectiveTo<T extends Dated>(levels: readonly T[]): Array<T & { effective_to: string | null }>;
  levelStatus(level: Dated, levels: readonly Dated[], today: string): "past" | "current" | "scheduled";
}

let money: LinePricingModule;
let at: PriceAtModule;

beforeAll(async () => {
  money = (await import(/* @vite-ignore */ "../../src/domain/money/" + "line-pricing")) as LinePricingModule;
  at = (await import(/* @vite-ignore */ "../../src/domain/money/" + "price-at")) as PriceAtModule;
});

// DEMO seed (SPEC-08 §3.1): packages KCT at today's price, goods 10%
const G6 = { code: "G6", qty: 1, unit_price_ex_vat: 2_700_000, vat_rate_bps: null };
const G12 = { code: "G12", qty: 2, unit_price_ex_vat: 4_800_000, vat_rate_bps: null };
const MIN = { code: "DEMO-MIN-01", qty: 1, unit_price_ex_vat: 1_000_000, vat_rate_bps: 1000 };
const GIAY = { code: "DEMO-GIAY-01", qty: 3, unit_price_ex_vat: 20_000, vat_rate_bps: 1000 };

describe("priceLines — SPEC-08 §3.3 examples", () => {
  it("G6 × 1 −5% → KCT group, 2.565.000 (no 1đ drift against SPEC-03)", () => {
    const r = money.priceLines([G6], 500);
    expect(r.lines).toEqual([{ ...G6, amount_ex_vat: 2_700_000, discount_amount: 135_000, net_ex_vat: 2_565_000 }]);
    expect(r.vat_groups).toEqual([{ vat_rate_bps: null, base: 2_565_000, vat: 0 }]);
    expect(r).toMatchObject({ subtotal_ex_vat: 2_700_000, discount_amount: 135_000, total_ex_vat: 2_565_000, vat_total: 0, total: 2_565_000 });
  });

  it("G12 × 2 −15% → 8.160.000", () => {
    expect(money.priceLines([G12], 1500)).toMatchObject({ subtotal_ex_vat: 9_600_000, discount_amount: 1_440_000, total: 8_160_000 });
  });

  it("G6 + DEMO-MIN-01 → two groups (KCT 2.700.000/0 · 10% 1.000.000/100.000), 3.800.000", () => {
    const r = money.priceLines([G6, MIN], 0);
    expect(r.vat_groups).toEqual([
      { vat_rate_bps: null, base: 2_700_000, vat: 0 },
      { vat_rate_bps: 1000, base: 1_000_000, vat: 100_000 },
    ]);
    expect(r).toMatchObject({ total_ex_vat: 3_700_000, vat_total: 100_000, total: 3_800_000 });
    expect(money.vatRatesLabel(r.vat_groups)).toBe("KCT, 10%");
  });

  it("DEC-3: DEMO-GIAY-01 × 3 −5% → the discount comes off before VAT: net 57.000, VAT 5.700, 62.700", () => {
    const r = money.priceLines([GIAY], 500);
    expect(r.lines[0]).toMatchObject({ amount_ex_vat: 60_000, discount_amount: 3_000, net_ex_vat: 57_000 });
    expect(r.vat_groups).toEqual([{ vat_rate_bps: 1000, base: 57_000, vat: 5_700 }]);
    expect(r.total).toBe(62_700);
  });

  it("keeps each line's own fields and order, never mutates the input", () => {
    const input = [MIN, G6];
    const frozen = JSON.stringify(input);
    const r = money.priceLines(input, 0);
    expect(r.lines.map((l) => l.code)).toEqual(["DEMO-MIN-01", "G6"]);
    expect(JSON.stringify(input)).toBe(frozen);
  });
});

describe("priceLines — rounding (DEC-2: VAT half-up per rate group, not per line)", () => {
  const ten = (price: number, qty = 1) => ({ qty, unit_price_ex_vat: price, vat_rate_bps: 1000 });

  it("two 10% lines of 15đ: one group base 30 → VAT 3 (per line would give 2 + 2 = 4)", () => {
    const r = money.priceLines([ten(15), ten(15)], 0);
    expect(r.vat_groups).toEqual([{ vat_rate_bps: 1000, base: 30, vat: 3 }]);
    expect(r.total).toBe(33);
  });

  it("an exact half đồng rounds up: 10% of 5 → 1 · 5% of 30 → 2 (1,5)", () => {
    expect(money.priceLines([ten(5)], 0).vat_total).toBe(1);
    expect(money.priceLines([{ qty: 1, unit_price_ex_vat: 30, vat_rate_bps: 500 }], 0).vat_total).toBe(2);
  });

  it("8% (NQ 204): 12.345 × 3 = 37.035 → VAT 2.962,8 → 2.963; 8% and 10% sit in two groups, rate ascending", () => {
    const eight = { qty: 3, unit_price_ex_vat: 12_345, vat_rate_bps: 800 };
    const r = money.priceLines([ten(1_000), eight], 0);
    expect(r.vat_groups).toEqual([
      { vat_rate_bps: 800, base: 37_035, vat: 2_963 },
      { vat_rate_bps: 1000, base: 1_000, vat: 100 },
    ]);
    expect(r.total).toBe(37_035 + 2_963 + 1_000 + 100);
    expect(money.vatRatesLabel(r.vat_groups)).toBe("8%, 10%");
    // a fraction below one half rounds down: 8% of 37.030 = 2.962,4 → 2.962
    expect(money.priceLines([{ qty: 1, unit_price_ex_vat: 37_030, vat_rate_bps: 800 }], 0).vat_total).toBe(2_962);
  });

  it("DEC-4: 0% and KCT are two different groups (both VAT 0), KCT first", () => {
    const r = money.priceLines([{ qty: 1, unit_price_ex_vat: 100_000, vat_rate_bps: 0 }, { ...G6 }], 0);
    expect(r.vat_groups).toEqual([
      { vat_rate_bps: null, base: 2_700_000, vat: 0 },
      { vat_rate_bps: 0, base: 100_000, vat: 0 },
    ]);
    expect(money.vatRatesLabel(r.vat_groups)).toBe("KCT, 0%");
    expect(money.vatRatesLabel([{ vat_rate_bps: null }])).toBe("KCT");
    expect(money.vatRatesLabel([{ vat_rate_bps: 500 }])).toBe("5%");
  });

  it("the line discount is half-up too: 1.000.001 −50% → 500.001 off, net 500.000", () => {
    const r = money.priceLines([{ qty: 1, unit_price_ex_vat: 1_000_001, vat_rate_bps: null }], 5_000);
    expect(r.lines[0]).toMatchObject({ discount_amount: 500_001, net_ex_vat: 500_000 });
  });

  it("−100% → everything 0đ; a 0đ price is allowed", () => {
    expect(money.priceLines([G6, MIN], 10_000)).toMatchObject({ total_ex_vat: 0, vat_total: 0, total: 0, discount_amount: 3_700_000 });
    expect(money.priceLines([{ qty: 5, unit_price_ex_vat: 0, vat_rate_bps: 1000 }], 0).total).toBe(0);
  });
});

describe("priceLines — refuses what is not money (RangeError, never a float)", () => {
  const ok = { qty: 1, unit_price_ex_vat: 1_000, vat_rate_bps: 1000 };
  it.each([
    ["qty 0", [{ ...ok, qty: 0 }], 0],
    ["qty 10.000", [{ ...ok, qty: 10_000 }], 0],
    ["qty 1,5", [{ ...ok, qty: 1.5 }], 0],
    ["price −1", [{ ...ok, unit_price_ex_vat: -1 }], 0],
    ["price 1,5", [{ ...ok, unit_price_ex_vat: 1.5 }], 0],
    ["price > 10^12", [{ ...ok, unit_price_ex_vat: 1_000_000_000_001 }], 0],
    ["VAT 7%", [{ ...ok, vat_rate_bps: 700 }], 0],
    ["discount −1", [ok], -1],
    ["discount 10.001", [ok], 10_001],
    ["discount 0,5", [ok], 0.5],
    ["0 lines", [], 0],
    ["51 lines", Array.from({ length: 51 }, () => ok), 0],
  ] as Array<[string, LineIn[], number]>)("%s", (_name, lines, discount) => {
    expect(() => money.priceLines(lines, discount)).toThrow(RangeError);
  });

  it("past Number.MAX_SAFE_INTEGER → RangeError, not a wrong number", () => {
    const huge = Array.from({ length: 50 }, () => ({ qty: 9_999, unit_price_ex_vat: 1_000_000_000_000, vat_rate_bps: 1000 }));
    expect(() => money.priceLines(huge, 0)).toThrow(RangeError);
  });

  it("the top of the range still adds up exactly", () => {
    const r = money.priceLines([{ qty: 9_999, unit_price_ex_vat: 100_000_000, vat_rate_bps: 1000 }], 0);
    expect(r).toMatchObject({ total_ex_vat: 999_900_000_000, vat_total: 99_990_000_000, total: 1_099_890_000_000 });
  });
});

describe("unitPriceIncVat — display price with VAT (half-up)", () => {
  it.each([
    [1_000_000, 1000, 1_100_000],
    [1_100_000, 800, 1_188_000],
    [2_700_000, null, 2_700_000],
    [100_000, 0, 100_000],
    [12_345, 800, 13_333],
    [5, 1000, 6],
  ] as Array<[number, number | null, number]>)("%i at %s bps → %i", (price, rate, inc) => {
    expect(money.unitPriceIncVat(price, rate)).toBe(inc);
  });
});

describe("price at date D (FR-3)", () => {
  // G6 (SPEC-08 §3.1), given out of order on purpose
  const levels = [
    { id: "b", effective_from: "2026-07-01" },
    { id: "a", effective_from: "2025-01-01" },
    { id: "c", effective_from: "2027-01-01" },
  ];

  it("picks the greatest effective_from ≤ D", () => {
    expect(at.levelAt(levels, "2026-06-30")?.id).toBe("a");
    expect(at.levelAt(levels, "2026-07-01")?.id).toBe("b");
    expect(at.levelAt(levels, "2026-12-31")?.id).toBe("b");
    expect(at.levelAt(levels, "2027-01-01")?.id).toBe("c");
  });

  it("no level on or before D → null (\"chưa có giá ngày D\")", () => {
    expect(at.levelAt(levels, "2024-12-31")).toBeNull();
    expect(at.levelAt([], "2026-10-01")).toBeNull();
  });

  it("a level ends the day before the next one (computed, never stored); newest first", () => {
    expect(at.withEffectiveTo(levels).map((l) => [l.id, l.effective_to])).toEqual([
      ["c", null],
      ["b", "2026-12-31"],
      ["a", "2026-06-30"],
    ]);
    // across a leap day
    expect(at.withEffectiveTo([{ effective_from: "2028-03-01" }, { effective_from: "2028-01-01" }])[1]?.effective_to).toBe("2028-02-29");
  });

  it("status relative to today: past · current · scheduled", () => {
    const today = "2026-10-01";
    expect(levels.map((l) => [l.id, at.levelStatus(l, levels, today)])).toEqual([
      ["b", "current"],
      ["a", "past"],
      ["c", "scheduled"],
    ]);
    // a level starting today is current from 00:00 (VN)
    expect(at.levelStatus(levels[2]!, levels, "2027-01-01")).toBe("current");
  });
});
