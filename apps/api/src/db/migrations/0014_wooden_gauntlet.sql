CREATE TABLE `approval_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`step_no` integer NOT NULL,
	`label` text NOT NULL,
	`required_permission` text NOT NULL,
	`required_role` text,
	`status` text NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`note` text,
	`snapshot_hash_at_decision` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "ck_approval_steps_status" CHECK("approval_steps"."status" IN ('waiting','approved','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_approval_steps_contract_step` ON `approval_steps` (`contract_id`,`step_no`);--> statement-breakpoint
CREATE INDEX `idx_approval_steps_status_perm` ON `approval_steps` (`status`,`required_permission`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`source_contract_id` text,
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ck_contracts_type" CHECK("contracts"."type" = 'contract'),
	CONSTRAINT "ck_contracts_status" CHECK("contracts"."status" IN ('draft','pending','approved','rejected','issued','voided')),
	CONSTRAINT "ck_contracts_seq_iff_issued" CHECK(("contracts"."status" IN ('issued','voided')) = ("contracts"."seq" IS NOT NULL)),
	CONSTRAINT "ck_contracts_void_reason" CHECK("contracts"."status" <> 'voided' OR "contracts"."void_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contracts_series_seq` ON `contracts` (`type`,`series_year`,`seq`) WHERE seq IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contracts_number` ON `contracts` (`number`) WHERE number IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_contracts_type_status_updated` ON `contracts` (`type`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_contracts_customer` ON `contracts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_contracts_created_by` ON `contracts` (`created_by`);