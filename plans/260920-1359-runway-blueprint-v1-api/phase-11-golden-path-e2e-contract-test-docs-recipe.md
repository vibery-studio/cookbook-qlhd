---
title: "Phase 11: Golden Path E2E, Contract Test & Docs Recipe"
status: todo
---

# Phase 11: Golden Path E2E, Contract Test & Docs Recipe

## Overview

Final integration phase. Prove the blueprint works end-to-end with a Bruno HTTP collection that runs against local dev and preview deploys. Bruno collection exercises the FULL red-teamed contract: CSRF custom-header + Origin, refresh CAS, verify CAS, idempotency CAS, `/readyz` gate, rate limits, `jti` revocation on logout. Write the "add a resource in <10 steps" recipe and prove it by adding a demo `notes` resource with tests green. Write final README + top-level docs. Cut a v1 tag and dry-run a template clone flow so future products can start the blueprint quickly.

## Requirements

- Functional
  - [ ] Bruno collection under `docs/bruno/` covers full golden path
  - [ ] Collection runs headless via `bru run` in CI as final smoke stage
  - [ ] Recipe doc `docs/recipes/add-resource.md` walkthrough
  - [ ] Recipe validated by presence of `demo/notes` implementation (from P9) — recipe reflects actual steps done
  - [ ] Top-level `README.md` with quickstart, architecture diagram, extension points
  - [ ] `docs/index.md` navigation
  - [ ] v1 tag cut on `main` after all checks green
- Non-functional
  - [ ] Bootstrap-to-golden-path <5 min on clean machine (documented + timed)
  - [ ] All docs under `docs/` max 800 LOC per file
  - [ ] No secrets in Bruno collection (env vars only)

## Architecture

```
docs/
├── README.md               # (root) quickstart, philosophy
├── index.md                # navigation
├── architecture.md         # C4-ish system diagram, layer boundaries
├── ci.md                   # workflow map, required checks, secrets scoping
├── deploy.md               # rollback playbook, migration atomicity
├── rbac.md                 # permission catalog + adding permissions
├── email.md                # provider setup, DKIM/SPF, DLQ
├── settings.md             # registry, cache, adding a setting
├── audit.md                # event catalog, rotation notes
├── idempotency.md
├── money.md
├── observability.md        # Sentry, Logpush, healthz, rate limits
├── dao-pattern.md          # DAO/DTO contract, drizzle usage rules
├── recipes/
│   ├── add-resource.md     # THE recipe
│   ├── add-permission.md
│   ├── add-email-template.md
│   └── add-setting.md
└── bruno/
    ├── environments/
    │   ├── local.bru
    │   └── preview.bru
    └── collection/
        ├── 01-signup.bru                          # asserts Origin required; 403 without
        ├── 02-verify.bru                          # asserts CAS behavior: 2nd call same token → 410
        ├── 03-login.bru                           # asserts X-Requested-With + Origin required
        ├── 04-me.bru
        ├── 05-admin-forbidden.bru                 # member → 403
        ├── 06-seed-admin-and-login.bru
        ├── 07-admin-users.bru                     # admin → 200
        ├── 08-update-setting.bru                  # PUT /admin/settings/email.from_address
        ├── 09-signup-uses-new-from.bru
        ├── 10-idempotency-first-write.bru         # authenticated; ULID key
        ├── 11-idempotency-replay.bru              # same key + same body → cached
        ├── 12-idempotency-conflict.bru            # same key + different body → 409
        ├── 13-idempotency-unauth-refused.bru      # header on unauth route → 400
        ├── 14-rate-limit-login.bru                # 6th login → 429 + Retry-After
        ├── 15-readyz-token-required.bru           # without token → 401; with token → 200
        └── 16-logout-jti-revocation.bru           # logout, then reuse old cookie → 401
```

**"Add a resource in <10 steps" recipe (target — expanded in docs):**

1. Define Zod DTOs in `apps/api/src/dto/<resource>.ts`
2. Add route file `apps/api/src/routes/<resource>.routes.ts` with OpenAPIHono routes
3. Add schema to `apps/api/src/db/schema.ts` (drizzle)
4. `pnpm db:generate` → new migration
5. Add permissions to `packages/rbac/src/catalog.ts`
6. Add role grants in a new seed migration
7. Implement DAO `apps/api/src/dao/<resource>-dao.ts` as pure functions returning DTOs (no BaseDao; ESLint rule + `docs/dao-pattern.md` enforce discipline)
8. Implement Service `apps/api/src/services/<resource>-service.ts`
9. Wire route → service; apply `requirePermission` + optional `withIdempotency`
10. Write integration test; run `pnpm test`; commit

## Related Code Files

- Create: `docs/README.md`, `docs/index.md`, `docs/architecture.md`, `docs/ci.md`, `docs/deploy.md`, `docs/dao-pattern.md`
- Create: `docs/recipes/{add-resource,add-permission,add-email-template,add-setting,add-money,add-audit-store,add-ses-adapter,add-scope-multitenant}.md` (the last four are v2 recipes referencing Red Team-deferred features)
- Create: `docs/bruno/**` collection
- Modify: root `README.md` with quickstart
- Modify: `.github/workflows/preview.yml` — add `bru run` step against preview URL as final smoke
- Modify: `.github/workflows/ci.yml` — run `bru run` against local worker (spun up via `wrangler dev` in CI)
- Create: `docs/architecture.svg` (or ASCII art in md) — layer diagram: routes → middleware → services → DAOs → D1/KV/Queue; ports → adapters; contracts export

## Implementation Steps

1. **Author Bruno collection** (each request has post-response assertions on status + body shape)
2. **Wire Bruno into CI:**
   - `ci.yml`: `wrangler dev &` → wait for `/healthz` → `bru run docs/bruno --env local` → kill wrangler
   - `preview.yml`: after preview deploy → `bru run docs/bruno --env preview` with `BASE_URL=${preview_url}`
3. **Write README.md** — 5-min quickstart, architecture summary, philosophy paragraph
4. **Write architecture.md** — layer diagram, port/adapter examples, drizzle-DAO-DTO flow
5. **Write recipe docs** — literal copy-paste-ready steps; each recipe cross-referenced from README
6. **Author remaining pillar docs** (`ci.md`, `deploy.md`, `dao-pattern.md`) — deep enough to onboard a new engineer
7. **Prove the recipe:** temporarily wipe demo `notes` from P9, then re-add following the recipe verbatim. Ensure it takes <30 min and produces green tests. Restore.
8. **Final full run:** clean clone → `pnpm bootstrap` → `pnpm dev` → time to green golden path. Record in README (<5 min target).
9. **Cut tag:** `git tag v1.0.0 && git push --tags`. Draft GitHub release notes.
10. **Template dry-run:** verify `gh repo create --template runway new-product` produces a working repo (or document alternative like `degit`).

## Todo

- [ ] Bruno collection complete + running locally
- [ ] Bruno in CI (local + preview stages)
- [ ] README rewritten as production-quality quickstart
- [ ] Architecture doc with diagram
- [ ] Recipe docs (add-resource / add-permission / add-email-template / add-setting)
- [ ] Deep-dive docs (ci, deploy, dao-pattern, rbac, email, settings, audit, idempotency, money, observability)
- [ ] Recipe proven by re-adding demo/notes from scratch
- [ ] 5-min bootstrap timed and documented
- [ ] v1.0.0 tag cut
- [ ] Template flow documented

## Success Criteria

- [ ] `pnpm bootstrap && pnpm dev && bru run docs/bruno --env local` — all green on clean clone
- [ ] PR preview deploy runs full Bruno collection against preview URL
- [ ] Bootstrap-to-golden-path timed <5 min **after `wrangler login` completes** (README screenshot / recorded, per Phase 2 timing)
- [ ] Recipe followed by a new engineer produces `notes` resource with tests green in <30 min
- [ ] All plan.md success criteria are ticked (this phase closes the plan)
- [ ] Zero TODOs left in `apps/api/src/**` or `packages/**`

## Risk Assessment

- **Bruno CLI in CI:** `@usebruno/cli` (bru) works headless; pin version. Alternative: `newman` (Postman) — heavier. Keep Bruno.
- **`wrangler dev` in CI:** Needs port binding + healthz wait; use `wait-on http://127.0.0.1:8787/healthz`. Timeout after 30s.
- **Recipe rot:** Docs drift from code fast. Add a `docs:check` script that greps for known code paths mentioned in recipes; runs in CI. Not perfect but catches renamed files.
- **Demo `notes` in template output:** Recipe references demo notes as the proof-of-recipe. When the template is used to seed a new product, `apps/api/src/routes/demo.routes.ts`, the notes migration, and `notes:*` permissions should be stripped. Add a `pnpm strip-demo` script + documented step in template-usage docs.
- **Template-repo dependency:** GitHub template requires public visibility for `gh repo create --template` from personal use, but members-only means private repo — direct clones or org templates work. Document both paths.
- **`v1.0.0` cadence:** Blueprint versions independent from consumer product versions. Semver documented in `docs/versioning.md` (only in v2).
