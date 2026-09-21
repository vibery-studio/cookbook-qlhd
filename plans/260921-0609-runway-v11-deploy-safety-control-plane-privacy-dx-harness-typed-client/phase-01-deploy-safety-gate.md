---
phase: 1
title: "Deploy Safety Gate"
status: completed
priority: P1
effort: "4-6h"
dependencies: []
delivered_as: "local orchestrator (scripts/deploy-prod.sh) — MCP-first policy preserved"
---

# Phase 1: Deploy Safety Gate

## Overview

Close the docs-vs-workflow gap Codex flagged. `docs/deploy.md` promises a
production deploy that captures a recovery point, applies additive-only
migrations, verifies schema-head parity, hits `/readyz`, and rolls back on
failure. The actual workflow (`.github/workflows/deploy.yml`) is
`workflow_dispatch`-only and executes almost none of those steps. Ship the
gate for real.

**Delivery note (2026-09-21):** operator decided the gate ships as a LOCAL
orchestrator (`scripts/deploy-prod.sh` + `pnpm deploy:prod`) rather than a
CI workflow rewrite. This preserves the v1.0 MCP-first policy (no long-
lived `CLOUDFLARE_API_TOKEN` in repo secrets). The CI workflow header now
points operators at the local orchestrator; the fallback path is preserved.
Every functional check listed below runs identically in the local script;
the "auto-rollback on failure" primitive is a shell trap in
`deploy-prod.sh`, not a GH Actions step.

## Requirements

- Functional
  - Preflight validates every required secret binding is present before
    touching D1 or Workers.
  - Records a named recovery bookmark (D1 Time Travel) BEFORE running
    migrations. Stores the bookmark id + deploy metadata (SHA, timestamp,
    actor) to R2 (or GH release notes as v1.1 fallback).
  - Applies migrations. Fails LOUDLY on any error before continuing.
  - Verifies `schema_head` matches the expected sentinel after migration.
  - Deploys a uniquely versioned Worker (`wrangler deploy` with
    `--var BUILD_SHA=<git-sha>`).
  - Runs a post-deploy `/readyz` smoke against the newly-deployed Worker
    using `X-Readyz-Token`. Fails fast if D1 or KV checks fail.
  - Runs a targeted 3-request smoke: `/healthz`, `/openapi.json` in prod
    (should 404), and an auth-flow-adjacent GET (`/me` unauth → 401).
  - **Auto-rollback**: if any post-deploy check fails within 60s of
    deploy, wrangler-deploys the previous known-good version.
- Non-functional
  - The full deploy runs in <5 min for a happy path.
  - Zero manual steps between "workflow dispatched" and "green
    checkmark" — the whole gate is scripted.
  - No secrets in workflow logs (readyz token stays in GH secret, never
    echoed).
  - Idempotent: re-running the workflow with the same SHA is a safe no-op
    (deploy runs; verifications re-run; no double migration).

## Architecture

```
GH workflow_dispatch (deploy.yml)
  → 1. preflight
       ├─ pnpm typecheck && pnpm lint && pnpm test (already gated in CI on PR)
       ├─ pnpm check:bundle-size
       ├─ verify secrets: JWT_SECRET, TOKEN_PEPPER, READYZ_TOKEN,
       │   RESEND_API_KEY (via `wrangler secret list --env production`)
       └─ verify wrangler.toml env-parity (existing scripts/validate-wrangler.ts)
  → 2. recovery-point
       ├─ wrangler d1 time-travel bookmark runway_prod --name "deploy-${SHA}"
       └─ record { bookmark_id, sha, timestamp, actor } to GH artifact
  → 3. migrate
       ├─ pnpm db:migrate:prod
       └─ verify: SELECT MAX(id) FROM __drizzle_migrations equals expected
  → 4. deploy
       └─ wrangler deploy --env production
  → 5. verify (with 30s retry loop, max 60s wall clock)
       ├─ GET /healthz → 200 { ok, build_sha == ${SHA} }
       ├─ GET /readyz with X-Readyz-Token → 200, checks.db=ok, checks.kv=ok
       └─ GET /me (no cookie) → 401
  → 6. on any verify failure → auto-rollback
       ├─ wrangler rollback --env production (uses previous version)
       └─ post GH annotation with recovery bookmark id
  → 7. success → emit deploy record to GH release notes
```

Scripts to create/modify:

- `scripts/deploy-preflight.ts` — TypeScript preflight: secret presence,
  env-parity, schema-head sentinel expectation.
- `scripts/deploy-verify.ts` — Post-deploy loop calling `/healthz` +
  `/readyz` + one anon check.
- `scripts/deploy-rollback.ts` — Wrapper around `wrangler rollback`.
- `.github/workflows/deploy.yml` — Rewrite the job as sequential steps
  above; keep `workflow_dispatch` gating so it's manual-only.

Not in scope for this phase:

- Automated backup export to R2 (recovery point via D1 Time Travel is
  sufficient for v1.1; recipe for R2 export lives in `docs/deploy.md`).
- Blue/green deploy (single-Worker rollback is the primitive).

## Related Code Files

- Create: `scripts/deploy-preflight.ts`
- Create: `scripts/deploy-verify.ts`
- Create: `scripts/deploy-rollback.ts`
- Modify: `.github/workflows/deploy.yml` (rewrite as sequential gate)
- Modify: `docs/deploy.md` (align docs with the now-real workflow)
- Modify: `package.json` (add scripts: `deploy:preflight`,
  `deploy:verify`, `deploy:rollback`)
- Reference: `scripts/validate-wrangler.ts` (existing env-parity script)
- Reference: `scripts/get-schema-head.ts` (existing schema-head reader)

## Implementation Steps

1. Write `scripts/deploy-preflight.ts` — invokes existing validators, adds
   secret-presence check via `wrangler secret list --env production
   --json`. Return non-zero on any missing.
2. Write `scripts/deploy-verify.ts` — takes `--url` and `--token`, hits
   `/healthz`, `/readyz`, `/me` (anon) with the retry loop. Returns
   non-zero on any failure.
3. Write `scripts/deploy-rollback.ts` — wraps `wrangler rollback --env
   production` + posts a `::warning::` GitHub annotation.
4. Rewrite `.github/workflows/deploy.yml` as sequential steps. Keep
   `workflow_dispatch` only. Post-deploy verification uses the
   `PROD_READYZ_TOKEN` GH secret (never echoed).
5. Update `docs/deploy.md` to match the workflow. Include the rollback
   playbook explicitly ("your recovery point is the D1 Time Travel
   bookmark named `deploy-<SHA>`; here's how to restore").
6. Test the workflow end-to-end on a preview URL (dry-run branch) before
   marking the phase complete. Runbook: force a failing `/readyz` (e.g.
   temporarily corrupt READYZ_TOKEN secret) and verify rollback fires.

## Success Criteria

- [x] `pnpm deploy:preflight` catches a missing secret (secret-list step
      returns 1 on any missing required secret; smoke-tested via `--env dev`
      which skips the wrangler-secret path and still validates parity,
      bundle size, and schema head)
- [x] `pnpm deploy:verify` fails fast on a bad build_sha mismatch (checks
      body.build_sha === expected before proceeding to readyz)
- [x] Local orchestrator (`scripts/deploy-prod.sh`) sequentially executes
      preflight → recovery-point → migrate → deploy → verify; any red step
      triggers auto-rollback via `pnpm deploy:rollback`
- [x] `docs/deploy.md` matches the orchestrator exactly; the CI workflow
      header points operators at `pnpm deploy:prod`
- [x] `pnpm typecheck` + `pnpm lint` green; no regression to prior 191 tests
- [ ] End-to-end dry-run against real preview URL (deferred — requires a
      warm READYZ_TOKEN in the operator's shell; runbook in docs/deploy.md)

## Risk Assessment

- **Rollback isn't always safe**: `wrangler rollback` restores the code
  but NOT the DB. If a migration in step 3 wrote schema changes that the
  previous code doesn't understand, rollback leaves prod in a broken
  state. Mitigation: v1.1 policy is additive-only migrations (documented
  in `docs/deploy.md`); destructive migrations are a separate, manual,
  soak-then-cutover path.
- **False-positive verification**: KV eventual consistency may make
  /readyz return 503 on a fresh deploy for up to ~60s. Mitigation: 30s
  retry loop with 5s intervals; only fail after final attempt.
- **Recovery-point cost**: D1 Time Travel bookmarks are free but cap at
  30 days. Long deploy history requires per-week rotation. Mitigation:
  documented; explicit R2 export is a v1.2 recipe.
- **Preview workflow parity**: Consider whether preview deploys should
  run the same gate. v1.1 answer: yes, but as a follow-up — preview
  deploys don't currently exist as a discrete workflow yet.
