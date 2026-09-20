---
title: Deploy & Rollback Playbook
scope: operations
---

# Deploy & Rollback Playbook

Runway ships to Cloudflare Workers + D1 from the operator's terminal using
`wrangler` under the operator's local OAuth session (`~/.wrangler/config/default.toml`).
No long-lived `CLOUDFLARE_API_TOKEN` sits in GitHub secrets. CI runs code
quality only (lint, typecheck, audit, test, build, gitleaks); the Deploy
workflow is `workflow_dispatch`-only and stays as a documented fallback.

## Environments

| Env | D1 name | D1 ID | Worker name |
|---|---|---|---|
| dev (local) | `runway_dev` | `1969f138-…` | `runway-api-dev` |
| preview (per-PR) | `runway-preview-pr-N` | provisioned on demand | `runway-api-preview-pr-N` |
| production | `runway_prod` | `8e6382c3-…` | `runway-api-prod` |

Account ID: see `apps/api/wrangler.toml`.

## Expand / contract discipline

CI (`scripts/lint-migrations.ts`) blocks any PR that combines destructive
migration verbs (`DROP COLUMN`, `RENAME`, destructive `ALTER`) with changes
to `apps/api/src/**`. Break a schema change into two PRs:

1. **Expand.** Add the new column / table / index alongside the existing one.
   Deploy code that writes to both old and new (dual-write) and reads
   from the new column when present, else falls back to old.
2. **Contract.** After the expand deploy has stabilized (≥24h), a follow-up
   PR removes the old column / table / index. Because the running code
   already reads from the new location, the drop is safe.

Never destructive-alter and change reader code in the same commit.

## Normal deploy — production

Prerequisite: `wrangler login` (once). Wrangler refreshes the OAuth session
automatically on use.

```bash
# 1. Make sure local gates are green
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# 2. Verify no local schema drift
pnpm db:generate                 # should produce no new migration file
git status apps/api/src/db/migrations/

# 3. Apply any new migrations to production D1
pnpm db:migrate:prod             # `wrangler d1 migrations apply runway_prod --remote`

# 4. Deploy the Worker
cd apps/api
wrangler deploy --env production --var BUILD_SHA:$(git rev-parse HEAD)

# 5. Smoke test
curl -fsS https://runway-api-prod.<account>.workers.dev/healthz
# expected: {"ok":true}
```

Migrations apply BEFORE the Worker deploy, so if the deploy fails the DB is
ahead of the code — expand/contract makes that safe (new column is unused
by old code, no read-side error).

## Preview deploy — per PR

Previews are on-demand, not automatic. To bring up a preview for PR N:

```bash
# 1. Create a per-PR D1 (idempotent — errors if it exists)
wrangler d1 create runway-preview-pr-N
# capture the returned database_id

# 2. Sed the placeholders in wrangler.toml (locally — do NOT commit)
cd apps/api
sed -i.bak "s/PLACEHOLDER_PER_PR/<db-id>/" wrangler.toml
sed -i.bak "s/PLACEHOLDER_PR/N/" wrangler.toml

# 3. Migrate the fresh D1 (using --env preview so wrangler reads the
#    substituted database_id from the preview env block)
wrangler --config apps/api/wrangler.toml d1 migrations apply runway_preview --remote --env preview

# 4. Deploy the preview worker
wrangler deploy --env preview --var PR_NUMBER:N --var BUILD_SHA:$(git rev-parse HEAD)

# 5. Restore wrangler.toml (never commit the substitution)
mv wrangler.toml.bak wrangler.toml

# 6. Comment the URL on the PR manually or via `gh pr comment N -b '<url>'`
```

Teardown on PR close:

```bash
wrangler delete --env preview --name runway-api-preview-pr-N
wrangler d1 delete runway-preview-pr-N --skip-confirmation
```

The nightly reconcile job (Phase 2's `security.yml` — currently disabled
per MCP-first policy) is intended to catch orphaned preview D1s. Until
that's re-enabled, run manually every ~2 weeks:

```bash
pnpm reconcile:preview-dbs       # dry-run first: --dry-run
```

## Rollback — Worker only (migrations unchanged)

If the last deploy shipped bad code but no migration:

```bash
# List deployments and pick the previous version
wrangler deployments list --env production
wrangler rollback <version-id> --env production
```

Smoke test `/healthz`. Rollback is instantaneous.

## Rollback — code + migration

The hard case. If both a migration and code shipped, and the migration is
non-destructive (expand-only, per the discipline above), rolling back the
Worker to the previous version is safe: old code doesn't read the new
column. No DB action needed.

If a destructive migration slipped through (should be impossible via CI,
but human overrides happen):

1. Rollback the Worker first (`wrangler rollback`) so no live traffic
   depends on the changed shape.
2. Restore the affected table from a D1 Time Travel bookmark taken before
   the migration:

```bash
# List recent bookmarks
wrangler d1 time-travel info runway_prod

# Restore to a specific bookmark
wrangler d1 time-travel restore runway_prod --bookmark <bookmark-id>
```

D1 Time Travel gives 30 days of history on paid plans. Confirm the restore
target BEFORE running (bookmark IDs are opaque strings; check the
`timestamp` field to ensure you're restoring to the right moment).

3. **Verify the restore actually landed** BEFORE mutating `d1_migrations`.
   Time Travel restores the whole DB (including the tracking table itself),
   so a mispicked bookmark can leave you with a wrong schema and a
   correct-looking `d1_migrations`. Confirm by inspecting the schema of
   an affected table:

```bash
# Prove the destructive change was undone (example: column N still exists)
wrangler d1 execute runway_prod --remote --command \
  "PRAGMA table_info('affected_table')"

# Cross-check schema_versions matches the pre-bad-migration head
wrangler d1 execute runway_prod --remote --command \
  "SELECT head FROM schema_versions"
```

4. Only after the shape is verified, remove the row from `d1_migrations`
   for the reverted migration so `wrangler d1 migrations apply` doesn't
   skip it if it needs to be re-run later:

```bash
wrangler d1 execute runway_prod --remote --command \
  "DELETE FROM d1_migrations WHERE name = 'NNNN_bad_migration.sql'"
```

5. Post-mortem in `plans/reports/` covering how it bypassed the expand /
   contract lint and what to change so it can't happen again.

## Schema-version sentinel

The `schema_versions` table (created by `0000_busy_spitfire.sql`) holds
the currently-applied migration filename. Phase 10 wires the automation
that (a) writes the row after every `wrangler d1 migrations apply` and
(b) reads it from the `/readyz` endpoint to compare against the compiled
Worker's `SCHEMA_HEAD` build var — a mismatch there returns 503 and CI's
post-deploy gate halts.

**Until Phase 10 lands**, the row is written by the operator after each
migration:

```bash
# After `pnpm db:migrate:prod` succeeds, record the applied head:
HEAD=$(pnpm --silent db:schema-head)   # prints e.g. "0001_add_notes.sql"
wrangler d1 execute runway_prod --remote --command \
  "INSERT OR REPLACE INTO schema_versions (head, applied_at) VALUES ('$HEAD', $(date +%s))"
```

To check parity in production:

```bash
wrangler d1 execute runway_prod --remote --command \
  "SELECT head, datetime(applied_at,'unixepoch') FROM schema_versions LIMIT 1"

# should equal the highest-numbered file in apps/api/src/db/migrations/
```

## Secrets

Set once per env:

```bash
cd apps/api
wrangler secret put JWT_SECRET --env production
wrangler secret put TOKEN_PEPPER --env production
wrangler secret put READYZ_TOKEN --env production
wrangler secret put RESEND_API_KEY --env production        # optional (Phase 7)
wrangler secret put SENTRY_DSN --env production            # optional (Phase 10)
```

Rotation runbook lives in `docs/auth.md` (Phase 5) — rotating `JWT_SECRET`
invalidates all active sessions; rotating `TOKEN_PEPPER` invalidates all
refresh + verification tokens.
