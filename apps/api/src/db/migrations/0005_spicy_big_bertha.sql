-- Phase 2 (v1.1): feature flags table + snapshot reconciliation.
--
-- WHY THIS MIGRATION HAS RECONCILIATION-SHAPED SQL:
-- Migrations 0000-0004 were hand-written SQL and are already applied to
-- every running database (local, dev, preview, prod). The drizzle-kit
-- snapshot chain didn't track those hand-written statements, so
-- `pnpm db:generate` in Phase 2 sees the following as "missing" relative
-- to the snapshot: `feature_flags` (genuinely new here), `notes` (created
-- by 0004), and `users.verify_email_resend_count` (added by 0002). Rather
-- than rewrite 0001-0004 snapshots (heavy) we accept 0005 as the new
-- baseline the snapshot chain understands — but guard the reconciliation
-- statements with `IF NOT EXISTS` / `IF NOT` so applying to an already-
-- migrated database is a safe no-op. See
-- `.claude/projects/-Users-bnqtoan-Documents-tony-runway/memory/runway-v11-migration-convention.md`.

-- New for Phase 2: feature flags storage.
CREATE TABLE IF NOT EXISTS `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`percentage` integer,
	`allowlist` text,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint

-- Reconciliation for `notes` (already created by 0004_demo_notes.sql).
CREATE TABLE IF NOT EXISTS `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notes_user` ON `notes` (`user_id`,`created_at`);
--> statement-breakpoint

-- Reconciliation for `users.verify_email_resend_count` (already added by
-- 0002_add_verify_email_resend_count.sql). SQLite has no
-- `ADD COLUMN IF NOT EXISTS`; emulate via `pragma_table_info` guard.
-- The guard uses INSERT INTO a dummy select that only runs the ALTER
-- when the column is absent — but SQLite's ALTER TABLE cannot be nested
-- in an IF. Instead we rely on the fact that D1's migration applier is
-- idempotent per-file, and this file has already been rewritten to the
-- form drizzle wants for FUTURE snapshots. If applying against a fresh
-- database (no 0002 yet), 0002 will have run first and added the column
-- already. If a real deploy ever fails on this line, the operator can
-- comment it out — the schema is already correct.
--
-- Safe form: no-op ALTER (SQLite errors on duplicate ADD COLUMN with a
-- clear message; the wrangler migrator surfaces that + halts). To avoid
-- that error path, we skip the ALTER entirely: 0002 already applied it
-- everywhere the migration chain has ever run.
--
-- (Intentionally omitting `ALTER TABLE users ADD verify_email_resend_count`
-- from this migration — the snapshot chain records the column shape but
-- 0002 owns the actual DDL.)
