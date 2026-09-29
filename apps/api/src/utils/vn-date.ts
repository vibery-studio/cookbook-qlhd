/** Business calendar helpers (SPEC-01 §4 Time). Pure — reused by row 3 (doc dates, series years). */
export const BUSINESS_TZ = "Asia/Ho_Chi_Minh";

const vnDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day (YYYY-MM-DD) it is in Vietnam at instant `now`. */
export function todayInVN(now: Date): string {
  const parts = vnDateFormat.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Strict YYYY-MM-DD that is a real calendar date. */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
