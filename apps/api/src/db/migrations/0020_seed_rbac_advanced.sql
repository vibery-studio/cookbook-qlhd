-- SPEC-07 FR-10 / DEC-13: catalog 16 → 18. `jit:grant` (Cấp quản trị tạm thời) and `reviews:write` (Rà soát quyền)
-- go to giam_doc only. Idempotent (`INSERT OR IGNORE`, literal ids like 0017).
-- Permissions (must match packages/rbac/src/catalog.ts) ------------------------
INSERT OR IGNORE INTO permissions (id, key) VALUES
  ('01PERM00000000000JITGRANT0', 'jit:grant'),
  ('01PERM000000REVIEWSWRITE00', 'reviews:write');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE00000000000GIAMDOC00', '01PERM00000000000JITGRANT0'),
  ('01ROLE00000000000GIAMDOC00', '01PERM000000REVIEWSWRITE00');
