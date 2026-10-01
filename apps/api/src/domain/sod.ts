/**
 * Separation of duties (SPEC-07 FR-2, DEC-9 B): a role must not hold both codes of a declared permission pair.
 * Pure check on a proposed permission set — used before a batch for a clear 409; the SQL twin
 * (`sodClearSql`, dao/sod-dao.ts) repeats it inside the WHERE so a concurrent pair declaration cannot slip in.
 */
export interface SodPairKeys {
  perm_a: string;
  perm_b: string;
}

/** Every pair whose two codes are both in `perms`, as `[perm_a, perm_b]` in pair order. */
export function sodViolations(perms: readonly string[], pairs: readonly SodPairKeys[]): [string, string][] {
  const held = new Set(perms);
  return pairs.filter((p) => held.has(p.perm_a) && held.has(p.perm_b)).map((p) => [p.perm_a, p.perm_b]);
}
