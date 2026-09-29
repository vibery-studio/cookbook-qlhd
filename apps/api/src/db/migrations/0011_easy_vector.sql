CREATE TABLE `template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`body` text NOT NULL,
	`fields` text NOT NULL,
	`default_line_items` text NOT NULL,
	`default_clauses` text NOT NULL,
	`approval_policy` text NOT NULL,
	`field_rules` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_template_versions_tpl_no` ON `template_versions` (`template_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`name_norm` text NOT NULL,
	`subject_type` text NOT NULL,
	`current_version_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_templates_name_norm` ON `templates` (`name_norm`);