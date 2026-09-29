/**
 * Vietnamese phone normalisation (SPEC-01 DEC-4). Canonical form is the domestic one: `0` + 9–10 digits.
 * `0901 234 567`, `0901.234.567`, `+84901234567`, `84901234567` → `0901234567`. Anything else → `null`.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("84") && (digits.length === 11 || digits.length === 12)) {
    digits = `0${digits.slice(2)}`;
  }
  return /^0\d{9,10}$/.test(digits) ? digits : null;
}
