/**
 * FIX-06 — the ONE copy of `grant_not_held` for role permission sets (SPEC-06 FR-12, SPEC-07, C-11-001): a caller may add
 * only codes they hold (read from D1 `user_roles`, never the principal cache; nobody is exempt, `admin` included).
 * Dropping a code you don't hold is allowed. Used by create / change request / approve / direct change, and by `GET /roles`
 * (`can.grant`, `grantable`) so the web never re-derives it.
 */

/** Codes of `adding` the caller does not hold, sorted. Empty = allowed. */
export function grantMissing(adding: Iterable<string>, held: ReadonlySet<string>): string[] {
  return [...adding].filter((k) => !held.has(k)).sort();
}

/** The catalog codes the caller may add to a role that holds `current` now (catalog order). */
export function grantableCodes(catalog: readonly string[], current: readonly string[], held: ReadonlySet<string>): string[] {
  const has = new Set(current);
  return catalog.filter((k) => !has.has(k) && grantMissing([k], held).length === 0);
}
