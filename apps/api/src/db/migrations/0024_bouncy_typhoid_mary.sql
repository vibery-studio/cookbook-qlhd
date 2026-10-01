PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`source_contract_id` text,
	`parent_id` text,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`doc_date` text NOT NULL,
	`snapshot` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`customer_name` text NOT NULL,
	`total` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`series_year` integer,
	`seq` integer,
	`number` text,
	`issue_token` text,
	`issued_by` text,
	`issued_at` integer,
	`rendered_html` text,
	`rendered_hash` text,
	`submitted_at` integer,
	`decided_at` integer,
	`voided_by` text,
	`voided_at` integer,
	`void_reason` text,
	`replaced_by_id` text,
	`pdf_key` text,
	`pdf_hash` text,
	`pdf_size` integer,
	`pdf_at` integer,
	`valid_until` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ck_contracts_type" CHECK("__new_contracts"."type" IN ('contract','quote','payment_request','delivery_note')),
	CONSTRAINT "ck_contracts_parent_not_self" CHECK("__new_contracts"."parent_id" IS NULL OR "__new_contracts"."parent_id" <> "__new_contracts"."id"),
	CONSTRAINT "ck_contracts_valid_until" CHECK("__new_contracts"."type" = 'quote' OR "__new_contracts"."valid_until" IS NULL),
	CONSTRAINT "ck_contracts_status" CHECK("__new_contracts"."status" IN ('draft','pending','approved','rejected','issued','voided')),
	CONSTRAINT "ck_contracts_seq_iff_issued" CHECK(("__new_contracts"."status" IN ('issued','voided')) = ("__new_contracts"."seq" IS NOT NULL)),
	CONSTRAINT "ck_contracts_void_reason" CHECK("__new_contracts"."status" <> 'voided' OR "__new_contracts"."void_reason" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_contracts`("id", "type", "template_id", "template_version_id", "customer_id", "source_contract_id", "status", "created_by", "doc_date", "snapshot", "snapshot_hash", "customer_name", "total", "version", "series_year", "seq", "number", "issue_token", "issued_by", "issued_at", "rendered_html", "rendered_hash", "submitted_at", "decided_at", "voided_by", "voided_at", "void_reason", "replaced_by_id", "pdf_key", "pdf_hash", "pdf_size", "pdf_at", "created_at", "updated_at") SELECT "id", "type", "template_id", "template_version_id", "customer_id", "source_contract_id", "status", "created_by", "doc_date", "snapshot", "snapshot_hash", "customer_name", "total", "version", "series_year", "seq", "number", "issue_token", "issued_by", "issued_at", "rendered_html", "rendered_hash", "submitted_at", "decided_at", "voided_by", "voided_at", "void_reason", "replaced_by_id", "pdf_key", "pdf_hash", "pdf_size", "pdf_at", "created_at", "updated_at" FROM `contracts`;--> statement-breakpoint
DROP TABLE `contracts`;--> statement-breakpoint
ALTER TABLE `__new_contracts` RENAME TO `contracts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contracts_series_seq` ON `contracts` (`type`,`series_year`,`seq`) WHERE seq IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contracts_number` ON `contracts` (`number`) WHERE number IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_contracts_type_status_updated` ON `contracts` (`type`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_contracts_customer` ON `contracts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_contracts_created_by` ON `contracts` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contracts_parent_child_live` ON `contracts` (`parent_id`,`type`) WHERE parent_id IS NOT NULL AND status IN ('draft','pending','approved','issued');--> statement-breakpoint
CREATE INDEX `idx_contracts_parent` ON `contracts` (`parent_id`);