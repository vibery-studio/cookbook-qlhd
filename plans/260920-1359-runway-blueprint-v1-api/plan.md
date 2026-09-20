---
title: "Runway Blueprint v1 API"
description: "Members-only Cloudflare Workers monorepo blueprint. API-first, TDD, RBAC, email, CI/CD from commit 1. Reusable chassis for future products."
status: pending
priority: P1
effort: "10-14d"
tags: [blueprint, cloudflare-workers, hono, drizzle, monorepo, tdd]
created: 2026-09-20
---

# Runway Blueprint v1 API

## Overview

Members-only scaffold on the Cloudflare Workers stack (Workers + D1 + KV + Queues + Assets). API-only in v1; SPA is a follow-up plan. Ships a running "hello tenant" chassis: password auth, verify-email flow, RBAC with role+permission catalog, provider-agnostic email (Resend + noop adapters), System Settings, idempotency, structured audit logging via Logpush, Sentry-ready observability, and green CI/CD with per-PR isolated D1. Clone this repo and every future product starts with a proven security posture, an OpenAPI contract as source of truth, and a documented recipe for adding new resources.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Clone → local stack running in <5 min after `wrangler login` completes (`pnpm bootstrap`) | P1 |
| 2 | Golden path passes end-to-end via HTTP: signup → verify → login → /me → RBAC deny/allow | P1 |
| 3 | CI/CD green from commit 1; PR previews with isolated D1 per PR + nightly reconcile | P1 |
| 4 | OpenAPI 3.1 spec exported from Zod is source of truth for future SPA SDK generation | P1 |
| 5 | Provider-agnostic email works with Resend + noop; SES documented as v2 recipe | P1 |
| 6 | RBAC catalog + policy engine extensible without middleware changes | P1 |
| 7 | System Settings + idempotency survive ecommerce bolt-on with no rewrite | P2 |
| 8 | Docs recipe: "add a new resource in <10 steps" proven by demo `notes` resource | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Discard Starter Stub](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Monorepo Foundation & CI/CD Skeleton](./phase-02-monorepo-foundation-cicd-skeleton.md) | Completed (local + CI green; PR/deploy-dependent verification pending CLOUDFLARE_API_TOKEN + first PR) |
| 3 | [Phase 3: Database, Drizzle Schema & Migrations](./phase-03-database-drizzle-schema-migrations.md) | Pending |
| 4 | [Phase 4: OpenAPI Contract & Hono Route Skeleton](./phase-04-openapi-contract-hono-route-skeleton.md) | Pending |
| 5 | [Phase 5: Password Auth & Session Management](./phase-05-password-auth-session-management.md) | Pending |
| 6 | [Phase 6: RBAC Package & Middleware](./phase-06-rbac-package-middleware.md) | Pending |
| 7 | [Phase 7: Email Port, Adapters & Templates](./phase-07-email-port-adapters-templates.md) | Pending |
| 8 | [Phase 8: System Settings Module](./phase-08-system-settings-module.md) | Pending |
| 9 | [Phase 9: Idempotency, Structured Audit Logging](./phase-09-idempotency-audit-log-money-package.md) | Pending |
| 10 | [Phase 10: Observability, Security Headers & Rate Limits](./phase-10-observability-security-headers-rate-limits.md) | Pending |
| 11 | [Phase 11: Golden Path E2E, Contract Test & Docs Recipe](./phase-11-golden-path-e2e-contract-test-docs-recipe.md) | Pending |

## Dependency Graph

- P2 (monorepo/CI) → foundation, blocks all
- P3 (DB schema) depends on P2
- P4 (OpenAPI/Hono) depends on P2, P3
- P5 (Auth) depends on P3, P4
- P6 (RBAC) depends on P3, P4, P5
- P7 (Email) depends on P2, P3, P4 (needed by P5 verify-email)
- P8 (Settings) depends on P3, P4, P6
- P9 (Idempotency/Audit) depends on P3, P4, P6
- P10 (Observability) depends on P4 (middleware attach point)
- P11 (E2E + docs) depends on ALL prior phases

Parallel opportunities: P5+P7 can develop in parallel once P4 lands (auth service consumes emailPort as a stub until P7 is wired). P8+P9 can parallelize after P6.

## Locked Decisions (post red-team, sealed)

- **Runtime:** Node 22 LTS, pnpm 10, Wrangler 4, TypeScript 5.6+; `nodejs_compat` compat flag enabled in `wrangler.toml`
- **Backend:** Hono + `@hono/zod-openapi` on Workers (Zod = spec + validator + types)
- **DB:** D1 with drizzle-kit for schema + migrations; DAOs hand-written returning DTOs; **application-level cascade** fallback since D1 `PRAGMA foreign_keys` is not reliably persistent per-connection
- **Auth:** Password only. Password hashing via **`@noble/hashes/scrypt`** (audited, pure-TS, Workers-safe) with OWASP 2024 params (N=2^17, r=8, p=1). JWT HS256 in httpOnly + Secure + SameSite=Strict cookie. Access token TTL **120s** (short; combined with revocation list on `jti` gives max-time-to-revoke ≤ 120s + KV lag). Refresh 7d, rotated via **atomic CAS** (`UPDATE … WHERE revoked_at IS NULL RETURNING`), replay-detected via replaced_by chain, hashed with **HMAC-SHA256 + `TOKEN_PEPPER` secret** (not plain SHA-256).
- **CSRF:** SameSite=Strict is primary defense; drop double-submit cookie; require custom header `X-Requested-With: fetch` (browsers block cross-origin custom headers via CORS preflight) + `Origin` equality check on state-changing methods. Login-CSRF blocked via `Origin` check.
- **RBAC:** Role + Permission + policy engine in `packages/rbac`. **No `scope` field in v1** (composite PKs are `(user_id, role_id)` and `(key)`); multi-tenant is a v2 migration.
- **Email:** `EmailPort` interface + **Resend + Noop adapters only**. React Email templates with per-template Zod-validated `props` (discriminated union). Cloudflare Queues for retry with exponential backoff capped at platform max delay; Cron-triggered sweeper re-enqueues verify emails for unverified users >15min old. SES documented as v2 recipe using `aws4fetch`, not hand-rolled SigV4.
- **System Settings:** D1 table + KV cache + Zod registry + admin API. Registry contains **only runtime-mutable** values (email.from_address, email.from_name). Auth TTLs, password rules, rate-limit thresholds move to Zod-parsed env (compile-time constants). **No `scope` field in v1.**
- **~~Money:~~** Deferred to v2. Documented in `docs/recipes/add-money.md` (Dinero.js integration recipe) but not shipped.
- **Idempotency:** `idempotency_keys` table + middleware. Key namespace: `${principalId}:${method}:${path}:${header}` — authenticated routes only (returns 400 on unauth). CAS insert (`INSERT OR IGNORE` with sentinel row) + polling loser gets 425 Too Early with `Retry-After`. Header format enforced via Zod: ULID/UUID only.
- **Audit:** Structured `logger.audit({actor, action, target, metadata})` → JSON to Logpush. **No `audit_log` D1 table in v1, no admin-audit route.** Query via Logpush destination (documented). Security-critical events (`auth.refresh.reuse_detected`, `settings.update`, admin mutations) are SYNC-logged before response; high-volume events (login-success, email.send) fire-and-forget.
- **DAO:** Hand-written per aggregate; ESLint rule forbids drizzle-typed exports from `dao/*.ts`. **No `BaseDao` abstract class** — enforce DTO discipline via lint + code review.
- **Hosting:** Workers Assets for future SPA (same origin as API)
- **Observability:** Workers Logpush + **`@sentry/cloudflare`** (official, actively maintained; no-op when `SENTRY_DSN` unset) + `/healthz` (shallow, public) + `/readyz` (deep, gated) + `x-request-id` middleware
- **Security:** scrypt via `@noble/hashes`, HMAC-hashed tokens with pepper, JWT `jti` revocation list in D1, CSRF via custom-header + Origin, Rate Limiting API (GA `[[ratelimits]]`) on `/auth/*` + `/readyz`, HSTS/CSP/X-Frame-Options/COOP headers, Problem+JSON errors (RFC 7807), Zod global error map strips `received` from issues, recursive PII scrubber, gitleaks in CI, `--ignore-scripts` in CI installs, per-PR `pnpm audit --audit-level=high`
- **Deploy:** **Expand/contract migrations enforced** — CI lint blocks PRs that combine destructive migration verbs (`DROP COLUMN`, `RENAME`, destructive `ALTER`) with code changes to `apps/api/src/**`. Migrations run before deploy; post-deploy `/readyz` gate halts and alerts if migration head SHA does not match embedded `schema_versions` row. `docs/deploy.md` ships in Phase 3 with a full rollback playbook.
- **CI/CD:** GitHub Actions for **CI only** (lint/typecheck/audit/test/build/bundle-size/wrangler-parity/gitleaks). Per-PR isolated D1 via `wrangler d1 create runway-preview-pr-${PR}`; teardown on PR close **and** nightly reconcile script in `security.yml` that lists all `runway-preview-pr-*` DBs, cross-references open PRs, deletes orphans older than 24h **and** any DB older than 14 days regardless of PR state. Bundle-size gate: `apps/api/dist` must stay under 900KB. `wrangler.toml` env-parity CI check asserts identical binding names across `[env.preview]` and `[env.production]`.
- **Prod deploys: MCP-first, not CI.** Production Worker uploads + D1 migrations run through the operator's Cloudflare MCP session (out-of-band `PUT /workers/scripts/{name}` + D1 `POST /query`), NOT through `wrangler deploy` in CI. This keeps `CLOUDFLARE_API_TOKEN` out of long-lived repo secrets. `.github/workflows/deploy.yml` remains as a documented `workflow_dispatch` fallback (typed confirmation) — never fires on push. Each phase's shipping section documents the MCP calls the operator runs to promote it to prod.
- **License:** Private (`UNLICENSED`)

## Non-Goals (v1)

- SPA React app (follow-up plan; blueprint exports OpenAPI JSON to `packages/contracts/dist/` ready for SDK generation)
- Admin UI (API endpoints only; admin uses curl / Bruno collection shipped in repo)
- OAuth / social login
- Multi-tenant orgs (schema stays single-tenant; add `scope` column in v2 migration when tenant model is known)
- i18n, billing, feature flags
- Postgres / Hyperdrive
- OpenTelemetry
- Audit log rotation (Logpush retention governs)
- SSR
- SES adapter (recipe documented; not shipped)
- `packages/money` (recipe documented; not shipped)
- `audit_log` D1 table + admin audit query API (structured logs via Logpush cover v1)
- `BaseDao` abstract class (lint rule instead)

## Success Criteria

- [ ] `pnpm bootstrap` completes in <5 min on a clean machine **after `wrangler login`** (documented in README, timed in Phase 2)
- [ ] `pnpm test` runs unit + integration (vitest-pool-workers) + build-size gate, all green
- [ ] Golden-path Bruno collection in `docs/bruno/` runs green against local Worker:
  - [ ] `POST /auth/signup` → 201; verify email captured by noop adapter
  - [ ] `POST /auth/verify` → 200 (double-click same token → second call returns 410 Gone, no state re-mutation)
  - [ ] `POST /auth/login` → 200 + `Set-Cookie`; missing `Origin` header → 403
  - [ ] `GET /me` with cookie → 200
  - [ ] `GET /admin/users` as member → 403
  - [ ] `GET /admin/users` as admin → 200
  - [ ] `PUT /admin/settings/email.from_address` → 200 + subsequent signup email uses new value
  - [ ] `POST /demo/notes` twice with same `Idempotency-Key` → same response body; concurrent same-key requests → exactly one handler execution
  - [ ] Two concurrent `/auth/refresh` with same cookie → exactly one succeeds, no chain revocation, no false `reuse_detected` event
- [ ] `openapi.json` regenerated in CI and diffed against `main` via `oasdiff` (NOT committed to repo; working-tree cleanliness enforced)
- [ ] PR checks required: lint + typecheck + unit + integration + build-size + wrangler-env-parity + expand-contract-migration + gitleaks + preview-deploy + healthz-smoke + oasdiff + `pnpm audit --audit-level=high`
- [ ] Per-PR D1 provisioned + torn down on close (verified in workflow logs); nightly reconcile job deletes orphans
- [ ] `docs/recipes/add-resource.md` walkthrough produces demo `notes` resource with tests green
- [ ] `@sentry/cloudflare` adapter no-ops cleanly when `SENTRY_DSN` unset; captures errors when set; PII scrubber verified with nested-`password` and JWT-in-URL test fixtures
- [ ] Rate limit on `/auth/login` returns 429 after threshold (tested)
- [ ] Password hashing uses `@noble/hashes/scrypt`; encoded hash string parses back to configured params (test asserts against downgrade)
- [ ] JWT access TTL 120s; revocation list in D1 checked on auth middleware with LRU memo; max-time-to-revoke documented as `120s + KV_lag`
- [ ] Refresh rotation uses atomic CAS (`UPDATE … WHERE revoked_at IS NULL RETURNING` with `.meta.changes === 1` guard)
- [ ] Verification/reset tokens: ≥32 bytes entropy, HMAC-SHA256 with `TOKEN_PEPPER` at rest, CAS consume with `used_at IS NULL` guard
- [ ] `/healthz` shallow public; `/readyz` deep, rate-limited, gated by shared-secret header
- [ ] All error responses are RFC 7807 problem+json; Zod issues strip `received` values before propagation
- [ ] Rollback playbook (`docs/deploy.md`) ships in Phase 3

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| scrypt CPU cost on Workers login latency | Med | Params tuned to ≤200ms/hash on Workers paid tier; documented in `docs/auth.md`; login rate-limited |
| drizzle-kit + D1 migration drift across envs | Med | Migration numbering + `wrangler d1 migrations` on deploy + `schema_versions` sentinel; expand/contract lint blocks destructive combos; rollback playbook |
| Per-PR D1 orphan accumulation | Med | Nightly reconcile via `security.yml`; 14-day hard TTL regardless of PR state |
| Queue retry storms on email 5xx | Med | Exponential backoff capped at platform max; DLQ; Cron sweeper for unverified users |
| `@sentry/cloudflare` breaking changes | Low | Pin exact version; smoke test in CI; PII scrubber unit-tested |
| Vitest-pool-workers slow tests | Med | Run unit + integration in parallel; contract tests are fast |
| D1 FK enforcement inconsistent | High | Application-level cascade in DAOs; integration test proves cascade via real preview Worker (not local unit) |
| Concurrent refresh / verify races | High | Atomic CAS with rowcount guard; integration test with concurrent requests |
| Idempotency cross-endpoint replay | Med | Key namespaced by `principal:method:path:key`; auth required; header format enforced by Zod |
| Bundle size (React Email + jose + noble) exceeds 1MB | Med | CI size gate at 900KB; verify-email.tsx prototyped in Phase 7 first commit; mustache-precompile fallback plan documented (LOC budget: ~150) |
| Supply-chain (postinstall scripts, transitive vulns) | Med | `.npmrc: ignore-scripts=true` + `pnpm.onlyBuiltDependencies` allowlist; per-PR audit gate; pinned exact deps for security-critical libs |

## Red Team Review

### Session — 2026-09-20
**Findings:** 15 (15 accepted, 0 rejected after evidence filter)
**Severity breakdown:** 4 Critical, 8 High, 3 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | WebCrypto scrypt does not exist on Workers | Critical | Accept | plan.md Locked Decisions; phase-05 |
| 2 | Rate-limit `unsafe.bindings` deprecated + `period=300` invalid | Critical | Accept | phase-10 |
| 3 | Refresh rotation lacks atomic CAS; concurrent tabs nuke chain | Critical | Accept | phase-05 |
| 4 | Prod deploy non-atomic; no expand/contract; no rollback playbook shipped | Critical | Accept | phase-02, phase-03 |
| 5 | Per-PR D1 teardown has no reconciliation | High | Accept | phase-02 |
| 6 | `/healthz` deep-check is public DoS amplifier | High | Accept | phase-10 |
| 7 | Idempotency key scope collisions (IP fallback, no method/path) | High | Accept | phase-09 |
| 8 | Audit via `waitUntil` silently drops security events | High | Accept | phase-09 |
| 9 | SES SigV4 hand-roll fragile | High | Accept (modified: drop SES from v1) | phase-07, plan.md Non-Goals |
| 10 | KV eventual consistency delays revocation | High | Accept | phase-05, phase-08, phase-10 |
| 11 | Verify/reset token double-click race | High | Accept | phase-05, phase-03 |
| 12 | Toucan-js abandoned; use `@sentry/cloudflare` | High | Accept | phase-10 |
| 13 | Contract test tautological; openapi-diff defeated | High | Accept (modified: don't commit spec) | phase-04 |
| 14 | YAGNI cluster (money/audit-API/scope/BaseDao) | High | Accept (modified: 4-way cut) | plan.md, phase-03, phase-06, phase-09 |
| 15 | React Email bundle size unmitigated | Medium | Accept | phase-02 (size gate), phase-07 |

Sub-findings folded in during application:
- CSRF double-submit toothless → replaced with custom-header + Origin check (phase-05)
- Token hash unsalted SHA-256 → HMAC + `TOKEN_PEPPER` (phase-03, phase-05)
- Sentry PII scrubber gaps → recursive walker + Zod global error map (phase-10)
- Unpinned deps / postinstall scripts → `.npmrc` `ignore-scripts=true` + audit gate (phase-02)
- 5-min bootstrap unmeasured → reframed as "post `wrangler login`" + timed in Phase 2 (plan.md Goals)
- PRAGMA FK no-op on D1 → application-level cascade + real preview test (phase-03)
- Email retry max-delay unverified → cap at CF platform max + Cron sweeper (phase-07)
- `wrangler.toml` env drift → CI validator + resolve rate-limit source-of-truth (phase-02, phase-10)

### Whole-Plan Consistency Sweep

Reconciled across `plan.md` and phases 01–11 after applying findings. Verified:
- All references to "WebCrypto scrypt" replaced with "`@noble/hashes/scrypt`"
- All references to "SES adapter" moved to v2 recipe
- All references to `packages/money` removed from v1 phases; recipe path documented
- All references to `audit_log` D1 table + `admin-audit` routes removed; replaced with `logger.audit(...)`
- All references to `scope` field on `user_roles` / `settings` removed from v1 schema (composite PKs simplified)
- All references to `BaseDao` removed; ESLint rule + doc pattern instead
- All references to `toucan-js` replaced with `@sentry/cloudflare`
- All references to CSRF double-submit replaced with custom-header + Origin equality
- All references to `[[unsafe.bindings]]` for rate limiting replaced with `[[ratelimits]]`
- All references to "committed openapi.json" replaced with "CI-regenerated + diff against main"
- Access token TTL changed from 15m to 120s; refresh CAS pattern replaced sequential steps
- Verify token consume path uses CAS
- Success criteria updated to reflect all above changes
- Non-Goals updated to include SES, money, audit table, BaseDao

No unresolved contradictions remain.

## Unresolved Questions

None post-red-team.

<!-- slug: runway-blueprint-v1-api -->
