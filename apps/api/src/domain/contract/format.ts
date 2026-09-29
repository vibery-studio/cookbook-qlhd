import { isValidIsoDate } from "../../utils/vn-date";

function assertNonNegativeInteger(name: string, value: number, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

export function formatMoney(n: number): string {
  assertNonNegativeInteger("money", n);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatDateVN(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null || !isValidIsoDate(iso)) {
    throw new RangeError(`invalid ISO date: ${iso}`);
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatPercentBps(bps: number): string {
  assertNonNegativeInteger("basis points", bps, 10_000);
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole},${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
