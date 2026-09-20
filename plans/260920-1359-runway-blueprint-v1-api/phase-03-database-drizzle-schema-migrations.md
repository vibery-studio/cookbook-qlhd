---
title: "Phase 3: Database, Drizzle Schema & Migrations"
status: in-progress
---

# Phase 3: Database, Drizzle Schema & Migrations

## Overview

Model the v1 D1 schema in drizzle-kit, generate SQL migrations, wire migrations into local dev + CI + preview + prod deploy flows. Hand-written DAO layer consumes drizzle only for typed query building — never leaks drizzle types to services or handlers. Schema covers users, roles, permissions, verification tokens, refresh tokens, JWT revocations, settings, idempotency, and a `schema_versions` sentinel used by post-deploy `/readyz` to verify head matches deployed code. All tables include `id` (ULID text) and `created_at`; timestamps are `INTEGER` unix seconds. **No `audit_log` table (audit is structured logging via Logpush; see Phase 9). No `scope` field on `user_roles`/`settings` in v1 (single-tenant; multi-tenant is a v2 migration). No `BaseDao` abstract class — DAO discipline enforced via ESLint rule + docs.**

## Requirements

- Functional
  - [ ] `pnpm db:generate` produces SQL migration from schema changes
  - [ ] `pnpm db:migrate:local` applies migrations to local `.wrangler/state/v3/d1` DB
  - [ ] Preview deploy runs migrations against per-PR D1 before serving traffic
  - [ ] Prod deploy runs migrations before Worker deploy; **post-deploy `/readyz` reads `schema_versions.head` and compares to Worker's compiled `BUILD_SHA` — mismatch → alert + block promotion**
  - [ ] **Expand/contract migration discipline enforced by CI:** PRs cannot combine destructive migration verbs (`DROP COLUMN`, `RENAME TABLE`, `RENAME COLUMN`, destructive `ALTER`) with changes to `apps/api/src/**`
  - [ ] **Application-level cascade** implemented in DAOs for parent-child relationships since D1 `PRAGMA foreign_keys` is not reliably persistent per-statement
  - [ ] DAO functions return DTOs only — enforced by ESLint rule `no-drizzle-typed-exports` on `apps/api/src/dao/**`
  - [ ] `docs/deploy.md` ships in this phase with the full rollback playbook
- Non-functional
  - [ ] All tables have indexes on FK and unique constraints (`email`, `settings.key`)
  - [ ] Timestamps stored as `INTEGER` unix seconds (D1 has no native `TIMESTAMP`)
  - [ ] IDs are ULID (`ulid` package, monotonic, sortable) stored as `TEXT`; verified to work on Workers (uses WebCrypto)
  - [ ] Foreign keys DECLARED in schema for documentation and drizzle-orm relations, but enforcement is at the application layer

## Architecture

```
apps/api/src/
├── db/
│   ├── schema.ts               # drizzle schema (source of truth)
│   ├── client.ts               # getDb(env: Env) → drizzle client
│   └── migrations/             # numbered SQL migrations (checked in)
│       ├── 0001_init.sql
│       └── meta/               # drizzle metadata
├── dao/
│   ├── user-dao.ts             # (P5) — DTO-returning functions, application-level cascade helpers
│   ├── role-dao.ts             # (P6)
│   ├── permission-dao.ts       # (P6)
│   ├── verification-token-dao.ts # (P5)
│   ├── refresh-token-dao.ts    # (P5)
│   ├── jwt-revocation-dao.ts   # (P5) — `jti` blocklist for short-TTL access tokens
│   ├── settings-dao.ts         # (P8)
│   └── idempotency-dao.ts      # (P9)
drizzle.config.ts
docs/deploy.md                  # rollback playbook (ships this phase)
```

**Schema (SQL summary — v1, single-tenant, no audit_log, no scope columns):**

```sql
-- schema_versions: post-deploy head/code parity check
CREATE TABLE schema_versions (
  head       TEXT PRIMARY KEY,          -- latest migration filename (e.g. '0007_seed_settings.sql')
  applied_at INTEGER NOT NULL
);

-- users
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- scrypt-encoded string via @noble/hashes
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | active | disabled
  verified_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_users_email ON users(email);

-- roles, permissions, joins (no scope column in v1)
CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,     -- 'admin', 'member'
  description TEXT
);
CREATE TABLE permissions (
  id  TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE              -- 'users:read', 'settings:write', etc.
);
CREATE TABLE role_permissions (
  role_id       TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);
-- FK declared in drizzle schema for docs/relations; application-level cascade enforced in DAOs

-- auth
CREATE TABLE verification_tokens (
  token_hash TEXT PRIMARY KEY,           -- HMAC-SHA256(raw_token, TOKEN_PEPPER) — never store raw
  user_id    TEXT NOT NULL,
  purpose    TEXT NOT NULL,              -- 'verify_email' | 'password_reset'
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_verify_user ON verification_tokens(user_id);

CREATE TABLE refresh_tokens (
  token_hash       TEXT PRIMARY KEY,     -- HMAC-SHA256(raw_token, TOKEN_PEPPER)
  user_id          TEXT NOT NULL,
  expires_at       INTEGER NOT NULL,
  revoked_at       INTEGER,              -- consumed via atomic CAS with `revoked_at IS NULL` guard
  replaced_by_hash TEXT,                 -- rotation chain for replay detection
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE jwt_revocations (
  jti        TEXT PRIMARY KEY,           -- JWT ID claim; access-token blocklist
  user_id    TEXT NOT NULL,
  reason     TEXT NOT NULL,              -- 'logout' | 'admin_disable' | 'password_reset'
  revoked_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL            -- prune after original JWT would have expired anyway
);
CREATE INDEX idx_jwt_rev_user ON jwt_revocations(user_id);
CREATE INDEX idx_jwt_rev_expires ON jwt_revocations(expires_at);

-- settings (no scope column in v1)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,               -- JSON string
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- idempotency (namespaced key includes method+path — see P9)
CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,       -- `${principalId}:${method}:${path}:${header}` — sha256 to bound length
  request_hash    TEXT NOT NULL,          -- sha256(rawBody + stable-headers)
  response_status INTEGER,                -- NULL = in-flight sentinel row (CAS lock)
  response_body   TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL         -- 24h default
);
CREATE INDEX idx_idem_expires ON idempotency_keys(expires_at);

-- notes (demo resource for P11 recipe)
-- Migration deferred to P9; stripped from template output per Phase 11 recipe
```

**No `audit_log` table.** Audit events flow through `logger.audit({...})` as JSON stdout → Cloudflare Logpush → user-chosen destination (R2, Datadog, S3). Queried via the Logpush destination, not the app. Rationale: Logpush is durable, cheap, already provisioned for logs; a D1 table + admin API for a members-only tool is YAGNI (Red Team F14).

## Related Code Files

- Create: `apps/api/src/db/schema.ts` (drizzle schema mirroring SQL above)
- Create: `apps/api/src/db/client.ts` (returns typed drizzle instance from `env.DB`)
- Create: `drizzle.config.ts`
- Create: `apps/api/src/db/migrations/0001_init.sql` (generated + committed)
- Create: `apps/api/src/utils/id.ts` (ULID via WebCrypto)
- Modify: `apps/api/wrangler.toml` (wire migrations dir; ensure `nodejs_compat` still on)
- Modify: `package.json` scripts: `db:generate`, `db:migrate:local`, `db:migrate:preview`, `db:migrate:prod`
- Modify: `.github/workflows/preview.yml` (run migrations after D1 create)
- Modify: `.github/workflows/deploy.yml` (run migrations before `wrangler deploy`; post-deploy `/readyz` parity check)
- Create: `packages/config/eslint-rules/no-drizzle-typed-exports.js` (custom ESLint rule)
- Create: `docs/deploy.md` (rollback playbook — REQUIRED deliverable of this phase)
- Create: `docs/dao-pattern.md` (DTO discipline, application-level cascade guidance)

## Implementation Steps

1. Write failing DAO integration test: `apps/api/test/integration/db-smoke.test.ts` — creates user, reads back, asserts DTO shape and no drizzle types leak
2. Write failing cascade test: create user → create user_role → delete user via DAO → assert user_role row gone
3. Install `drizzle-orm`, `drizzle-kit`, `@cloudflare/workers-types`, `ulid`
4. Write `schema.ts` with all tables per SQL above (no scope, no audit_log)
5. Configure `drizzle.config.ts` (dialect: sqlite, out: migrations/)
6. Run `pnpm db:generate` → produces `0001_init.sql` + drizzle meta; commit
7. Write `db/client.ts` returning drizzle-wrapped `env.DB`
8. Author DAO base pattern (**functions, not class**): `user-dao.ts` exports `createUser`, `findUserByEmail`, `updateUserStatus`, `deleteUser(id)` — the last calls `deleteUserRoles(id)` + `deleteVerificationTokens(id)` + `deleteRefreshTokens(id)` + `deleteJwtRevocationsForUser(id)` **first**, then `DELETE FROM users`, all inside a `db.batch([...])` for atomicity
9. Write ESLint custom rule `no-drizzle-typed-exports`: flags any `export` from `apps/api/src/dao/**` whose TypeScript type resolves to a drizzle table type (via `@typescript-eslint/utils` type-checker)
10. Wire scripts:
    - `db:generate` → `drizzle-kit generate`
    - `db:migrate:local` → `wrangler d1 migrations apply runway_dev --local`
    - `db:migrate:preview` → `wrangler d1 migrations apply runway-preview-pr-${PR} --remote`
    - `db:migrate:prod` → `wrangler d1 migrations apply runway_prod --remote`
    - `db:record-head` → inserts head migration filename into `schema_versions` after migration apply
11. Update GitHub Actions to invoke `db:migrate:preview`/`db:migrate:prod` at correct steps; deploy.yml calls `db:record-head` after migration success and before `wrangler deploy`
12. Post-deploy `/readyz` check compares `schema_versions.head` against Worker's compiled `BUILD_SHA`-associated head (baked into the Worker at build time via a codegen step reading the latest migration filename)
13. Run all integration tests locally against real preview D1 (not local unit) — verify application-level cascade fires and DTOs contain no drizzle types
14. Write `docs/deploy.md` with rollback playbook: pre-deploy backup command, migration-failure recovery, code-behind-migration scenario recovery, emergency rollback via `wrangler rollback`

## Todo

- [ ] Failing DAO integration test + cascade test written
- [ ] drizzle-kit installed, schema.ts covers v1 tables (no scope, no audit_log)
- [ ] Initial migration generated + committed
- [ ] `schema_versions` sentinel table wired into deploy flow
- [ ] Application-level cascade proven in test AGAINST REAL PREVIEW D1
- [ ] ESLint rule `no-drizzle-typed-exports` implemented + linting passes on empty DAO tree
- [ ] `docs/dao-pattern.md` documents DTO discipline + cascade helpers (one paragraph, not a base class)
- [ ] `docs/deploy.md` rollback playbook complete
- [ ] Migration scripts working local + preview + prod
- [ ] CI runs migrations against per-PR D1 successfully
- [ ] ULID generation utility in `apps/api/src/utils/id.ts` with test proving Workers compat
- [ ] Post-deploy `/readyz` head-vs-code parity check wired into `deploy.yml`

## Success Criteria

- [ ] All migrations apply idempotently
- [ ] DAO test proves DTOs returned, no drizzle types visible to caller
- [ ] Application-level cascade deletes children when parent deleted — proven in integration test running against real preview D1
- [ ] Preview workflow migrates fresh D1 in <30s
- [ ] Post-deploy `/readyz` returns 200 when heads match; 503 when mismatched (verified with a synthetic mismatch)
- [ ] `docs/deploy.md` rollback playbook exists and is linked from `docs/index.md`

## Risk Assessment

- **drizzle-kit + D1 http driver flakiness:** Prefer schema-only generation (no live introspection); if forced, use local sqlite for generation only, apply via wrangler.
- **D1 FK enforcement inconsistent:** `PRAGMA foreign_keys=ON` is not reliably persistent across HTTP-fronted D1 statements. Mitigation: application-level cascade in DAO deletes, executed via `db.batch([...])` for atomicity. Verified in integration test.
- **Migration atomicity across deploy:** Migrations run before Worker deploy. If Worker deploy fails after migration succeeds, DB is ahead of code. Mitigation: expand/contract discipline enforced by `scripts/lint-migrations.ts` (blocks combining destructive migration verbs with `apps/api/src/**` changes). `docs/deploy.md` covers the rollback playbook.
- **`schema_versions` codegen step:** Requires a build-time script to read the latest migration filename and inject it as `env.SCHEMA_HEAD`. Fragile if migrations dir layout changes; document in `docs/deploy.md`.
- **ULID on Workers:** `ulid` package uses WebCrypto — verify no Node built-in fallback path executes. Test asserts import + generation works in workerd.
- **ESLint custom rule perf:** Type-aware rules are slow. Scope the rule to `apps/api/src/dao/**` only; benchmark on empty tree.
