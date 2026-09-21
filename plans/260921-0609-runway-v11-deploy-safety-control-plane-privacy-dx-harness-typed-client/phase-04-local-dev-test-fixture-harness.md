---
phase: 4
title: "Local-Dev + Test Fixture Harness"
status: completed
priority: P2
effort: "1-2d"
dependencies: []
---

# Phase 4: Local-Dev + Test Fixture Harness

## Overview

Every consumer of the blueprint will otherwise hand-roll test users,
role assignment, cookie extraction, email assertions, and reset
logic. Extract the patterns that already appear across
`test/integration/*.test.ts` into a shared `@runway/test-fixtures`
package + a `pnpm dev:reset` CLI so consumer tests read like:

```ts
const { cookie } = await createMember({ email: 'alice@x.com' });
await loginAs(cookie);
const email = readLastSentEmail();
expect(email.template).toBe('verify-email');
```

Not `test/integration/rbac-flow.test.ts` boilerplate rebuilt every time.

## Requirements

- Functional
  - **`createMember({ email?, password?, role? })`** — signup + verify +
    optional role assignment; returns `{ userId, email, password, cookie }`.
  - **`createAdmin({ email? })`** — createMember + assign admin role.
  - **`loginAs(user, { rateLimitBypass? })`** — programmatic login,
    returns access + refresh cookies.
  - **`readSentEmails({ filter? })`** — wraps `getNoopSentEmails` with
    filters (by template, by recipient); resets buffer per-test.
  - **`resetTestDb()`** — truncates every user-scoped table
    (users, refresh_tokens, jwt_revocations, verification_tokens,
    user_roles, notes, feature_flags — but NOT roles/permissions/settings
    which come from seed migrations). Callable from `beforeEach`.
  - **`extractCookie(res, name)`** — robust cookie parser (currently
    duplicated across 5 test files).
  - **`pnpm dev:reset`** CLI — resets LOCAL D1 (miniflare instance), applies
    all migrations, seeds RBAC + settings + flags, creates a canonical
    dev-admin user (`admin@runway.local` / `correct-horse-battery-staple`).
    Runs in <30s.
- Non-functional
  - Package name: `@runway/test-fixtures` (dev-only workspace).
  - Zero production dependencies — imports only from `apps/api/src/*`
    for DAO reuse.
  - Every helper is isolate-safe: creates a fresh D1 test binding
    inside `beforeEach`; no shared mutable state.
  - The `pnpm dev:reset` script MUST refuse to run against remote D1
    (`runway_dev`, `runway_prod`). Only miniflare-local.
  - Cookie-jar model: `loginAs` returns a `RunwaySession` object with a
    `.fetch(input, init)` method that auto-attaches the correct
    cookies and CSRF headers. Tests never manually construct cookie
    strings.

## Architecture

```
packages/test-fixtures/
├── package.json               # @runway/test-fixtures
├── src/
│   ├── index.ts               # re-exports
│   ├── db.ts                  # resetTestDb (truncate user-scoped tables)
│   ├── users.ts               # createMember, createAdmin
│   ├── session.ts             # RunwaySession + loginAs
│   ├── email.ts               # readSentEmails + resetSentEmails
│   ├── cookies.ts             # extractCookie, parseCookieHeader
│   └── csrf.ts                # CSRF_HEADERS constant + `withOrigin(url)`
├── test/                      # meta-tests: the fixtures work as documented
│   └── smoke.test.ts
└── tsconfig.json
```

`RunwaySession` shape:

```ts
export interface RunwaySession {
  userId: string;
  email: string;
  accessCookie: string;
  refreshCookie: string;
  /**
   * Wraps SELF.fetch (or fetch) with cookies auto-attached and CSRF
   * headers on mutating verbs.
   */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  logout(): Promise<Response>;
}
```

CLI (`scripts/dev-reset.ts`):

```
1. Verify NOT running against remote (refuse if wrangler.toml doesn't
   include --local flag context).
2. Wipe local miniflare state:
   - Delete .wrangler/state/v3/d1/*
3. Re-apply every migration in order.
4. Insert dev-admin user via createUser (scrypt-hashed password).
5. Assign admin role.
6. Log the credentials + a `curl` example for login.
```

## Related Code Files

- Create: `packages/test-fixtures/{package.json, tsconfig.json, vitest.config.ts}`
- Create: `packages/test-fixtures/src/{index,db,users,session,email,cookies,csrf}.ts`
- Create: `packages/test-fixtures/test/smoke.test.ts`
- Create: `scripts/dev-reset.ts`
- Modify: root `package.json` — add `dev:reset` script
- Modify: `apps/api/package.json` — add `@runway/test-fixtures` to
  `devDependencies` (workspace:*)
- Migrate 3-5 existing integration tests to use the fixtures (proof
  the API works + halves their length):
  - `test/integration/rbac-flow.test.ts`
  - `test/integration/settings-flow.test.ts`
  - `test/integration/idempotency-flow.test.ts`
- Create: `docs/dev-harness.md`

## Implementation Steps

1. Scaffold `packages/test-fixtures/` package.json + tsconfig + vitest
   config mirroring `packages/rbac/` shape. Depend on nothing except
   `@runway/config` + `hono` peer + `zod` peer.
2. Extract `extractCookie` from any of the 5 integration tests
   currently duplicating it → `src/cookies.ts`.
3. Extract `CSRF_HEADERS` constant + `withOrigin(baseUrl)` helper into
   `src/csrf.ts`.
4. Write `resetTestDb(env)` — walks the truncate order used across
   integration tests. Import the schema tables from
   `@runway/api-schema` (new tiny re-export package? or dev-only
   direct import from apps/api/src/db/schema.ts via a `paths` tsconfig
   alias).
5. Write `createMember` → hits SELF.fetch(/auth/signup), extracts the
   noop-buffered verify token via `getNoopSentEmails`, hits
   /auth/verify, returns the user id + cookies from login.
6. Write `createAdmin` = `createMember` + `assignRoleByName('admin')`.
7. Write `RunwaySession` class with the auto-cookie-attach fetch
   wrapper. State: `accessCookie`, `refreshCookie`, `userId`.
8. Write `readSentEmails({ filter? })` — thin wrapper over
   `getNoopSentEmails` + `resetNoopEmailBuffer`.
9. Write `scripts/dev-reset.ts` — guardrail: check for `RUNWAY_LOCAL=1`
   env var; refuses to run without it. Steps in the flow above.
10. Migrate `rbac-flow.test.ts` first (it has the most helper
    duplication). Assert test count stays the same; line count drops
    ~40%.
11. Migrate `settings-flow.test.ts` and `idempotency-flow.test.ts`.
12. Meta-test: `packages/test-fixtures/test/smoke.test.ts` proves
    `createMember` + `loginAs` + `readSentEmails` + `resetTestDb` all
    work as documented.
13. Write `docs/dev-harness.md`: quickstart, safety rails (why
    dev:reset refuses remote), extending the harness with product-
    specific factories.

## Success Criteria

- [ ] `pnpm dev:reset` returns a working local D1 with admin user in <30s
- [ ] `pnpm dev:reset` refuses when target isn't miniflare-local
- [ ] Every fixture helper has a smoke test
- [ ] 3+ existing integration tests migrated; total LOC across those
      files drops by >30%; test count unchanged; all pass
- [ ] Adding a new product-specific factory (e.g. `createNote({
      user })`) follows the same pattern; documented recipe
- [ ] docs/dev-harness.md exists with quickstart + safety notes

## Risk Assessment

- **Import cycle risk**: `test-fixtures` importing from `apps/api/src/*`
  directly creates a package→app back-reference. Mitigation: use tsconfig
  `paths` mapping (dev-only), NOT a runtime workspace dep. If the alias
  approach feels wrong, extract the schema module into a fifth workspace
  package (`packages/schema`) — but that's a bigger refactor and
  probably v1.2.
- **Fixture state leak across tests**: Tests running in parallel
  could see each other's `notes` rows. Mitigation: `resetTestDb`
  before each test + isolate-per-file (already the vitest-pool-workers
  default).
- **dev:reset destructive on wrong target**: Guardrail is env-var
  gated + hard-coded refusal on `runway_dev` / `runway_prand`
  database names. Documented; test-only.
- **Fixture drift**: If a phase-1-5 change breaks fixture assumptions,
  the smoke test catches it, but existing consumer tests break too.
  Mitigation: fixtures follow the same semver-like discipline as the
  contracts package — breaking changes in a bump commit; consumers
  advised in release notes.
- **Password field in fixture output**: `createMember` returns the
  plaintext password so tests can re-login. This is fine for tests
  but must NOT leak into logs. Mitigation: the return type is
  `readonly`; `RunwaySession` doesn't retain the password; document
  the trap.
