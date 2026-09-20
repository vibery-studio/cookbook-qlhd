---
title: "Phase 2: Monorepo Foundation & CI/CD Skeleton"
status: in-progress
---

# Phase 2: Monorepo Foundation & CI/CD Skeleton

## Overview

Establish the pnpm + Turborepo monorepo, shared tsconfig/eslint/vitest configs, git init, `.gitignore`, private license, Wrangler-ready `apps/api` skeleton, and GitHub Actions from commit 1. No business logic yet — this phase produces a repo that lints, typechecks, builds, and deploys an empty Worker that returns 200 on `/healthz`. Establishes the invariants every later phase depends on, PLUS the supply-chain and preview-hygiene gates surfaced in red-team review.

## Requirements

- Functional
  - [ ] `pnpm bootstrap` → installs everything on Node 22
  - [ ] `pnpm dev` → runs `wrangler dev` for `apps/api` with local D1/KV bindings
  - [ ] `pnpm test` runs on Vitest (Node) and vitest-pool-workers (workerd)
  - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all green on empty tree
  - [ ] **Bundle-size gate:** `pnpm build` fails if `apps/api/dist` (compressed) exceeds 900KB
  - [ ] **Wrangler env-parity check:** CI fails if any `[env.*]` block declares a different set of binding names than another
  - [ ] **Expand/contract migration lint:** CI fails if a PR combines destructive migration verbs (`DROP COLUMN`, `RENAME`, destructive `ALTER`) with changes to `apps/api/src/**`
  - [ ] GitHub Actions `ci.yml` runs on every PR; blocks merge on red
  - [ ] `deploy.yml` deploys `main` to production Worker (post-deploy `/readyz` gate verifies schema head matches deployed code)
  - [ ] `preview.yml` deploys PR to isolated preview Worker + D1
  - [ ] `security.yml` runs nightly (was weekly): gitleaks + `pnpm audit --audit-level=high` + **D1 orphan reconcile** (lists `runway-preview-pr-*` DBs, cross-references open PRs via `gh pr list`, deletes orphans older than 24h; hard 14-day TTL regardless of PR state)
  - [ ] **`pnpm audit --audit-level=high` runs on every PR** (was weekly-only)
- Non-functional
  - [ ] All secrets via `wrangler secret` and GitHub encrypted secrets
  - [ ] `gitleaks` scan runs in CI on every push
  - [ ] `.npmrc: ignore-scripts=true` in the repo; postinstall scripts allowlisted per package via `pnpm.onlyBuiltDependencies`
  - [ ] `wrangler.toml` enables `compatibility_flags = ["nodejs_compat"]` (required by `jose` and other libs that reference node built-ins conditionally)
  - [ ] `pnpm dedupe --check` in CI

## Architecture

```
runway/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── index.ts             # Hono app entrypoint (returns 200 on /healthz)
│       │   └── env.ts               # Zod-validated Env bindings
│       ├── test/
│       │   └── healthz.test.ts      # Smoke
│       ├── wrangler.toml            # bindings: D1, KV, Queue, Assets, Rate Limiting
│       ├── package.json
│       └── tsconfig.json → extends packages/config/tsconfig.base.json
├── packages/
│   ├── config/
│   │   ├── tsconfig.base.json
│   │   ├── eslint.config.js
│   │   ├── vitest.base.ts
│   │   └── package.json
│   ├── contracts/                   # empty in P2; OpenAPI json lands here in P4
│   ├── rbac/                        # placeholder package
│   ├── auth/                        # placeholder package
│   ├── money/                       # placeholder package
│   └── email-templates/             # placeholder package
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── preview.yml
│       ├── deploy.yml
│       └── security.yml
├── docs/
│   ├── README.md
│   └── recipes/                     # populated in P11
├── scripts/
│   ├── bootstrap.sh
│   └── migrate-preview-db.sh
├── .gitignore
├── .nvmrc                           # 22
├── .npmrc                           # engine-strict=true
├── package.json                     # workspaces, private, "packageManager": "pnpm@10.x"
├── pnpm-workspace.yaml
├── turbo.json
├── LICENSE                          # UNLICENSED / All rights reserved
└── README.md
```

## Related Code Files

- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.gitignore`, `.npmrc`, `LICENSE`, `README.md`
- Create: `apps/api/*` skeleton (Hono returning `{ok:true}` on `/healthz`, Zod env parsing)
- Create: `apps/api/wrangler.toml` with placeholder bindings (D1 name `runway_dev`, KV `SESSIONS`, Queue `email-retry`, `[[ratelimits]]` `RL_AUTH_LOGIN`) + `compatibility_flags = ["nodejs_compat"]`
- Create: `packages/config/{tsconfig.base.json,eslint.config.js,vitest.base.ts,package.json}`
- Create: `packages/{contracts,rbac,auth,email-templates}/package.json` (placeholder empty packages) — **NO `packages/money` in v1**
- Create: `.github/workflows/{ci.yml,preview.yml,deploy.yml,security.yml}`
- Create: `scripts/bootstrap.sh`, `scripts/migrate-preview-db.sh`
- Create: `scripts/validate-wrangler.ts`, `scripts/check-bundle-size.ts`, `scripts/reconcile-preview-dbs.ts`, `scripts/lint-migrations.ts`

## Implementation Steps

1. Write failing test: `apps/api/test/healthz.test.ts` expects `GET /healthz` → 200 `{ok:true}` using vitest-pool-workers
2. Init pnpm workspace, root `package.json` with `packageManager: pnpm@10`, `engines.node: ">=22"`
3. Create `packages/config` with shared tsconfig (strict, target ES2022, module ESNext, moduleResolution Bundler), ESLint (typescript-eslint recommended-type-checked), Vitest base
4. Scaffold `apps/api` with Hono skeleton + Zod-parsed `Env`; `/healthz` route only
5. Author `wrangler.toml` with dev/preview/prod envs, D1/KV/Queue/Assets/RateLimiter bindings named
6. Write GitHub Actions workflows:
   - `ci.yml`: node 22 setup → `pnpm install --frozen-lockfile --ignore-scripts` → lint → typecheck → `pnpm audit --audit-level=high` → `pnpm dedupe --check` → `tsx scripts/validate-wrangler.ts` → `tsx scripts/lint-migrations.ts` → test → build → `tsx scripts/check-bundle-size.ts` → gitleaks
   - `preview.yml`: on PR opened/sync → provision D1 (`wrangler d1 create runway-preview-pr-${{github.event.number}}`) → run migrations → `wrangler deploy --env preview --var PR_NUMBER=${{github.event.number}}` → comment preview URL on PR → smoke test `/healthz`
   - `preview.yml` cleanup: on PR closed AND on branch delete → `wrangler d1 delete` + `wrangler delete` for preview worker (with retry on transient CF 5xx)
   - `deploy.yml`: on push to `main` → migrate prod D1 → `wrangler deploy --env production` → post-deploy `/readyz` smoke test asserting `schema_versions` head matches deployed `BUILD_SHA` before returning success
   - `security.yml`: **nightly** (was weekly) → gitleaks + `pnpm audit --audit-level=high` + `tsx scripts/reconcile-preview-dbs.ts` (delete orphaned `runway-preview-pr-*` DBs whose PR is closed >24h OR any DB >14 days old regardless of PR state)
7. Time the bootstrap: from a clean clone (fresh machine, after `wrangler login`), run `time pnpm bootstrap && time pnpm dev` — record in `README.md`. Target <5 min.
8. Verify test passes locally via `pnpm test` and CI on first PR
9. Turbo pipeline: `build`, `test`, `lint`, `typecheck` with proper `dependsOn` and cache config
10. Document bootstrap in `README.md` (Node 22, pnpm 10, wrangler login, `pnpm bootstrap`) — split the 5-min claim into "pre-req time" (Node/pnpm/wrangler install + CF account + `wrangler login`) vs "bootstrap time" (post-login)

## Todo

- [x] Root workspace configured (pnpm + turbo)
- [x] `apps/api` Hono skeleton + `/healthz` test green (14ms locally)
- [x] Shared `packages/config` consumed by all workspaces
- [x] `wrangler.toml` with all binding stubs + `nodejs_compat` flag
- [x] 4 GitHub Actions workflows created (CI job green on first push — run 35498599216, 45s)
- [ ] gitleaks configured with `.gitleaks.toml` (deferred; default config used until first false positive)
- [x] `.npmrc` includes `ignore-scripts=true`
- [x] `pnpm.onlyBuiltDependencies` allowlist populated (`pnpm-workspace.yaml`)
- [x] `scripts/validate-wrangler.ts` implemented + wired into CI
- [x] `scripts/check-bundle-size.ts` implemented + wired into CI (900KB gzip gate)
- [x] `scripts/reconcile-preview-dbs.ts` implemented + wired into `security.yml` (uses `secrets.GITHUB_TOKEN`)
- [x] `scripts/lint-migrations.ts` implemented + wired into CI
- [ ] Branch protection rules documented in `docs/ci.md` (deferred; `docs/` populated in later phases)
- [ ] `pnpm bootstrap` script tested on clean clone AND timed; result recorded in `README.md` (pending first clean-clone run)
- [ ] Preview D1 provision + teardown proven end-to-end on a throwaway PR (pending first PR + CF_API_TOKEN)
- [ ] Nightly reconcile job proven by manually orphaning a DB then verifying next-run deletion (pending manual verification)

## Success Criteria

- [x] `pnpm test` green with only `/healthz` test
- [x] CI passes on empty PR (no changes) in <3 min — verified on run 35498599216 (45s)
- [ ] Preview worker responds on `https://runway-preview-pr-N.<account>.workers.dev/healthz` (pending first PR + CF_API_TOKEN)
- [ ] Prod Worker deployed via MCP `PUT /workers/scripts/runway-api-prod` at phase ship time; `/healthz` returns 200 (`/readyz` verification deferred to Phase 10)
- [ ] gitleaks catches a planted fake secret in a test PR (pending first PR)
- [x] Wrangler env-parity check fails a synthetic PR that removes a binding from one env — script logic proven locally
- [x] Bundle-size check fails a synthetic PR that imports a bloated dep — script logic proven locally (current build 20.36 KB gzipped, 2.3% of budget)
- [ ] Bootstrap time recorded in README with hardware spec + network baseline (pending first clean-clone timing)

## Risk Assessment

- **Wrangler auth in CI:** Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` GitHub secrets scoped to Workers:Edit, D1:Edit. Document scoping in `docs/ci.md`.
- **D1 orphans:** Cloudflare allows many D1 DBs per account but leaked previews still cost storage and clutter. Reconcile script runs nightly; hard 14-day TTL enforced regardless of PR state.
- **Vitest-pool-workers Node 22 compat:** Pin `@cloudflare/vitest-pool-workers` to a Wrangler-4-compatible version; smoke on install; document known-working version in `docs/ci.md`.
- **pnpm 10 breaking changes:** Lock `packageManager` field to exact version to prevent surprise upgrades.
- **`nodejs_compat` bundle bloat:** Flag can pull in additional polyfills. Bundle-size gate catches regressions; verify current apps/api build stays comfortably under 900KB after flag enabled.
- **`ignore-scripts=true` breakage:** Some deps rely on postinstall (e.g., `esbuild` binary download). Allowlist via `pnpm.onlyBuiltDependencies`; document additions in `docs/ci.md`.
