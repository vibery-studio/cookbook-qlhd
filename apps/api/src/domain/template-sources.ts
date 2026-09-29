// The ONE place that says which field sources exist (SPEC-02 §3.3 / §3.6).
// Adding a source = add it here; row 3 resolves it, the template check accepts it.
export const SOURCE_REGISTRY: Readonly<Record<string, readonly string[]>> = {
  subject: ["name", "contact_person", "tax_code", "phone", "email", "address"],
  price_list: ["code", "name", "unit_price", "duration_value", "duration_unit"],
  derived: ["doc_date", "contract_end", "total", "total_in_words", "discount_bps"],
  issue: ["number"],
};

/** `manual` has no reference; every other source is `kind:ref` with ref in the registry. */
export function isResolvableSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  if (source === "manual") return true;
  const i = source.indexOf(":");
  if (i <= 0) return false;
  const kind = source.slice(0, i);
  const ref = source.slice(i + 1);
  if (!Object.prototype.hasOwnProperty.call(SOURCE_REGISTRY, kind)) return false;
  return SOURCE_REGISTRY[kind]!.includes(ref);
}

// Q-5: sensible ceilings, not business rules.
export const LIMITS = {
  bodyBytes: 64 * 1024,
  fields: 60,
  steps: 10,
} as const;
