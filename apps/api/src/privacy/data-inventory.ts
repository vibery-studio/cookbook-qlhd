/**
 * Data inventory registry — enumerates every table with user-owned data
 * plus its export/delete policy. The export + deletion services iterate
 * this list in declared order, so the ORDER MATTERS: put child tables
 * first (they must be erased before their parent's `users` row is
 * anonymized).
 *
 * Adding a new user-data table:
 *   1. Append a `DataInventoryEntry` here BEFORE `USERS_ENTRY`.
 *   2. Ensure the `ownerColumn` name matches the table's foreign-key
 *      column (all v1 tables use `user_id`).
 *   3. Ship a migration if a new column joins to `users`.
 *
 * System tables (settings, feature_flags, roles, permissions,
 * role_permissions, user_roles, schema_versions) are DELIBERATELY OUT
 * of this list — they carry no personal data (user_roles is a
 * many-to-many join where the identifier is derivable, and role
 * assignments are policy metadata rather than personal state; if
 * multi-tenancy lands in v2 that changes).
 *
 * Cross-check: `inventoryCoversUserDataTables()` in
 * `apps/api/test/integration/privacy-flow.test.ts` asserts every table
 * in `db/schema.ts` with a `user_id` column appears here.
 */

export interface DataInventoryEntry {
  /** SQL table name — must match a `sqliteTable` declaration in schema.ts. */
  readonly table: string;
  /** Column holding the owning user's id. `null` for the `users` row itself. */
  readonly ownerColumn: string | null;
  /** Contains personally-identifiable data. Enforcement hint only. */
  readonly personal: boolean;
  /** Included in `/me/export` archives. */
  readonly exportable: boolean;
  /**
   * Erasure behavior on `/me/delete`:
   *   - "delete"    — row removed from the table
   *   - "anonymize" — row retained with PII scrubbed (only meaningful
   *                    for the `users` row itself; used to preserve
   *                    proof-of-erasure via the identity_hash audit)
   *   - "skip"      — retained as-is (legally required audit trails,
   *                    financial records — not present in v1.1 but
   *                    the mechanism supports it)
   */
  readonly onDelete: "delete" | "anonymize" | "skip";
}

/**
 * Order matters: children (rows that reference `users.id`) first, then
 * the `users` row last. The deletion service walks this list top-to-
 * bottom.
 */
export const DATA_INVENTORY: readonly DataInventoryEntry[] = [
  {
    table: "notes",
    ownerColumn: "user_id",
    personal: true,
    exportable: true,
    onDelete: "delete",
  },
  {
    table: "refresh_tokens",
    ownerColumn: "user_id",
    personal: false,
    exportable: false, // security tokens — never in an archive
    onDelete: "delete",
  },
  {
    table: "verification_tokens",
    ownerColumn: "user_id",
    personal: false,
    exportable: false,
    onDelete: "delete",
  },
  {
    table: "jwt_revocations",
    ownerColumn: "user_id",
    personal: false,
    exportable: false,
    onDelete: "delete",
  },
  {
    table: "user_roles",
    ownerColumn: "user_id",
    personal: false,
    exportable: true, // "what roles did this account carry"
    onDelete: "delete",
  },
  {
    table: "user_exports",
    ownerColumn: "user_id",
    personal: true, // may contain past archive metadata about the user
    exportable: false, // don't recursively export the export ledger
    onDelete: "delete",
  },
  {
    // In-app audit trail (SPEC-01 FR-4). Kept on erasure: every move must stay signed for
    // (documents.workbook I7); the actor id then points at the anonymized users row.
    table: "audit_events",
    ownerColumn: "actor",
    personal: true, // ip
    exportable: true,
    onDelete: "skip",
  },
  {
    table: "users",
    ownerColumn: null,
    personal: true,
    exportable: true,
    onDelete: "anonymize",
  },
];

/**
 * Every table that stores user-owned data appears in DATA_INVENTORY. The
 * complement — tables where privacy has no work to do — is used by tests
 * to make the coverage-check exhaustive; if a new table lands in
 * schema.ts, either the tests fail or the inventory grows.
 */
export const INVENTORY_EXEMPT_TABLES: readonly string[] = [
  "settings",
  "feature_flags",
  "roles",
  "permissions",
  "role_permissions",
  "schema_versions",
  "idempotency_keys",
  // business records, not the staff member's personal data (SPEC-01)
  "customers",
  "price_list",
  // contract templates: business records, no personal data (SPEC-02)
  "templates",
  "template_versions",
];
