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
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  },
  (table) => [index("idx_users_email").on(table.email)],
);

/**
 * RBAC roles catalog (e.g. 'admin', 'member'). No `scope` column in v1.
 */
export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
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
  idempotencyKeys,
  notes,
};
