export const SERIES = { contract: { prefix: "HD", pad: 3 } } as const;

export function formatNumber(prefix: string, year: number, seq: number, pad: number): string {
  if (prefix.length === 0 || !Number.isSafeInteger(year) || !Number.isSafeInteger(seq) || seq < 0) {
    throw new RangeError("invalid number series arguments");
  }
  if (!Number.isSafeInteger(pad) || pad < 1) throw new RangeError("pad must be a positive integer");
  return `${prefix}-${year}-${String(seq).padStart(pad, "0")}`;
}
