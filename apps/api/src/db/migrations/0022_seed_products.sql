-- SPEC-08 FR-7 / FR-10 / §3.1 (PLAN-08 §2b, P-5). Order: permissions → DEMO seed → triggers (the seed's 2025/2026
-- levels lie before today, so the backdate trigger must come last).
-- Permissions (must match packages/rbac/src/catalog.ts): quan_ly + giam_doc only. Idempotent, literal ids like 0020.
INSERT OR IGNORE INTO permissions (id, key) VALUES
  ('01PERM000000PRODUCTWRITE00', 'product:write'),
  ('01PERM00000000PRICEWRITE00', 'price:write');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE00000000000GIAMDOC00', '01PERM000000PRODUCTWRITE00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM00000000PRICEWRITE00'),
  ('01ROLE000000000000QUANLY00', '01PERM000000PRODUCTWRITE00'),
  ('01ROLE000000000000QUANLY00', '01PERM00000000PRICEWRITE00');
--> statement-breakpoint
-- DEMO seed (bạn chốt 2026-10-01). Every row here is DEMO data: replace with real numbers via `pnpm dev:seed-products`
-- (`--replace`) before real use. G3/G6/G12/DT14 keep their printed names (prices = today's list prices, ex-VAT, KCT —
-- "KCT" is the DEMO assumption); the two goods carry "(DEMO)" in the name + `DEMO-*` code (PLAN-08 P-5).
-- created_by NULL = system. Fixed 26-char id literals.
INSERT INTO products (id, kind, code, code_norm, name, unit, duration_value, duration_unit, active, version, created_by, created_at, updated_at) VALUES
  ('01PROD000000000000000000G3', 'service', 'G3', 'G3', 'Gói 3 tháng', 'cửa hàng', 3, 'month', 1, 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  ('01PROD000000000000000000G6', 'service', 'G6', 'G6', 'Gói 6 tháng', 'cửa hàng', 6, 'month', 1, 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  ('01PROD00000000000000000G12', 'service', 'G12', 'G12', 'Gói 12 tháng', 'cửa hàng', 12, 'month', 1, 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  ('01PROD0000000000000000DT14', 'service', 'DT14', 'DT14', 'Dùng thử 14 ngày', 'cửa hàng', 14, 'day', 0, 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  ('01PROD00000000000DEMOMIN01', 'goods', 'DEMO-MIN-01', 'DEMO-MIN-01', 'Máy in hóa đơn (DEMO)', 'cái', NULL, NULL, 1, 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  ('01PROD0000000000DEMOGIAY01', 'goods', 'DEMO-GIAY-01', 'DEMO-GIAY-01', 'Giấy in nhiệt (DEMO)', 'cuộn', NULL, NULL, 1, 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
-- vat_rate_bps NULL = KCT (software, Luật 48/2024 Đ5.21); 1000 = 10%.
INSERT INTO product_prices (id, product_id, effective_from, unit_price_ex_vat, vat_rate_bps, created_by, created_at) VALUES
  ('01PPRICE0000000000G3202501', '01PROD000000000000000000G3', '2025-01-01', 1350000, NULL, NULL, CAST(strftime('%s','now') AS INTEGER)),
  ('01PPRICE0000000000G3202601', '01PROD000000000000000000G3', '2026-01-01', 1500000, NULL, NULL, CAST(strftime('%s','now') AS INTEGER)),
  ('01PPRICE0000000000G6202501', '01PROD000000000000000000G6', '2025-01-01', 2400000, NULL, NULL, CAST(strftime('%s','now') AS INTEGER)),
  ('01PPRICE0000000000G6202607', '01PROD000000000000000000G6', '2026-07-01', 2700000, NULL, NULL, CAST(strftime('%s','now') AS INTEGER)),
  ('01PPRICE000000000G12202501', '01PROD00000000000000000G12', '2025-01-01', 4500000, NULL, NULL, CAST(strftime('%s','now') AS INTEGER)),
  ('01PPRICE000000000G12202601', '01PROD00000000000000000G12', '2026-01-01', 4800000, NULL, NULL, CAST(strftime('%s','now') AS INTEGER)),
  ('01PPRICE00000000DT14202501', '01PROD0000000000000000DT14', '2025-01-01', 0, NULL, NULL, CAST(strftime('%s','now') AS INTEGER)),
  ('01PPRICE0000000MIN01202601', '01PROD00000000000DEMOMIN01', '2026-01-01', 1000000, 1000, NULL, CAST(strftime('%s','now') AS INTEGER)),
  ('01PPRICE000000GIAY01202601', '01PROD0000000000DEMOGIAY01', '2026-01-01', 20000, 1000, NULL, CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
-- SPEC-08 §3.1 / PLAN-08 P-4: product_prices is append-only history. The DAO never updates; these triggers are the
-- second lock (business zone = UTC+7, no DST). RAISE texts are fixed — the API maps them to 409/422.
CREATE TRIGGER `trg_product_prices_no_update` BEFORE UPDATE ON `product_prices`
BEGIN
	SELECT RAISE(ABORT, 'product_prices is append-only: UPDATE refused');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_product_prices_no_delete_in_effect` BEFORE DELETE ON `product_prices`
WHEN OLD.effective_from <= date('now','+7 hours')
BEGIN
	SELECT RAISE(ABORT, 'product_prices: a price in effect cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_product_prices_no_backdate` BEFORE INSERT ON `product_prices`
WHEN NEW.effective_from < date('now','+7 hours')
  AND EXISTS (SELECT 1 FROM product_prices WHERE product_id = NEW.product_id)
BEGIN
	SELECT RAISE(ABORT, 'product_prices: backdated price refused');
END;
