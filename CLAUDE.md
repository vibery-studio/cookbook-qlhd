# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Runway: members-only Cloudflare Workers API blueprint (Hono + `@hono/zod-openapi`, D1 via drizzle-orm, KV, Queues, Rate Limit bindings). pnpm + turbo monorepo. Node 22, pnpm 10.28.

- `apps/api` — the Worker (all routing/wiring).
- `packages/auth` (crypto primitives), `rbac` (policy engine + Hono middleware), `email-templates` (React Email + Zod), `contracts` (exported OpenAPI JSON, build artifact), `client` (typed client generated from contracts), `test-fixtures` (integration-test harness), `config` (shared ESLint/tsconfig/vitest + custom ESLint rules).
- Docs: `docs/index.md` is the map.

## Commands

```bash
pnpm bootstrap                 # first-time setup
pnpm dev                       # wrangler dev → http://localhost:8787
pnpm test | lint | typecheck | build   # turbo, all packages (test depends on build)

# single package / single test (api tests run in @cloudflare/vitest-pool-workers / miniflare)
pnpm --filter @runway/api exec vitest run test/integration/auth-flow.test.ts
pnpm --filter @runway/api exec vitest run -t "name pattern"
pnpm --filter @runway/rbac test

pnpm dev:reset                 # wipe local .wrangler state + reapply migrations
bru run docs/bruno --env local # golden-path smoke against local dev
```

CI gates (`.github/workflows/ci.yml`) — run locally before PR: `pnpm check:wrangler`, `pnpm check:migrations`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm openapi:diff` (needs `oasdiff`), `pnpm build`, `pnpm client:check`, `pnpm check:bundle-size`, `pnpm dedupe --check`.

## Architecture (big picture)

Request path: `index.ts` `buildApp(env)` per request → global middleware `requestId → logger → securityHeaders → requireNotMaintenance → requireWritesEnabled → requireOrigin → requireFetchHeader` → per-route `bodyLimit → requireAuth → requirePerm → rateLimit → withIdempotency` → route → service → DAO → bindings. `scheduled()` dispatches `src/crons/*` by `event.cron`; `queue()` dispatches `src/queues/*`.

Layer rules (ESLint-enforced, see `docs/architecture.md`, `docs/dao-pattern.md`):
- Routes/middleware own Hono `c`; services get plain data + `deps` bag, never `c`.
- DAO = pure functions `(db, input) → DTO`. No drizzle types (`$inferSelect` etc.) exported past `src/dao/` (`no-drizzle-typed-exports` rule). No BaseDao.
- External systems behind `src/ports/*`, implemented in `src/adapters/*`, selected by env (`selectEmailAdapter`, `selectErrorReporter`); tests inject fakes.
- No `PRAGMA foreign_keys` — cascades are application-level via `db.batch([...])`.
- Races use CAS (`UPDATE … WHERE … RETURNING` / `INSERT OR IGNORE`).
- All errors are RFC 7807 Problem+JSON (`dto/error.ts`). Logs pass `deepScrub`.
- Env vs settings: security-critical values in env (Zod-parsed in `env.ts`, redeploy to change); operator-tunable values in the typed settings registry (`src/settings`, KV-cached, `PUT /admin/settings/:key`). Flags / maintenance / write circuit / kill switches in `src/flags` (`docs/control-plane.md`). GDPR export/deletion in `src/privacy` (`docs/privacy.md`).

Extending: follow `docs/recipes/add-resource.md`; permissions → `docs/rbac.md`; flags → `docs/control-plane.md`.

## Contracts that must stay in sync

- **API change → OpenAPI → client**: `pnpm build` exports OpenAPI to `packages/contracts`; then `pnpm client:generate` and commit generated `packages/client/src/generated`. CI fails on drift (`client:check`) and on breaking changes (`openapi:diff`).
- **Schema**: `apps/api/src/db/schema.ts` is source of truth; `pnpm db:generate` (drizzle-kit, generate only — never `push`/`migrate`). Seed/data migrations are SQL files registered in `migrations/meta/_journal.json`. Apply with `pnpm db:migrate:{local,dev,preview,prod}` (wrangler). Tests auto-apply all migrations via `test/apply-migrations.ts`.
- **Expand/contract**: `check:migrations` blocks destructive SQL (DROP/RENAME) in the same PR as `apps/api/src` code changes. Split into two PRs.
- **wrangler.toml**: bindings must be mirrored across top-level, `[env.preview]`, `[env.production]` (`check:wrangler`).

## Tests

- api integration tests: `apps/api/test/integration/*`, use `@runway/test-fixtures` (`createMember`, `createAdmin`, `session.fetch`, `CSRF_HEADERS`, `readLastVerifyToken`) — see `docs/dev-harness.md`.
- Mutating requests need Origin + fetch header (CSRF); use `CSRF_HEADERS`/`TEST_ORIGIN`.
- CI serializes api test files (`CI=true`) due to miniflare instability; locally parallel.

## Deploy

Local-only from the operator's terminal with wrangler OAuth; no Cloudflare API token in CI (CI runs code-quality checks only). Prod: `READYZ_TOKEN=… pnpm deploy:prod` → `scripts/deploy-prod.sh` gate (preflight → D1 time-travel recovery point → migrate → deploy → verify, auto-rollback). Rollback: `pnpm deploy:rollback`. Details: `docs/deploy.md`.

## How we work (the Ship with Claude workflow)

@docs/WORKFLOW.md

- This project starts late in the course workflow, because two parts arrive already approved:
  - **ENGINEERING + skeleton = RUNWAY** (this repo): don't rewrite the base, extend it the way `docs/recipes/add-resource.md` says.
  - **INTENT + SPEC = the Cookbook** (`docs/cookbook/`): `documents.workbook.md` is the approved spec of the contract app,
    `design/` (FEEL, MOTION, DESIGN) is the approved design law, `mockup/index.html` the approved picture. Build from them.
- So each feature runs PLAN → BUILD → PROOF; its INTENT/SPEC are the workbook sections its roadmap row names.
- The roadmap (`docs/roadmap/ROADMAP-NN.md`, one Active) comes first; each row points to the workbook sections it builds.
- Replies and docs in Vietnamese. Address the human as "bạn", yourself as "mình".
