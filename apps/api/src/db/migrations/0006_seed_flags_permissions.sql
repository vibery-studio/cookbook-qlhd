-- Phase 2 (v1.1): seed RBAC entries + default flag rows for the
-- operational control plane.
--
-- Idempotent via `INSERT OR IGNORE` — safe to re-apply against a
-- partially-seeded DB.
--
-- Fixed 26-char Crockford base32 ULIDs so IDs are stable across every
-- environment (matches the 0001_seed_rbac.sql convention).

-- Permissions catalog additions ---------------------------------------------
INSERT OR IGNORE INTO permissions (id, key) VALUES
  ('01PERM0000000000FLAGSREAD0', 'flags:read'),
  ('01PERM00000000FLAGSWRITE00', 'flags:write');

-- Admin role gains both --------------------------------------------------
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE0000000000000ADMIN00', '01PERM0000000000FLAGSREAD0'),
  ('01ROLE0000000000000ADMIN00', '01PERM00000000FLAGSWRITE00');

-- Default flag rows ------------------------------------------------------
-- Every registered flag gets a row so `list()` and audit-history land on
-- a consistent shape. Defaults MUST match `apps/api/src/flags/registry.ts`
-- (compile-time exhaustiveness ensures the catalog doesn't drift).
-- `updated_by = NULL` on seed rows so operators can tell seed defaults
-- from human-set values (same convention as settings).
INSERT OR IGNORE INTO feature_flags (key, enabled, percentage, allowlist, updated_at, updated_by) VALUES
  ('system.maintenance_mode', 0, NULL, NULL, 0, NULL),
  ('system.writes_disabled',  0, NULL, NULL, 0, NULL),
  ('email.enabled',           1, NULL, NULL, 0, NULL),
  ('signup.enabled',          1, NULL, NULL, 0, NULL);
