-- Phase 6 seed: baseline roles + permissions + role_permissions grants.
-- Idempotent (`INSERT OR IGNORE`) so re-applying against a partially-seeded
-- DB is safe. Fixed 26-char Crockford base32 ULID literals (no I/L/O/U)
-- for cross-environment reproducibility: prod, preview, and every dev DB
-- share the same role/permission IDs, so role_permissions rows can be
-- reused across migrations if the schema extends.

-- Roles ---------------------------------------------------------------------
INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('01ROLE0000000000000ADMIN00', 'admin',  'Full-access administrator'),
  ('01ROLE000000000000MEMBER00', 'member', 'Standard signed-up user');

-- Permissions ---------------------------------------------------------------
-- Keep alphabetized; must match packages/rbac/src/catalog.ts exactly.
INSERT OR IGNORE INTO permissions (id, key) VALUES
  ('01PERM000000000NOTESREAD00', 'notes:read'),
  ('01PERM00000000NOTESWRITE00', 'notes:write'),
  ('01PERM0000000SETTINGSREAD0', 'settings:read'),
  ('01PERM00000SETTINGSWRITE00', 'settings:write'),
  ('01PERM000000000USERSREAD00', 'users:read'),
  ('01PERM00000000USERSWRITE00', 'users:write');

-- Role → permission grants --------------------------------------------------
-- admin: everything
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE0000000000000ADMIN00', '01PERM000000000NOTESREAD00'),
  ('01ROLE0000000000000ADMIN00', '01PERM00000000NOTESWRITE00'),
  ('01ROLE0000000000000ADMIN00', '01PERM0000000SETTINGSREAD0'),
  ('01ROLE0000000000000ADMIN00', '01PERM00000SETTINGSWRITE00'),
  ('01ROLE0000000000000ADMIN00', '01PERM000000000USERSREAD00'),
  ('01ROLE0000000000000ADMIN00', '01PERM00000000USERSWRITE00');

-- member: notes only, ownership-scoped enforced by can(p, perm, {ownerId})
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE000000000000MEMBER00', '01PERM000000000NOTESREAD00'),
  ('01ROLE000000000000MEMBER00', '01PERM00000000NOTESWRITE00');
