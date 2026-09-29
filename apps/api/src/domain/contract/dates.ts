import { isValidIsoDate, todayInVN } from "../../utils/vn-date";

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  if (!isValidIsoDate(iso)) throw new RangeError(`invalid ISO date: ${iso}`);
  const parts = iso.split("-").map(Number);
  return { year: parts[0]!, month: parts[1]!, day: parts[2]! };
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Return the last day of a target month when the anniversary day does not exist. */
export function contractEnd(startIso: string, months: number): string {
  const start = parseIsoDate(startIso);
  if (!Number.isSafeInteger(months) || months < 1) {
    throw new RangeError("months must be a positive integer");
  }

  const targetMonthIndex = start.year * 12 + (start.month - 1) + months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();

  if (start.day > lastTargetDay) return iso(targetYear, targetMonth, lastTargetDay);

  const anniversary = Date.UTC(targetYear, targetMonth - 1, start.day);
  const end = new Date(anniversary - 86_400_000);
  return iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
}

/** The Vietnamese business year for an instant. */
export function seriesYear(now: Date): number {
  return Number(todayInVN(now).slice(0, 4));
}
