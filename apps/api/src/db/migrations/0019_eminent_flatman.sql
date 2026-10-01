CREATE TABLE `access_review_items` (
	`review_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_name` text NOT NULL,
	`role_label` text,
	`decision` text,
	`decided_by` text,
	`decided_at` integer,
	PRIMARY KEY(`review_id`, `user_id`),
	CONSTRAINT "ck_access_review_items_decision" CHECK("access_review_items"."decision" IS NULL OR "access_review_items"."decision" IN ('keep','remove'))
);
--> statement-breakpoint
CREATE INDEX `idx_access_review_items_review` ON `access_review_items` (`review_id`);--> statement-breakpoint
CREATE TABLE `access_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`status` text NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`closed_by` text,
	`closed_at` integer,
	CONSTRAINT "ck_access_reviews_status" CHECK("access_reviews"."status" IN ('open','closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_reviews_period_unique` ON `access_reviews` (`period`);--> statement-breakpoint
CREATE TABLE `jit_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_name` text DEFAULT 'admin' NOT NULL,
	`reason` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`expiry_logged_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_jit_grants_user` ON `jit_grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `role_change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`base_version` integer NOT NULL,
	`added` text NOT NULL,
	`removed` text NOT NULL,
	`note` text,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	CONSTRAINT "ck_role_change_requests_status" CHECK("role_change_requests"."status" IN ('pending','approved','rejected','withdrawn','expired','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_role_change_requests_pending` ON `role_change_requests` (`role_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `idx_role_change_requests_status_expires` ON `role_change_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `sod_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`perm_a` text NOT NULL,
	`perm_b` text NOT NULL,
	`reason` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "ck_sod_pairs_distinct" CHECK("sod_pairs"."perm_a" <> "sod_pairs"."perm_b"),
	CONSTRAINT "ck_sod_pairs_ordered" CHECK("sod_pairs"."perm_a" < "sod_pairs"."perm_b")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sod_pairs_ab` ON `sod_pairs` (`perm_a`,`perm_b`);