CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`actor` text,
	`action` text NOT NULL,
	`target` text,
	`metadata` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_ts` ON `audit_events` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_audit_target` ON `audit_events` (`target`,`ts`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_events` (`actor`,`ts`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_events` (`action`,`ts`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_person` text,
	`tax_code` text,
	`phone` text,
	`phone_norm` text,
	`email` text,
	`address` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customers_phone_norm` ON `customers` (`phone_norm`) WHERE phone_norm IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customers_tax_code` ON `customers` (`tax_code`) WHERE tax_code IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_customers_name` ON `customers` (`name`);--> statement-breakpoint
CREATE TABLE `price_list` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`duration_value` integer NOT NULL,
	`duration_unit` text NOT NULL,
	`unit_price` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_price_list_code_from` ON `price_list` (`code`,`effective_from`);--> statement-breakpoint
ALTER TABLE `users` ADD `display_name` text;