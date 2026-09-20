# Code Review: Phase 4 — OpenAPI Contract + Hono Route Skeleton

Plan: `plans/260920-1359-runway-blueprint-v1-api/phase-04-openapi-contract-hono-route-skeleton.md`

## Scope

Files reviewed: `apps/api/src/{openapi,zod-error-map,index,env}.ts`, `apps/api/src/dto/{error,pagination,common}.ts`, `apps/api/src/middleware/{request-id,error-handler,logger}.ts`, `apps/api/src/routes/{index,auth,me,admin,demo}.routes.ts`, `apps/api/test/openapi/*.test.ts`, `scripts/{export-openapi,openapi-diff}.ts`, `.github/workflows/ci.yml`, `.gitignore`, `apps/api/wrangler.toml`, `apps/api/package.json`, `packages/contracts/{package.json,src/index.ts}`.

## Overall Assessment

Solid implementation. Zod error-map is exhaustive against the v4 issue-code taxonomy and never falls back to `defaultError`. `/openapi.json` gating is construction-time (not a shadowed runtime route), matching the stated design. Problem+JSON envelope is uniform across all three error-handler branches. Route stubs cover every path in the plan's Architecture section with full Zod schemas, correct tags, and `security: [{ cookieAuth: [] }]` where appropriate. Middleware order matches the documented intent. No `z.any()` in public shapes. The main gaps are: (1) an untested production-gating claim, (2) a CI drift-check that silently no-ops for fork PRs, (3) a forward-looking landmine in the `Principal` type that will bite Phase 5/6, and (4) an unfinished `packages/contracts` re-export that the plan explicitly scoped into this phase.

## Critical Issues

None found.

## High Priority

**H1 — `Principal.permissions: Set<string>` cannot round-trip through `c.json()`.**
`apps/api/src/openapi.ts:23-26`. `JSON.stringify(new Set(['a','b']))` produces `{}` (verified: `node -e "console.log(JSON.stringify({p:new Set(['a','b'])}))"` → `{"p":{}}`). `MeResponse` in `me.routes.ts:16-23` declares `permissions: z.array(z.string())` — a contract mismatch against the `Principal` type that will hold this data. Any Phase 5/6 handler that does `c.json({ ...principal, roles })` or forgets `Array.from(principal.permissions)` will silently emit an empty permissions array (or, worse, if this shape is ever round-tripped for an authz decision after serialization, fails open/closed unpredictably). Fix now while the blast radius is one type declaration: either store `permissions` as `string[]` on `Principal` and build a `Set` locally in RBAC middleware for O(1) lookups, or add a documented serialization boundary (`toJSON()` / explicit mapper) that Phase 5/6 must use before this type reaches `c.json()`.

**H2 — `openapi-diff.ts` silently skips the breaking-change gate on fork PRs.**
`scripts/openapi-diff.ts:46-57`. `actions/checkout@v4` on a `pull_request` event checks out the PR head; for same-repo PRs `origin` is the base repo and `origin/main` resolves normally, but for **fork** PRs `origin` is set to the fork's remote, which has no `main` branch. `git fetch origin main` then fails, is caught (`catch` at line 50), and `originMainExists()` returns false, causing the script to `process.exit(0)` at line 56 — a "no-baseline" skip, not a failure. This means the CI job that's supposed to be the sole guard against breaking OpenAPI changes (Red Team F13's whole justification for not committing the spec) never runs for any external/fork contribution. Verify whether this repo accepts fork PRs; if so, either use `github.event.pull_request.base.sha` / an explicit `git fetch origin +refs/heads/main:refs/remotes/origin/main` against the canonical repo URL, or fail loudly instead of silently exiting 0 when fetch fails for a reason other than "repo has no history yet" (distinguish "shallow/empty repo" from "fetch failed").

## Medium Priority

**M1 — Production 404 gating for `/openapi.json` and `/docs` is not actually tested.**
`apps/api/test/openapi/production-guards.test.ts:14-34`. Despite the file name and the plan's explicit Success Criterion ("`curl /openapi.json` in prod → 404"), every assertion in this file runs against `APP_ENV=development` (the only env vitest-pool-workers binds) and only proves the dev-mode 200 path. The comment at lines 4-12 is honest that the actual prod-404 assertion is deferred to Phase 11 Bruno E2E — but that means this specific, plan-mandated success criterion is unverified by any test that exists today. The construction-time gate in `openapi.ts`/`index.ts` reads correctly on manual inspection, but "reads correctly" is not the same bar this plan set for itself elsewhere (e.g., the zod-error-map tests actually assert the negative). Recommend either a unit test that calls `createApp({ ...stubEnv, APP_ENV: 'production' })` directly and asserts the route table has no `/openapi.json` handler (fast, no need for a live prod deployment), or explicitly downgrade the plan's success criterion to "deferred to Phase 11" so it isn't silently marked done.

**M2 — `packages/contracts/src/index.ts` still a placeholder; plan scoped it into Phase 4.**
`packages/contracts/src/index.ts:1-2` still reads `// Placeholder package slot. Real OpenAPI contract + Zod schemas land in Phase 4.` The phase's own "Related Code Files" lists `Create: packages/contracts/src/index.ts re-exporting shared DTOs` as in-scope. It was not created. Not a functional bug (nothing currently consumes this package), but it's a plan/reality gap — either finish it this phase or explicitly move it to a later phase in the plan doc.

**M3 — `oasdiff` install is unpinned and un-verified.**
`.github/workflows/ci.yml:65-66` pipes `curl | sh` from `main` branch HEAD of `oasdiff/oasdiff`'s install script, with no version pin and no checksum verification. This is a supply-chain risk on every CI run (a compromised upstream script executes with the job's `permissions: contents: read` — limited blast radius here, but still arbitrary code execution in the CI runner). The plan's Implementation Steps mention `Tufin/oasdiff-action` as the intended mechanism; the actual workflow uses a raw curl-pipe-to-sh instead. Recommend pinning to a release tag/SHA and, ideally, switching to the GH Action (which pins by SHA and is auditable) as the plan originally specified.

## Low Priority

**L1 — `statusToSlugBase` default branch mislabels all "other" HTTPException statuses as `internal`.**
`apps/api/src/middleware/error-handler.ts:66-84`. Any `HTTPException` thrown with a status not in the switch (e.g. a future 400, 405, 410, 425 — several of which are already promised in route stubs' documented response tables, like `demo.routes.ts`'s 400/409/425) gets `type: .../internal` even though the numeric `status` field is correct. Cosmetic today (no code throws those HTTPExceptions yet) but will produce a misleading `type` URI as soon as Phase 5/9 middleware starts throwing `HTTPException(400, ...)` etc. without explicit `problem()` bodies — worth a TODO reference or extending the map now while the list of documented statuses is already known from the route files.

**L2 — `SettingsUpdateBody`'s `z.unknown()` justification comment isn't mirrored at its second use site.**
`apps/api/src/routes/admin.routes.ts:34-36` explains why `z.unknown()` is acceptable there; the second occurrence at line 88 (the `200` response schema for `PUT /admin/settings/{key}`) has no comment, so a future reviewer skimming only that line would flag it as a bare, unexplained escape hatch. Add a one-line pointer to the same Phase 8 justification.

**L3 — `paginatedResponse()` registers an unnamed inline schema per call site.**
`apps/api/src/dto/pagination.ts:20-25`. Called once for `AdminUserItem` and once for `NoteItem` — each produces a structurally-identical-shaped-but-separately-inlined `{ items, next_cursor }` object in the generated spec rather than a shared `$ref`'d component. Not a bug (valid OpenAPI, `oasdiff` handles it fine), but as more list endpoints are added the spec will accumulate duplicate inline envelope schemas instead of one reusable `PaginatedX` component. Consider `.openapi(\`Paginated\${itemName}\`)` if spec readability becomes a concern — YAGNI for now given only two call sites exist.

## Edge Cases Found by Scout

- `Set<string>` JSON-serialization landmine on `Principal` (H1) — not visible from the diff alone; only surfaces once a handler actually returns a `Principal`-derived body in Phase 5/6.
- Fork-PR CI bypass on `openapi:diff` (H2) — not visible without reasoning through `actions/checkout`'s remote-naming behavior under the `pull_request` trigger.
- `zod` vs `@hono/zod-openapi`'s re-exported `z` verified to be the *same module instance* (`z1 === z2` confirmed via a throwaway script), so mixing imports across `dto/error.ts` (imports from `@hono/zod-openapi`) and `dto/common.ts`/`dto/pagination.ts` (import from plain `zod`) is safe — not a bug, but worth recording since it looked suspicious on first read.
- `zod-error-map.ts`'s `default` branch deliberately never falls back to `ctx.defaultError` — confirmed by reading the switch; all eleven v4 issue codes from the review brief (`invalid_type`, `invalid_value`, `invalid_format`, `invalid_union`, `invalid_key`, `invalid_element`, `unrecognized_keys`, `too_small`, `too_big`, `not_multiple_of`, `custom`) are explicitly handled.

## Positive Observations

- `installZodErrorMap()` is correctly idempotent (module-level `installed` flag) and called both at `openapi.ts` import time and redundantly-but-safely in the test file.
- `error-handler.ts` correctly suppresses `err.message` in the 500 branch when `APP_ENV === 'production'` (no stack trace or internal detail leak).
- `request-id.ts` validates incoming `X-Request-Id` against the ULID regex before trusting it, rather than blindly echoing attacker-supplied values.
- `notFound()` in `index.ts` converts Hono's default 404 into the same Problem+JSON envelope, so unmatched routes (including `/openapi.json`/`/docs` in prod) don't leak a different response shape than the rest of the API — this is what makes the prod-gating claim in `createApp()`/`index.ts` credible even though M1 flags it as untested.

## Recommended Actions

1. Fix H1: decide `Principal.permissions` shape (plain array vs. documented serialization boundary) before Phase 5/6 build on top of it.
2. Fix H2: verify fork-PR behavior for `openapi:diff`; fail loud instead of silent-skip on fetch failure, or explicitly scope this repo to same-repo PRs only.
3. Address M1: add a construction-time unit test asserting `createApp({APP_ENV: 'production', ...})` never registers `/openapi.json`, or downgrade the plan's success criterion explicitly.
4. Decide M2: finish `packages/contracts/src/index.ts` this phase or move the task to a later phase in the plan doc.
5. Pin `oasdiff` install (M3) to a release tag/action SHA.
6. L1-L3 are cheap, defer if time-constrained.

## Metrics

- Files in scope: ~24
- Tests: 17 (per task description), all reviewed test files assert real behavior (no phantom tests observed)
- Local gate state: not re-run (per task instruction — pre-verified green)

## Unresolved Questions

- Does this repo accept PRs from forks? Determines whether H2 is exploitable in practice or purely theoretical.
- Is Phase 11's Bruno E2E collection actually scheduled to cover the prod-404 assertion, or is that a forward reference that may drift (per prior project-memory pattern: deferred work described as if already covered)?
