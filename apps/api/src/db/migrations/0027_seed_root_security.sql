-- C-11-001: `root` (Root admin, system role, seeder-only — never granted through the app) + `security:write`
-- (Cấu hình bảo mật: bật/tắt cơ chế duyệt 2 lớp khi đổi quyền). Root holds security:write + audit:read, nothing else.
-- Catalog 23 → 24 (must match packages/rbac/src/catalog.ts). Data only, idempotent, literal 26-char ids like 0020/0025.
-- The setting `security.two_layer_role_change` has no row: absent = ON (default).
INSERT OR IGNORE INTO roles (id, name, description, label, label_key, is_system, version, created_at, updated_at) VALUES
  ('01ROLE00000000000000ROOT00', 'root', 'Root admin', 'Root admin', 'root admin', 1, 1, unixepoch(), unixepoch());
--> statement-breakpoint
INSERT OR IGNORE INTO permissions (id, key) VALUES
  ('01PERM00000SECURITYWRITE00', 'security:write');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE00000000000000ROOT00', '01PERM00000SECURITYWRITE00'),
  ('01ROLE00000000000000ROOT00', '01PERM000000000AUDITREAD00');
