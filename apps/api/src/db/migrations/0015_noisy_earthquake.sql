ALTER TABLE `contracts` ADD `pdf_key` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `pdf_hash` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `pdf_size` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `pdf_at` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `pdf_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `contracts` ADD `pdf_failed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_contracts_pdf_sweep` ON `contracts` (`pdf_key`,`status`);