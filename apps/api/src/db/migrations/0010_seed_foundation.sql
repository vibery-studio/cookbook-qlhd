-- SPEC-01 (row 1): Nhật Minh roles, contract permissions, price list, invite-only signup.
-- Idempotent (`INSERT OR IGNORE`). Fixed 26-char id literals, same convention as 0001_seed_rbac.sql.
-- Grants follow the approved mockup's Phân quyền matrix; `admin` stays the technical account (DEC-1):
-- it gains `audit:read` only — never `contract:*` / `template:write`.

-- Roles ---------------------------------------------------------------------
INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('01ROLE00000000000GIAMDOC00', 'giam_doc', 'Giám đốc'),
  ('01ROLE000000000000QUANLY00', 'quan_ly', 'Quản lý'),
  ('01ROLE0000000000NHANVIEN00', 'nhan_vien', 'Nhân viên');

-- Permissions (alphabetized; must match packages/rbac/src/catalog.ts) -----
INSERT OR IGNORE INTO permissions (id, key) VALUES
  ('01PERM000000000AUDITREAD00', 'audit:read'),
  ('01PERM000000000CTAPPROVE00', 'contract:approve'),
  ('01PERM00000000000CTISSUE00', 'contract:issue'),
  ('01PERM000000000000CTREAD00', 'contract:read'),
  ('01PERM0000000000CTSUBMIT00', 'contract:submit'),
  ('01PERM00000000000CTWRITE00', 'contract:write'),
  ('01PERM0000000000TPLWRITE00', 'template:write');

-- Role → permission grants -------------------------------------------------
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE00000000000GIAMDOC00', '01PERM000000000000CTREAD00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM00000000000CTWRITE00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM0000000000CTSUBMIT00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM000000000CTAPPROVE00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM00000000000CTISSUE00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM0000000000TPLWRITE00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM000000000AUDITREAD00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM000000000USERSREAD00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM00000000USERSWRITE00'),
  ('01ROLE000000000000QUANLY00', '01PERM000000000000CTREAD00'),
  ('01ROLE000000000000QUANLY00', '01PERM00000000000CTWRITE00'),
  ('01ROLE000000000000QUANLY00', '01PERM0000000000CTSUBMIT00'),
  ('01ROLE000000000000QUANLY00', '01PERM000000000CTAPPROVE00'),
  ('01ROLE000000000000QUANLY00', '01PERM00000000000CTISSUE00'),
  ('01ROLE000000000000QUANLY00', '01PERM000000000AUDITREAD00'),
  ('01ROLE0000000000NHANVIEN00', '01PERM000000000000CTREAD00'),
  ('01ROLE0000000000NHANVIEN00', '01PERM00000000000CTWRITE00'),
  ('01ROLE0000000000NHANVIEN00', '01PERM0000000000CTSUBMIT00'),
  ('01ROLE0000000000000ADMIN00', '01PERM000000000AUDITREAD00');

-- Price list: owner-box 09_Bang_Gia.xlsx, sheet "Bảng giá" (đồng, đã gồm VAT) ---
INSERT OR IGNORE INTO price_list (id, code, name, duration_value, duration_unit, unit_price, effective_from, effective_to, note) VALUES
  ('01PRICE000000000DT14202501', 'DT14', 'Dùng thử 14 ngày', 14, 'day', 0, '2025-01-01', NULL, 'mỗi cửa hàng dùng thử 1 lần'),
  ('01PRICE00000000000G3202502', 'G3', 'Gói 3 tháng', 3, 'month', 1350000, '2025-01-01', '2025-12-31', NULL),
  ('01PRICE00000000000G3202603', 'G3', 'Gói 3 tháng', 3, 'month', 1500000, '2026-01-01', NULL, NULL),
  ('01PRICE00000000000G6202504', 'G6', 'Gói 6 tháng', 6, 'month', 2400000, '2025-01-01', '2026-06-30', NULL),
  ('01PRICE00000000000G6202605', 'G6', 'Gói 6 tháng', 6, 'month', 2700000, '2026-07-01', NULL, 'tăng giá từ 01/07/2026'),
  ('01PRICE0000000000G12202506', 'G12', 'Gói 12 tháng', 12, 'month', 4500000, '2025-01-01', '2025-12-31', NULL),
  ('01PRICE0000000000G12202607', 'G12', 'Gói 12 tháng', 12, 'month', 4800000, '2026-01-01', NULL, 'bán chạy nhất');

-- Invite-only (SPEC-01 FR-3): public signup off. Only flips the untouched seed row.
UPDATE feature_flags SET enabled = 0 WHERE key = 'signup.enabled' AND updated_by IS NULL;
