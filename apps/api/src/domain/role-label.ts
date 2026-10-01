/**
 * SPEC-06 §3.1 — `roles.label_key`: the duplicate-detection form of a role's display name.
 * NFC → trim → collapse whitespace runs to one space → `toLocaleLowerCase('vi')`.
 * Must match the literals backfilled in migration 0017 (e.g. 'giám đốc').
 */
export function normalizeLabel(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
}
