-- Phase 3 (v1.1): GDPR privacy lifecycle — export + deletion + retention.
-- Adds three lifecycle columns to `users` and a new `user_exports` table
-- tracking archive requests.
--
-- `IF NOT EXISTS` guards the table create + indexes so re-applying against
-- a partially-migrated DB is safe. SQLite has no `ADD COLUMN IF NOT
-- EXISTS`; each ALTER assumes a fresh column on a database whose head is
-- 0006. Applying 0007 twice on the same DB fails loudly on the ALTER,
-- which is fine — the migration applier tracks applied migrations by
-- filename and never re-runs the same file.

CREATE TABLE IF NOT EXISTS `user_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`archive_url` text,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_exports_user` ON `user_exports` (`user_id`,`requested_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_exports_expires` ON `user_exports` (`expires_at`);
--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_requested_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `last_export_at` integer;
