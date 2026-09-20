-- Phase 8: seed default settings so the blueprint runs end-to-end
-- without a post-install step. Values are JSON-encoded (matching the
-- DAO's stored shape) so `SettingsService.get()` can round-trip them
-- through JSON.parse + Zod without special-casing seed rows.
--
-- Idempotent via `INSERT OR IGNORE`: re-apply is a no-op. To change
-- a default post-install, use `PUT /admin/settings/:key` (the write
-- path bumps `updated_at` + `updated_by`); do NOT rewrite this
-- migration.
--
-- `updated_by` is `NULL` on seed rows (no human actor). The
-- SettingsService `list()` surface exposes this so operators can
-- distinguish seed defaults from human-set values.

INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES
  ('email.from_address', '"no-reply@example.com"', 0, NULL),
  ('email.from_name',    '"Runway"',                0, NULL);
