-- SPEC-06 FR-1 / §3.1: backfill the 5 seed roles as system roles with Vietnamese labels, add `roles:write`,
-- grant it to admin + giam_doc. Idempotent (`INSERT OR IGNORE`; UPDATEs keyed by name).
-- `label_key` literals = the app's normalizeLabel(label): NFC, trim, collapsed spaces, toLocaleLowerCase('vi').
UPDATE roles SET is_system = 1, label = 'Quản trị hệ thống', label_key = 'quản trị hệ thống', created_at = unixepoch(), updated_at = unixepoch() WHERE name = 'admin';
--> statement-breakpoint
UPDATE roles SET is_system = 1, label = 'Thành viên (nền)', label_key = 'thành viên (nền)', created_at = unixepoch(), updated_at = unixepoch() WHERE name = 'member';
--> statement-breakpoint
UPDATE roles SET is_system = 1, label = 'Giám đốc', label_key = 'giám đốc', created_at = unixepoch(), updated_at = unixepoch() WHERE name = 'giam_doc';
--> statement-breakpoint
UPDATE roles SET is_system = 1, label = 'Quản lý', label_key = 'quản lý', created_at = unixepoch(), updated_at = unixepoch() WHERE name = 'quan_ly';
--> statement-breakpoint
UPDATE roles SET is_system = 1, label = 'Nhân viên', label_key = 'nhân viên', created_at = unixepoch(), updated_at = unixepoch() WHERE name = 'nhan_vien';
--> statement-breakpoint
-- Permission (must match packages/rbac/src/catalog.ts) -------------------------
INSERT OR IGNORE INTO permissions (id, key) VALUES ('01PERM0000000ROLESWRITE00', 'roles:write');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE0000000000000ADMIN00', '01PERM0000000ROLESWRITE00'),
  ('01ROLE00000000000GIAMDOC00', '01PERM0000000ROLESWRITE00');
