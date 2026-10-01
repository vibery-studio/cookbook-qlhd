CREATE TABLE `product_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`unit_price_ex_vat` integer NOT NULL,
	`vat_rate_bps` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_product_prices_price" CHECK("product_prices"."unit_price_ex_vat" BETWEEN 0 AND 1000000000000),
	CONSTRAINT "ck_product_prices_vat" CHECK("product_prices"."vat_rate_bps" IS NULL OR "product_prices"."vat_rate_bps" IN (0,500,800,1000)),
	CONSTRAINT "ck_product_prices_date" CHECK("product_prices"."effective_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("product_prices"."effective_from") = "product_prices"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_product_prices_product_from` ON `product_prices` (`product_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `idx_product_prices_product_from_desc` ON `product_prices` (`product_id`,"effective_from" DESC);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`code_norm` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`duration_value` integer,
	`duration_unit` text,
	`active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ck_products_kind" CHECK("products"."kind" IN ('service','goods')),
	CONSTRAINT "ck_products_code_norm" CHECK(length("products"."code_norm") BETWEEN 1 AND 32 AND "products"."code_norm" NOT GLOB '*[^A-Z0-9._-]*'),
	CONSTRAINT "ck_products_name" CHECK(length("products"."name") BETWEEN 1 AND 120),
	CONSTRAINT "ck_products_unit" CHECK(length("products"."unit") BETWEEN 1 AND 20),
	CONSTRAINT "ck_products_active" CHECK("products"."active" IN (0,1)),
	CONSTRAINT "ck_products_duration" CHECK(("products"."kind" = 'goods' AND "products"."duration_value" IS NULL AND "products"."duration_unit" IS NULL) OR ("products"."kind" = 'service' AND (("products"."duration_unit" = 'month' AND "products"."duration_value" BETWEEN 1 AND 120) OR ("products"."duration_unit" = 'day' AND "products"."duration_value" BETWEEN 1 AND 3650))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_products_code_norm` ON `products` (`code_norm`);