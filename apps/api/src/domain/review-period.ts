/**
 * Access-review quarter (SPEC-07 FR-7, DEC-12). The quarter is taken in Asia/Ho_Chi_Minh (UTC+7, no DST), so
 * 2026-12-31T17:30Z is already 2027-Q1. Pure, no Date.now().
 */
const VN_OFFSET_SECONDS = 7 * 60 * 60;

/** "YYYY-Qn" of a unix-seconds instant, read on the Vietnam wall clock. */
export function quarterOf(nowSeconds: number): string {
  const vn = new Date((nowSeconds + VN_OFFSET_SECONDS) * 1000);
  const quarter = Math.floor(vn.getUTCMonth() / 3) + 1;
  return `${vn.getUTCFullYear()}-Q${quarter}`;
}

/** A review is due 15 days after it opens (FR-8). */
export const REVIEW_DUE_SECONDS = 15 * 24 * 60 * 60;
