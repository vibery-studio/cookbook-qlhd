/**
 * Drizzle schema — source of truth for the v1 D1 database.
 *
 * v1 is single-tenant: no `scope` column on `user_roles` or `settings`
 * (multi-tenant scoping is a v2 migration). No `audit_log` table — audit
 * events are structured logs shipped via Logpush (see Phase 9), not a D1
 * table. No FK constraints are declared in the DDL: D1's
 * `PRAGMA foreign_keys` is not reliably persistent across HTTP-fronted
 * statements, so parent-child cascade is enforced at the application layer
 * inside DAOs (see `apps/api/src/dao/**`), not by SQLite.
 *
 * All IDs are ULID `TEXT`. All timestamps are `INTEGER` unix seconds (D1 has
 * no native TIMESTAMP type).
 */
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Sentinel table used by the post-deploy `/readyz` check (Phase 10) to
 * verify the applied migration head matches the Worker's compiled
 * `SCHEMA_HEAD` build var. Always has exactly one row — the latest applied
 * migration filename. Population is done by the `db:migrate:*` wrapper
 * script (Phase 10 delivery) or manually via `wrangler d1 execute` — see
 * docs/deploy.md § "Schema-version sentinel". The row is NOT written by
 * this migration.
 */
export const schemaVersions = sqliteTable("schema_versions", {
  head: text("head").primaryKey(),
  appliedAt: integer("applied_at").notNull(),
});

/**
 * Application users. `passwordHash` is a scrypt-encoded string
 * (`@noble/hashes/scrypt`, Phase 5). `status` gates login until email
 * verification completes.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    status: text("status").notNull().default("pending"), // pending | active | disabled
    verifiedAt: integer("verified_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    verifyEmailResendCount: integer("verify_email_resend_count").notNull().default(0),
    /**
     * GDPR account-deletion pipeline (Phase 3 v1.1). `deletionRequestedAt`
     * flags a user for erasure by the nightly privacy sweeper; the actual
     * erasure runs after `privacy.deletion_grace_seconds` has passed. Sessions
     * are revoked immediately at request time (not gated by the grace
     * window) — the grace protects against accidental self-erasure only.
     * `deletedAt` records the sweeper's completion timestamp; the user
     * row is retained + anonymized as immutable proof of erasure.
     */
    deletionRequestedAt: integer("deletion_requested_at"),
    deletedAt: integer("deleted_at"),
    /**
     * Last successful `/me/export` timestamp. Enforces one export per user
     * per grace window (default 24h, see docs/privacy.md).
     */
    lastExportAt: integer("last_export_at"),
    /** Name shown in lists and the audit log (SPEC-01). Required for invited users; NULL on legacy rows. */
    displayName: text("display_name"),
  },
  (table) => [index("idx_users_email").on(table.email)],
);

/**
 * User data export requests (Phase 3 v1.1). One row per `POST /me/export`
 * call. v1.1 delivers the archive inline in the HTTP response; the
 * `archive_url` column is reserved for a future R2-backed async path
 * documented in `docs/privacy.md`. Rows expire per
 * `privacy.export_retention_seconds` and are swept by the same pruner
 * that handles deleted-user erasure.
 */
export const userExports = sqliteTable(
  "user_exports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("completed"), // pending | completed | failed
    archiveUrl: text("archive_url"),
    requestedAt: integer("requested_at").notNull(),
    completedAt: integer("completed_at"),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idx_user_exports_user").on(table.userId, table.requestedAt),
    index("idx_user_exports_expires").on(table.expiresAt),
  ],
);

/**
 * RBAC roles catalog (e.g. 'admin', 'member'). No `scope` column in v1.
 * SPEC-06 §3.1: `name` is the immutable identity (approval steps + `can()` match by name); custom roles get a
 * server-made `r_<ulid>`. `label` = Vietnamese display name; `label_key` = normalized label (NFC, trim, collapsed
 * spaces, `toLocaleLowerCase('vi')`, computed in the app) for duplicate checks. `is_system` = seed role (never
 * deleted/renamed). `version` = CAS for edits. Added by an expand-only ALTER (0016) — never a table rebuild.
 */
export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  label: text("label"),
  labelKey: text("label_key").unique(),
  isSystem: integer("is_system").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

/**
 * RBAC permissions catalog (e.g. 'users:read', 'settings:write').
 */
export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
});

/**
 * Role <-> permission join. Composite PK, no surrogate id. No FK
 * declarations — application-level cascade only.
 */
export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull(),
    permissionId: text("permission_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

/**
 * User <-> role join. Composite PK. **No `scope` column** (Red Team F14 —
 * v1 is single-tenant; multi-tenant scoping is a v2 migration).
 */
export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

/**
 * Single-use tokens for email verification and password reset.
 * `tokenHash` is `HMAC-SHA256(rawToken, TOKEN_PEPPER)` — the raw token is
 * never stored (Phase 5 owns the crypto; this table only defines the shape).
 * Consumption uses a CAS pattern guarded by `used_at IS NULL`.
 */
export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    purpose: text("purpose").notNull(), // 'verify_email' | 'password_reset'
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_verify_user").on(table.userId)],
);

/**
 * Refresh tokens (7d TTL), rotated via atomic CAS
 * (`UPDATE ... WHERE revoked_at IS NULL`). `tokenHash` is
 * `HMAC-SHA256(rawToken, TOKEN_PEPPER)`. `replacedByHash` forms a rotation
 * chain used for replay detection.
 */
export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    replacedByHash: text("replaced_by_hash"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_refresh_user").on(table.userId)],
);

/**
 * JWT `jti` blocklist (Red Team F10 fold-in). Short-TTL (120s) access
 * tokens are checked against this table on the auth middleware hot path;
 * rows are safe to prune once `expires_at` (the original JWT expiry) has
 * passed.
 */
export const jwtRevocations = sqliteTable(
  "jwt_revocations",
  {
    jti: text("jti").primaryKey(),
    userId: text("user_id").notNull(),
    reason: text("reason").notNull(), // 'logout' | 'admin_disable' | 'password_reset'
    revokedAt: integer("revoked_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idx_jwt_rev_user").on(table.userId),
    index("idx_jwt_rev_expires").on(table.expiresAt),
  ],
);

/**
 * Runtime-mutable System Settings (Phase 8). `value` is a JSON string.
 * **No `scope` column** (Red Team F14 — v1 is single-tenant).
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

/**
 * Idempotency records (Phase 9). `key` is the sha256 of the namespaced
 * string `${principalId}:${method}:${path}:${header}` (Red Team F7 — bounds
 * key length and prevents cross-endpoint replay). `response_status IS NULL`
 * is the CAS "in-flight" sentinel used to serialize concurrent same-key
 * requests.
 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("idx_idem_expires").on(table.expiresAt)],
);

/**
 * Feature flags (Phase 2 — v1.1 operational control plane). Runtime-mutable
 * behavior switches — distinct from `settings` (which mutate *values*). Read
 * hot-path served from KV cache (5min TTL) with D1 fallback; writes bust
 * cache + emit a SYNC audit event.
 *
 * Storage:
 *   - `enabled`     boolean 0/1 (INTEGER for SQLite compatibility).
 *   - `percentage`  null for boolean-only flags; 0-100 for gradual rollout.
 *   - `allowlist`   nullable JSON array of principal ids (overrides percentage
 *                   evaluation — matched principals always get true when the
 *                   flag is enabled).
 *
 * The registry (`apps/api/src/flags/registry.ts`) declares which keys are
 * valid; unknown keys are rejected at the admin write path. `updated_by` is
 * null for seed rows.
 */
export const featureFlags = sqliteTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  percentage: integer("percentage"),
  allowlist: text("allowlist"),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

/**
 * Demo `notes` resource (Phase 9). Showcases idempotency + ownership
 * end-to-end. Delete this + its migration when adapting the blueprint
 * to a real product. Owner enforcement is application-level (no FK).
 */
export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_notes_user").on(table.userId, table.createdAt)],
);

/**
 * In-app audit store (SPEC-01 FR-4, docs/recipes/add-audit-store.md). Append-only; `metadata` is
 * deep-scrubbed JSON and never carries customer PII. Status moves write their row in the same batch.
 */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    actor: text("actor"),
    action: text("action").notNull(),
    target: text("target"),
    metadata: text("metadata"),
    ip: text("ip"),
  },
  (table) => [
    index("idx_audit_ts").on(table.ts),
    index("idx_audit_target").on(table.target, table.ts),
    index("idx_audit_actor").on(table.actor, table.ts),
    index("idx_audit_action").on(table.action, table.ts),
  ],
);

/**
 * Customers (SPEC-01 FR-5) — the subject a contract is made for. Never deleted (contracts point here).
 * `phone_norm` = digits-only local form used for duplicate detection; `version` guards concurrent edits.
 */
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    taxCode: text("tax_code"),
    phone: text("phone"),
    phoneNorm: text("phone_norm"),
    email: text("email"),
    address: text("address"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("uq_customers_phone_norm").on(table.phoneNorm).where(sql`phone_norm IS NOT NULL`),
    uniqueIndex("uq_customers_tax_code").on(table.taxCode).where(sql`tax_code IS NOT NULL`),
    index("idx_customers_name").on(table.name),
  ],
);

/**
 * Price list (SPEC-01 FR-6), seeded from the owner's 09_Bang_Gia.xlsx. Read-only in the app; a price
 * change is a new migration. Prices are whole đồng, VAT included. Dates are ISO `YYYY-MM-DD` (business zone).
 */
export const priceList = sqliteTable(
  "price_list",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    durationValue: integer("duration_value").notNull(),
    durationUnit: text("duration_unit").notNull(), // day | month
    unitPrice: integer("unit_price").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    note: text("note"),
  },
  (table) => [uniqueIndex("uq_price_list_code_from").on(table.code, table.effectiveFrom)],
);

/**
 * Contract templates (SPEC-02 §3.1). `name_norm` = trimmed/lower-cased name, UNIQUE. `current_version_id`
 * is a plain TEXT pointer (no FK: templates <-> template_versions would be circular) moved only by a CAS
 * in the same batch as the version INSERT. `created_by` NULL = seeded by a migration (system).
 */
export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // contract
    name: text("name").notNull(),
    nameNorm: text("name_norm").notNull(),
    subjectType: text("subject_type").notNull(), // customer
    currentVersionId: text("current_version_id"),
    active: integer("active").notNull().default(1),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_templates_name_norm").on(table.nameNorm)],
);

/**
 * Template versions — APPEND-ONLY (no `updated_*`; a DB trigger refuses UPDATE/DELETE, SPEC-02 DEC-6).
 * JSON columns hold the fixed shapes of SPEC-02 §3.3/§3.4/§3.6.
 */
export const templateVersions = sqliteTable(
  "template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id),
    versionNo: integer("version_no").notNull(),
    body: text("body").notNull(),
    fields: text("fields").notNull(),
    defaultLineItems: text("default_line_items").notNull(),
    defaultClauses: text("default_clauses").notNull(),
    approvalPolicy: text("approval_policy").notNull(),
    fieldRules: text("field_rules").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("uq_template_versions_tpl_no").on(table.templateId, table.versionNo)],
);

/**
 * Contracts (SPEC-03 §3.1). Never hard-deleted. `snapshot`/`snapshot_hash` never overwritten after draft;
 * `seq`/`number`/`rendered_*` never overwritten once set. Number allocation = one CAS UPDATE (no counter table):
 * UNIQUE(type, series_year, seq) is the gap-free guard, partial so drafts (seq NULL) never collide.
 */
export const contracts = sqliteTable(
  "contracts",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // contract (number prefix HD)
    templateId: text("template_id").notNull(),
    templateVersionId: text("template_version_id").notNull(),
    customerId: text("customer_id").notNull(),
    sourceContractId: text("source_contract_id"),
    status: text("status").notNull(), // draft | pending | approved | rejected | issued | voided
    createdBy: text("created_by").notNull(),
    docDate: text("doc_date").notNull(), // YYYY-MM-DD (business zone)
    snapshot: text("snapshot").notNull(), // JSON
    snapshotHash: text("snapshot_hash").notNull(),
    customerName: text("customer_name").notNull(), // copied from snapshot for the list
    total: integer("total").notNull(), // whole dong, copied from snapshot
    version: integer("version").notNull().default(1), // CAS for draft edits
    seriesYear: integer("series_year"),
    seq: integer("seq"),
    number: text("number"),
    issueToken: text("issue_token"),
    issuedBy: text("issued_by"),
    issuedAt: integer("issued_at"),
    renderedHtml: text("rendered_html"),
    renderedHash: text("rendered_hash"),
    submittedAt: integer("submitted_at"),
    decidedAt: integer("decided_at"),
    voidedBy: text("voided_by"),
    voidedAt: integer("voided_at"),
    voidReason: text("void_reason"),
    replacedById: text("replaced_by_id"),
    // SPEC-05 §3.1: the issued PDF in R2, made on the first download. Written once (CAS WHERE pdf_key IS NULL).
    pdfKey: text("pdf_key"),
    pdfHash: text("pdf_hash"),
    pdfSize: integer("pdf_size"),
    pdfAt: integer("pdf_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("ck_contracts_type", sql`${table.type} = 'contract'`),
    check(
      "ck_contracts_status",
      sql`${table.status} IN ('draft','pending','approved','rejected','issued','voided')`,
    ),
    check("ck_contracts_seq_iff_issued", sql`(${table.status} IN ('issued','voided')) = (${table.seq} IS NOT NULL)`),
    check("ck_contracts_void_reason", sql`${table.status} <> 'voided' OR ${table.voidReason} IS NOT NULL`),
    uniqueIndex("uq_contracts_series_seq")
      .on(table.type, table.seriesYear, table.seq)
      .where(sql`seq IS NOT NULL`),
    uniqueIndex("uq_contracts_number").on(table.number).where(sql`number IS NOT NULL`),
    index("idx_contracts_type_status_updated").on(table.type, table.status, table.updatedAt),
    index("idx_contracts_customer").on(table.customerId),
    index("idx_contracts_created_by").on(table.createdBy),
  ],
);

/**
 * Approval steps (SPEC-03 §3.1) — one row per required step, created at submit. `decided_by` is staff
 * decision history (kept on erasure, like audit_events).
 */
export const approvalSteps = sqliteTable(
  "approval_steps",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id").notNull(),
    stepNo: integer("step_no").notNull(),
    label: text("label").notNull(),
    requiredPermission: text("required_permission").notNull(),
    requiredRole: text("required_role"),
    status: text("status").notNull(), // waiting | approved | rejected
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at"),
    note: text("note"),
    snapshotHashAtDecision: text("snapshot_hash_at_decision"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check("ck_approval_steps_status", sql`${table.status} IN ('waiting','approved','rejected')`),
    uniqueIndex("uq_approval_steps_contract_step").on(table.contractId, table.stepNo),
    index("idx_approval_steps_status_perm").on(table.status, table.requiredPermission),
  ],
);

/**
 * SoD pairs (SPEC-07 §3.1, DEC-9 B): no role may hold both permission keys. Keys are catalog codes (no FK — the
 * catalog is closed); stored `perm_a < perm_b` so (A,B) and (B,A) hit the same UNIQUE. Independent of roles.
 */
export const sodPairs = sqliteTable(
  "sod_pairs",
  {
    id: text("id").primaryKey(),
    permA: text("perm_a").notNull(),
    permB: text("perm_b").notNull(),
    reason: text("reason"), // ≤200
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check("ck_sod_pairs_distinct", sql`${table.permA} <> ${table.permB}`),
    check("ck_sod_pairs_ordered", sql`${table.permA} < ${table.permB}`),
    uniqueIndex("uq_sod_pairs_ab").on(table.permA, table.permB),
  ],
);

/**
 * Four-eyes role permission change requests (SPEC-07 §3.1, FR-3/4). `added`/`removed` = JSON arrays of keys;
 * `base_version` pins `roles.version`. At most one pending per role (partial UNIQUE). `expired` is computed on
 * read (`pending AND expires_at <= now`); the nightly cron writes it.
 */
export const roleChangeRequests = sqliteTable(
  "role_change_requests",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id").notNull(),
    baseVersion: integer("base_version").notNull(),
    added: text("added").notNull(), // JSON string[]
    removed: text("removed").notNull(), // JSON string[]
    note: text("note"), // ≤500
    status: text("status").notNull(), // pending | approved | rejected | withdrawn | expired | cancelled
    requestedBy: text("requested_by").notNull(),
    requestedAt: integer("requested_at").notNull(),
    expiresAt: integer("expires_at").notNull(), // requested_at + 7 days
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at"),
    decisionNote: text("decision_note"),
  },
  (table) => [
    check(
      "ck_role_change_requests_status",
      sql`${table.status} IN ('pending','approved','rejected','withdrawn','expired','cancelled')`,
    ),
    uniqueIndex("uq_role_change_requests_pending").on(table.roleId).where(sql`status = 'pending'`),
    index("idx_role_change_requests_status_expires").on(table.status, table.expiresAt),
  ],
);

/**
 * Just-in-time admin grants (SPEC-07 §3.1, FR-5/6, DEC-6): never written to `user_roles`. Active =
 * `revoked_at IS NULL AND expires_at > now`. `expiry_logged_at` = the cron wrote `jit.expired` once.
 */
export const jitGrants = sqliteTable(
  "jit_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    roleName: text("role_name").notNull().default("admin"),
    reason: text("reason").notNull(), // 10–500
    grantedBy: text("granted_by").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    revokedBy: text("revoked_by"),
    expiryLoggedAt: integer("expiry_logged_at"),
  },
  (table) => [index("idx_jit_grants_user").on(table.userId)],
);

/**
 * Quarterly access reviews (SPEC-07 §3.1, FR-7/8). `period` = 'YYYY-Qn' (Asia/Ho_Chi_Minh). `opened_by` =
 * 'system:cron' or a user id. `due_at` = opened_at + 15 days.
 */
export const accessReviews = sqliteTable(
  "access_reviews",
  {
    id: text("id").primaryKey(),
    period: text("period").notNull().unique(),
    status: text("status").notNull(), // open | closed
    openedBy: text("opened_by").notNull(),
    openedAt: integer("opened_at").notNull(),
    dueAt: integer("due_at").notNull(),
    closedBy: text("closed_by"),
    closedAt: integer("closed_at"),
  },
  (table) => [check("ck_access_reviews_status", sql`${table.status} IN ('open','closed')`)],
);

/**
 * Access review rows — snapshot of `user_roles` for active users when the review opened. "changed" is computed
 * on read (current role ≠ `role_name`, or user no longer active).
 */
export const accessReviewItems = sqliteTable(
  "access_review_items",
  {
    reviewId: text("review_id").notNull(),
    userId: text("user_id").notNull(),
    roleName: text("role_name").notNull(),
    roleLabel: text("role_label"),
    decision: text("decision"), // NULL | keep | remove
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at"),
  },
  (table) => [
    primaryKey({ columns: [table.reviewId, table.userId] }),
    check("ck_access_review_items_decision", sql`${table.decision} IS NULL OR ${table.decision} IN ('keep','remove')`),
    index("idx_access_review_items_review").on(table.reviewId),
  ],
);

/**
 * Products (SPEC-08 §3.1): a service (duration N day/month) or goods (unit, no duration). Never hard-deleted
 * (`active` = 0 is "ngừng bán"). `code`, `kind` never change after creation; `code_norm` = trim + upper, UNIQUE.
 * `version` = CAS for edits. `created_by` NULL = seeded by a migration (system); no FK (like contracts.created_by).
 */
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // service | goods
    code: text("code").notNull(),
    codeNorm: text("code_norm").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    durationValue: integer("duration_value"),
    durationUnit: text("duration_unit"), // day | month | NULL
    active: integer("active").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("ck_products_kind", sql`${table.kind} IN ('service','goods')`),
    check(
      "ck_products_code_norm",
      sql`length(${table.codeNorm}) BETWEEN 1 AND 32 AND ${table.codeNorm} NOT GLOB '*[^A-Z0-9._-]*'`,
    ),
    check("ck_products_name", sql`length(${table.name}) BETWEEN 1 AND 120`),
    check("ck_products_unit", sql`length(${table.unit}) BETWEEN 1 AND 20`),
    check("ck_products_active", sql`${table.active} IN (0,1)`),
    check(
      "ck_products_duration",
      sql`(${table.kind} = 'goods' AND ${table.durationValue} IS NULL AND ${table.durationUnit} IS NULL) OR (${table.kind} = 'service' AND ((${table.durationUnit} = 'month' AND ${table.durationValue} BETWEEN 1 AND 120) OR (${table.durationUnit} = 'day' AND ${table.durationValue} BETWEEN 1 AND 3650)))`,
    ),
    uniqueIndex("uq_products_code_norm").on(table.codeNorm),
  ],
);

/**
 * Product price levels (SPEC-08 §3.1) — APPEND-ONLY: the price at date D is the level with the greatest
 * `effective_from` ≤ D (business zone); no `effective_to` (end = day before the next level, computed on read).
 * Whole đồng, ex-VAT. `vat_rate_bps` NULL = KCT (không chịu thuế). Triggers (migration `0022`) refuse every
 * UPDATE, DELETE of a level already in effect, and a backdated INSERT when the product already has a level.
 */
export const productPrices = sqliteTable(
  "product_prices",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    effectiveFrom: text("effective_from").notNull(), // YYYY-MM-DD (business zone)
    unitPriceExVat: integer("unit_price_ex_vat").notNull(),
    vatRateBps: integer("vat_rate_bps"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check("ck_product_prices_price", sql`${table.unitPriceExVat} BETWEEN 0 AND 1000000000000`),
    check("ck_product_prices_vat", sql`${table.vatRateBps} IS NULL OR ${table.vatRateBps} IN (0,500,800,1000)`),
    check(
      "ck_product_prices_date",
      sql`${table.effectiveFrom} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(${table.effectiveFrom}) = ${table.effectiveFrom}`,
    ),
    uniqueIndex("uq_product_prices_product_from").on(table.productId, table.effectiveFrom),
    index("idx_product_prices_product_from_desc").on(table.productId, sql`${table.effectiveFrom} DESC`),
  ],
);

/**
 * Full table collection for drizzle-kit schema generation and for
 * `drizzle(db, { schema })` typed query building in `db/client.ts`.
 */
export const schema = {
  schemaVersions,
  users,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  verificationTokens,
  refreshTokens,
  jwtRevocations,
  settings,
  featureFlags,
  idempotencyKeys,
  notes,
  userExports,
  auditEvents,
  customers,
  priceList,
  templates,
  templateVersions,
  contracts,
  approvalSteps,
  sodPairs,
  roleChangeRequests,
  jitGrants,
  accessReviews,
  accessReviewItems,
  products,
  productPrices,
};
