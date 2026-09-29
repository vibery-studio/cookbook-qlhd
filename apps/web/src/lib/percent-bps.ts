/**
 * Parse a percentage typed by a person ("7,5" or "7.5") into integer basis points (750).
 * String-only, no floats. Max 2 decimals, range 0-100. Anything else -> null.
 */
export function parsePercentToBps(input: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number.parseInt(match[1] ?? "", 10);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const bps = whole * 100 + Number.parseInt(fraction || "0", 10);
  return bps <= 10000 ? bps : null;
}
