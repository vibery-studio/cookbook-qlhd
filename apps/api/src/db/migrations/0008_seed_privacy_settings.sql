-- Phase 3 (v1.1): seed the two privacy-related settings that gate the
-- account-deletion and export retention flows. Idempotent via
-- `INSERT OR IGNORE` — safe to re-apply.
--
-- `updated_by` is NULL on seed rows (matches the 0003 convention). Both
-- keys are runtime-mutable through `PUT /admin/settings/:key`; changing
-- the grace window emits a SYNC audit event (settings.update) that
-- operators should alert on since a shortened grace enables a hostile
-- admin to speed up erasure. See docs/privacy.md.

INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES
  ('privacy.deletion_grace_seconds', '604800', 0, NULL),   -- 7 days
  ('privacy.export_retention_seconds', '2592000', 0, NULL); -- 30 days
