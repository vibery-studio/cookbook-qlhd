ALTER TABLE `roles` ADD `label` text;--> statement-breakpoint
ALTER TABLE `roles` ADD `label_key` text;--> statement-breakpoint
ALTER TABLE `roles` ADD `is_system` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `roles_label_key_unique` ON `roles` (`label_key`);