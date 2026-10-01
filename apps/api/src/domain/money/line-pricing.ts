/**
 * Pure money functions (SPEC-08 §3.3, FR-11): per-line discount before tax (DEC-3), VAT half-up once per rate group (DEC-2),
 * KCT (null) is not 0% (DEC-4). Integer đồng only, BigInt arithmetic, RangeError on bad input or past MAX_SAFE_INTEGER.
 * Imports nothing from the contract domain — shared by contracts now and quotes / delivery notes later.
 */
export const VAT_RATES_BPS = [0, 500, 800, 1000] as const;
export const MAX_LINES = 50;
export const MAX_QTY = 9_999;
export const MAX_UNIT_PRICE = 1_000_000_000_000;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export interface PricingLineIn {
  qty: number;
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
}
export interface PricedLineAmounts {
  amount_ex_vat: number;
  discount_amount: number;
  net_ex_vat: number;
}
export interface VatGroup {
  vat_rate_bps: number | null;
  base: number;
  vat: number;
}
export interface PricedLines<T> {
  lines: Array<T & PricedLineAmounts>;
  vat_groups: VatGroup[];
  subtotal_ex_vat: number;
  discount_amount: number;
  total_ex_vat: number;
  vat_total: number;
  total: number;
}

function assertInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in the range ${min}..${max}`);
  }
}

function assertRate(rate: number | null): void {
  if (rate !== null && !(VAT_RATES_BPS as readonly number[]).includes(rate)) {
    throw new RangeError("vat_rate_bps must be 0, 500, 800, 1000 or null (KCT)");
  }
}

function safe(value: bigint): bigint {
  if (value > MAX_SAFE) throw new RangeError("amount exceeds the safe integer range");
  return value;
}

/** half-up of (n × bps) / 10_000, n ≥ 0 */
function bpsHalfUp(n: bigint, bps: number): bigint {
  return (n * BigInt(bps) + 5_000n) / 10_000n;
}

export function priceLines<T extends PricingLineIn>(lines: readonly T[], discountBps: number): PricedLines<T> {
  if (lines.length < 1 || lines.length > MAX_LINES) throw new RangeError(`lines must have 1..${MAX_LINES} items`);
  assertInteger("discountBps", discountBps, 0, 10_000);

  let subtotal = 0n;
  let discount = 0n;
  let totalExVat = 0n;
  const bases = new Map<number | null, bigint>();

  const out = lines.map((line, i) => {
    assertInteger(`lines.${i}.qty`, line.qty, 1, MAX_QTY);
    assertInteger(`lines.${i}.unit_price_ex_vat`, line.unit_price_ex_vat, 0, MAX_UNIT_PRICE);
    assertRate(line.vat_rate_bps);

    const amount = safe(BigInt(line.unit_price_ex_vat) * BigInt(line.qty));
    const lineDiscount = bpsHalfUp(amount, discountBps);
    const net = amount - lineDiscount;

    subtotal = safe(subtotal + amount);
    discount = safe(discount + lineDiscount);
    totalExVat = safe(totalExVat + net);
    bases.set(line.vat_rate_bps, safe((bases.get(line.vat_rate_bps) ?? 0n) + net));

    return {
      ...line,
      amount_ex_vat: Number(amount),
      discount_amount: Number(lineDiscount),
      net_ex_vat: Number(net),
    };
  });

  const vatGroups = [...bases.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a - b))
    .map(([rate, base]) => ({
      rate,
      base,
      vat: rate === null ? 0n : bpsHalfUp(base, rate),
    }));

  const vatTotal = vatGroups.reduce((s, g) => s + g.vat, 0n);
  const total = safe(totalExVat + vatTotal);

  return {
    lines: out,
    vat_groups: vatGroups.map((g) => ({ vat_rate_bps: g.rate, base: Number(g.base), vat: Number(g.vat) })),
    subtotal_ex_vat: Number(subtotal),
    discount_amount: Number(discount),
    total_ex_vat: Number(totalExVat),
    vat_total: Number(vatTotal),
    total: Number(total),
  };
}

/** Display price with VAT, half-up. KCT / 0% → unchanged. */
export function unitPriceIncVat(unitPriceExVat: number, vatRateBps: number | null): number {
  assertInteger("unitPriceExVat", unitPriceExVat, 0, MAX_UNIT_PRICE);
  assertRate(vatRateBps);
  if (vatRateBps === null) return unitPriceExVat;
  return unitPriceExVat + Number(bpsHalfUp(BigInt(unitPriceExVat), vatRateBps));
}

/** "KCT" · "KCT, 10%" · "8%, 10%" — groups in the order given (priceLines order). */
export function vatRatesLabel(groups: ReadonlyArray<{ vat_rate_bps: number | null }>): string {
  return groups.map((g) => (g.vat_rate_bps === null ? "KCT" : `${g.vat_rate_bps / 100}%`)).join(", ");
}
