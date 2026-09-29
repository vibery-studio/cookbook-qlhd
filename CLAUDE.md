# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A contract-management app ("quản lý hợp đồng") for a small Vietnamese team: staff create contracts from versioned
templates, managers and the director approve them (never their own; one person per step), a manager or the director issues them with a gap-free number, and every move is
audited. Built on **RUNWAY** (a members-only Cloudflare Workers API base, already accepted) from the **Cookbook**
(`docs/cookbook/`, the approved spec and design). Three roles: Nhân viên · Quản lý · Giám đốc.

Stack: Cloudflare Workers · Hono + `@hono/zod-openapi` · D1 via drizzle-orm · KV · Queues. pnpm + turbo monorepo,
Node 22, pnpm 10.28. `apps/api` is the Worker; `packages/*` = auth, rbac, client (generated), contracts (OpenAPI),
test-fixtures, config, email-templates. `apps/web` (roadmap row 4) = React + Vite SPA calling `packages/client`.
Owner = Công ty TNHH Phần mềm Nhật Minh; facts (template, Bên A, price list) from
`~/Documents/ship-with-claude/modules/M5/01-tu-lieu-khach-gui/owner-box/` (07_Mau_Tai_Lieu, 09_Bang_Gia.xlsx).

## Commands

```bash
pnpm dev                                   # wrangler dev → http://localhost:8787 (/docs = Swagger)
CI=true pnpm test                          # ALWAYS CI=true on this machine: parallel miniflare exhausts ports
CI=true pnpm --filter @runway/api exec vitest run test/integration/<file>.test.ts   # one file
pnpm lint && pnpm typecheck && pnpm build
pnpm db:generate                           # drizzle-kit, generate only — never push/migrate
pnpm db:migrate:local                      # apply migrations to local D1
RUNWAY_LOCAL=1 pnpm dev:seed-admin         # with pnpm dev up: admin@runway.local / correct-horse-battery-staple (local D1)
pnpm openapi:export && pnpm client:generate   # after any API change (CI fails on drift); generate alone reuses a STALE dist/openapi.json
```

Reset local data: `mv apps/api/.wrangler/state /tmp/state-$(date +%H%M%S)` then migrate. **Not** `pnpm dev:reset`:
it wipes `<repo>/.wrangler/state`, but the dev D1 lives in `apps/api/.wrangler/state`.
Ports: 8788 belongs to another project on this machine — never stop it. Stop only your own processes, by PID.
`docs/cookbook/e2e-kit/free-ports.sh` kills EVERY wrangler/workerd of this repo (incl. `pnpm dev` on 8787) — restart dev after e2e.

## Project files — the source of truth

1. `ENGINEERING.md` — approved: the RUNWAY base. Rules in `docs/architecture.md`, `docs/dao-pattern.md`, `docs/rbac.md`;
   add a resource the way `docs/recipes/add-resource.md` says. Extend the base, never replace it.
2. `docs/cookbook/` — approved INTENT + SPEC: `documents.workbook.md` (the recipe: domain, decisions, guards, tests,
   probes), `design/` FEEL · MOTION · DESIGN (the look as law), `mockup/index.html` (the approved picture),
   `e2e-kit/` (browser-test harness + UI proof budget). `mcp-codemode.workbook.md` is a DRAFT — only when asked.
3. `docs/roadmap/ROADMAP-NN.md` — the order of features. Exactly one is Active; build only what is on it. Each row
   names the workbook sections it builds.
4. Per row: `docs/plan/PLAN-NN.md` + `docs/plan/cards/` — PLAN → BUILD → PROOF (the workbook is its INTENT/SPEC).

## Workflow

@docs/WORKFLOW.md

- Research current official docs before any install command, config, or API; never write them from memory.

## Rules

- RUNWAY rules that bite: routes own Hono `c`, services never see it; DAOs are pure `(db, input) → DTO`; races use CAS
  (`UPDATE … WHERE … RETURNING`) and `db.batch` — never check-then-write; errors are RFC 7807 Problem+JSON; writes need
  `Origin` = `APP_ORIGIN` + `X-Requested-With: fetch`; wrangler bindings are mirrored in every env block.
- API change → OpenAPI → `pnpm client:generate`, same commit. Schema change → `pnpm db:generate`; destructive SQL never in
  the same PR as code that needs it (expand/contract).
- Facts (names, prices, numbers, terms) come only from the human or the Cookbook. Missing → a TODO and ask.
- A load-bearing choice (identity, delete, money, security, a guard) → options + recommendation; the human decides.
- Tests: observable behaviour, a contract, or a credible regression — one owner test at the strongest boundary. A
  bug-fix test must fail on the old code first. Browser tests follow `docs/cookbook/e2e-kit/README.md` (one red run,
  one PROOF run, API suite and e2e never at the same time).
- Docs and replies in Vietnamese; product in Vietnamese. Address the human as "bạn", yourself as "mình".
- Deploy: local only, by the human (`docs/deploy.md`). Never deploy or create Cloudflare resources yourself.
