import { formatIsoDate } from "../../lib/vn-date";

export type VatBps = 0 | 500 | 800 | 1000 | null;
export type LevelStatus = "scheduled" | "current" | "past";

export const NO_RIGHT_TEXT = "Chỉ Quản lý, Giám đốc sửa sản phẩm/đặt giá";
export const LEVEL_STATUS_LABEL: Readonly<Record<LevelStatus, string>> = {
  scheduled: "Sắp áp dụng",
  current: "Đang áp dụng",
  past: "Đã hết",
};

/** DEC-4: 0 · 5 · 8 · 10 % and KCT (not taxable) — KCT is not 0%. */
export const VAT_OPTIONS: ReadonlyArray<{ value: string; label: string; bps: VatBps }> = [
  { value: "0", label: "0%", bps: 0 },
  { value: "500", label: "5%", bps: 500 },
  { value: "800", label: "8%", bps: 800 },
  { value: "1000", label: "10%", bps: 1000 },
  { value: "kct", label: "KCT", bps: null },
];

export function vatLabel(bps: number | null): string {
  return bps === null ? "KCT" : `${bps / 100}%`;
}

export function parseVatOption(value: string): VatBps {
  return VAT_OPTIONS.find((o) => o.value === value)?.bps ?? null;
}

export function vatOptionValue(bps: number | null): string {
  return bps === null ? "kct" : String(bps);
}

const plain = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0, useGrouping: true });
/** "2.700.000" — dot thousands, no currency sign (table cells are mono, right-aligned). */
export function formatPlainMoney(value: number): string {
  return plain.format(value);
}

/**
 * Display-only mirror of the server's unitPriceIncVat (apps/api/src/domain/money/line-pricing.ts): VAT half-up in đồng.
 * The server is the source of truth; this only feeds the live "Giá gồm VAT" text.
 */
export function priceIncVat(exVat: number, bps: number | null): number {
  if (bps === null) return exVat;
  return exVat + Math.floor((exVat * bps + 5_000) / 10_000);
}

/** "2.600.000 từ 01/01/2027", or "—" when nothing is scheduled. */
export function nextPriceText(level: { unit_price_ex_vat: number; effective_from: string } | null): string {
  return level ? `${formatPlainMoney(level.unit_price_ex_vat)} từ ${formatIsoDate(level.effective_from)}` : "—";
}

export function durationLabel(value: number | null, unit: "day" | "month" | null): string {
  if (value === null || unit === null) return "—";
  return `${value} ${unit === "month" ? "tháng" : "ngày"}`;
}

const VN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today on the Vietnam calendar, "YYYY-MM-DD" (DEC-5: a new product's first level may start today). */
export function todayIso(now = Date.now()): string {
  return VN_DAY.format(new Date(now));
}

/** Tomorrow on the Vietnam calendar (DEC-5: every later level starts tomorrow at the earliest). */
export function tomorrowIso(now = Date.now()): string {
  const d = new Date(`${todayIso(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const KIND_LABEL = { service: "Dịch vụ", goods: "Hàng hóa" } as const;

/** "50000" · "50.000" · "50 000" → 50000; anything else (empty, decimals, negatives, > 10^12) → null. */
export function parseMoney(text: string): number | null {
  const digits = text.trim().replace(/[.\s]/g, "");
  if (!/^\d{1,13}$/.test(digits)) return null;
  const value = Number(digits);
  return value <= 1_000_000_000_000 ? value : null;
}
