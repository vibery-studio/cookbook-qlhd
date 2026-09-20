# Code Review — Phase 3: Database, Drizzle Schema & Migrations

Reviewer: code-reviewer subagent
Date: 2026-09-20

## Scope

Files reviewed: schema.ts, client.ts, migration SQL + meta, user-dao.ts, id.ts,
cascade test, ulid test, eslint rule + config, wrangler.toml, package.json,
vitest.config.ts, drizzle.config.ts, docs/deploy.md, docs/dao-pattern.md,
get-schema-head.ts, deploy.yml, preview.yml — verified against
`plans/260920-1359-runway-blueprint-v1-api/phase-03-database-drizzle-schema-migrations.md`
and `plan.md` Locked Decisions / Red Team Review.

## Critical Issues

**C1. `schema_versions` is never populated by any tracked tooling.**
`docs/deploy.md:162-163` claims "Each migration ends with an `INSERT OR REPLACE
INTO schema_versions (head, applied_at) VALUES (?, ?)`" but
`apps/api/src/db/migrations/0000_busy_spitfire.sql` contains no such statement
(verified: pure CREATE TABLE/INDEX). `scripts/apply-migration.ts`, referenced
as the writer of this row in `apps/api/src/db/schema.ts:21` and
`drizzle.config.ts:7-9`, does not exist in the repo (confirmed via full-repo
grep/find). The remote row was inserted manually by the orchestrator via
`wrangler d1 execute --remote --file`, not by any repeatable script. There is
no path from "migration applied" to "schema_versions updated" for the next
real migration.
Fix: build `scripts/apply-migration.ts` / `db:record-head` per plan step 10,
or get explicit sign-off to defer to Phase 10 and correct all docs/comments
that currently describe this as already-automated.

**C2. `preview.yml` was not updated this phase.**
`.github/workflows/preview.yml:87-90` still has the Phase-2 placeholder:
`echo "migrations not yet implemented — Phase 3"` with a comment saying
"Phase 3 introduces... `pnpm db:migrate:preview`." Plan phase-03.md line 17
requires "Preview deploy runs migrations against per-PR D1 before serving
traffic" — unmet. Plan Related Code Files (line 160) lists this file as
Modify for this phase.
Fix: wire the step to run `db:migrate:preview` before "Deploy preview worker"
(depends on C3).

**C3. `db:migrate:preview` script does not exist.**
Plan phase-03.md step 10 (line 180) and Related Code Files (line 159) specify
it as a required package.json script. `package.json:22-26` has
`db:generate`, `db:migrate:local`, `db:migrate:dev`, `db:migrate:prod`,
`db:schema-head` — no `db:migrate:preview`. `docs/deploy.md:83` downgrades it
to "optional script" without a recorded decision. Per-PR preview D1s are
currently unmigrated by design.
Fix: add the script or get explicit user sign-off + update plan.md/deploy.md
consistently.

## High Priority

**H1. Rollback playbook's Time Travel step doesn't verify restored shape before mutating `d1_migrations`.**
`docs/deploy.md:148-155` deletes the bad migration's `d1_migrations` tracking
row immediately after a Time Travel restore, with no verification step that
the restore actually landed before the destructive change took effect. D1
Time Travel restores the whole DB (including `d1_migrations` itself); if the
operator picks a bookmark after the bad migration ran, the manual DELETE
creates tracking state disconnected from actual schema.
Fix: add a `PRAGMA table_info` (or equivalent) verification step between
restore and the `d1_migrations` DELETE.

**H2. No test proves the ESLint rule fires on a real violation.**
Only "lint passes on empty/clean DAO tree" is verified (phase-03 Todo line
195). No RuleTester fixture exercises a failing case for any of the 3
message IDs in `packages/config/eslint-rules/no-drizzle-typed-exports.js`. A
broken condition or AST-walk edge case (e.g. the generic fallback branch at
lines 126-129) would currently pass CI undetected.
Fix: add RuleTester unit tests — 1 passing + 1 failing fixture per message ID
minimum.

**H3. `generateUlid()` overflow throws with no documented caller contract.**
`apps/api/src/utils/id.ts:65` throws synchronously on random-component
overflow (practically unreachable — 32^16 IDs/ms). No caller
(`createUser`, future DAOs) catches this; docs/dao-pattern.md doesn't mention
it as a caller responsibility.
Fix: document as an accepted-unreachable unhandled exception in
docs/dao-pattern.md, or leave as-is if explicitly accepted.

**H4. `get-schema-head.ts` / `SCHEMA_HEAD` build var is unwired dead code.**
Neither `deploy.yml` nor `preview.yml` invokes `db:schema-head` or passes
`--var SCHEMA_HEAD:...` to `wrangler deploy` (only `BUILD_SHA` is passed).
Docs and schema.ts comments describe `/readyz` comparing against a
"compiled `BUILD_SHA`-associated head" as if wired now — consistent with the
C1 pattern of asserting current-tense automation that doesn't exist yet.
Fix: wire into deploy workflows this phase, or mark clearly as
"unused until Phase 10" in the script's own header.

## Medium Priority

**M1. `truncateAll` in cascade test globally truncates `roles` — latent cross-suite coupling risk.**
`apps/api/test/integration/user-dao-cascade.test.ts:32-41`. Not a bug today
(single file owns `roles` usage), but no comment documents the isolation
assumption for when Phase 6 RBAC tests seed `roles` in the same D1 instance.
Fix: add a comment documenting the assumption, or scope truncation to
suite-owned rows.

**M2. `role_permissions` / reverse-direction FK lookups have no index.**
Composite PK `(role_id, permission_id)` covers role_id-first lookups only;
`permission_id`-first and `user_roles.role_id`-first lookups have no index.
Plan's non-functional requirement (line 24) says "All tables have indexes on
FK and unique constraints." Not a confirmed defect — Phase 6 query patterns
aren't known yet.
Fix: verify against Phase 6's actual query patterns before adding
speculative indexes (stay YAGNI-consistent).

**M3. `drizzle-kit@0.30.1` (root package.json) vs `drizzle-orm@0.45.2` (apps/api) — unexplained version gap.**
These are normally released in lockstep; a 15-minor gap risks schema-gen
drift not caught until the next `db:generate` run. Not proven broken (one
generation cycle succeeded), but undocumented as an intentional choice.
Fix: confirm intentional or align versions.

## Regression Risk for Phase 4-11

- `Db` type (`client.ts:15`) is the full `ReturnType<typeof getDb>`, coupling
  every future DAO to the entire drizzle schema object rather than a narrow
  interface. Matches the plan's stated DAO signature decision — expect this
  to push Phase 5+ tests toward real `vitest-pool-workers` D1 rather than
  narrow mocks, which the plan already prefers.
- `findUserPasswordHashByEmail` (user-dao.ts:87-94) is a clean DTO-narrowing
  pattern worth Phase 5 replicating for auth lookups — no drizzle leak,
  minimal surface.

## YAGNI

No scope creep found. `get-schema-head.ts`/`SCHEMA_HEAD` (H4) is
plan-specified, just incomplete — not extraneous.

## Positive Observations

- Red Team constraints 1-9 (no scope column, no audit_log, no BaseDao,
  application-level cascade ordering, jwt_revocations present,
  schema_versions table present, namespaced idempotency key, ULID/TEXT/
  INTEGER typing, token_hash as PK) all verified correct line-by-line in
  schema.ts and the generated migration SQL.
- Zero FK constraints leaked into DDL — confirmed clean.
- Cascade test genuinely proves the invariant: seeds real dependent rows
  directly, asserts pre/post state, and the bystander test creates a second
  real user + dependent row rather than just checking absence.
- ULID test (1000 iterations, strict lexicographic ordering) is adequate.

## Recommended Actions

1. Resolve C1/C3 before calling this phase done — ship the missing scripts
   or get explicit deferral sign-off + correct docs.
2. Fix C2 (blocked on C3).
3. Add H2 rule fixture tests.
4. Tighten H1's Time Travel rollback verification step.
5. Close H4 — wire SCHEMA_HEAD or label inert.
6. M1-M3 non-blocking, address opportunistically.

## Unresolved Questions

- Was `db:migrate:preview` downgraded to "optional" an explicit user
  decision, or drift? No such downgrade is recorded in Red Team Review or
  Locked Decisions.
- Is `schema_versions` population intentionally deferred to Phase 10, or was
  it assumed complete this phase and missed? Needs a recorded decision
  either way.
