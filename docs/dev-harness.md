# Dev Harness

`@runway/test-fixtures` + `pnpm dev:reset` — Phase 4 of the v1.1 plan.
Extracts the boilerplate that every consumer of the blueprint would
otherwise hand-roll: signup + verify + login + role assignment, cookie
extraction, CSRF headers, test-DB reset.

## Quickstart (integration tests)

```ts
import { env, SELF } from "cloudflare:test";
import {
  createAdmin, createMember, readLastVerifyToken, truncateTables,
} from "@runway/test-fixtures";
import {
  getNoopSentEmails, resetNoopEmailBuffer,
} from "../../src/adapters/email-noop";
import { assignRoleByName } from "../../src/services/admin-service";
import { getDb } from "../../src/db/client";
import { /* your user-scoped tables */ } from "../../src/db/schema";

const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);

const memberDeps = {
  fetcher,
  readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
};

const adminDeps = {
  ...memberDeps,
  assignAdminRole: async (userId: string) => {
    await assignRoleByName(
      { db: getDb(env), kv: env.SESSIONS, env },
      { userId, roleName: "admin" },
    );
  },
};

beforeEach(async () => {
  await truncateTables(getDb(env), [/* children first, then users */]);
  resetNoopEmailBuffer();
});

it("admin can hit /admin/settings", async () => {
  const admin = await createAdmin(adminDeps, { email: "a@x.com" });
  const res = await admin.session.fetch("/admin/settings");
  expect(res.status).toBe(200);
});
```

That's a full integration test. No local `extractCookie`, no `CSRF_HEADERS`
literal, no `signupVerifyLoginAsAdmin` bootstrap function. See
`apps/api/test/integration/rbac-flow.test.ts` (~31% smaller after
migration) and `settings-flow.test.ts` for reference.

## API

### `createMember(deps, { email?, password? })`
Signup → verify → login. Returns `{ userId, email, password, session }`.
The `password` is plaintext (needed for re-login scenarios) — do NOT log it.

### `createAdmin(deps, { email?, password? })`
Same as `createMember` + assigns the `admin` role BEFORE login so the
access token issued at login already carries admin permissions.

### `session.fetch(path, init?)`
Auto-attaches:
- both cookies (`runway_at` + `runway_rt`)
- CSRF headers (`Origin`, `X-Requested-With`, `Content-Type: application/json`)
  on mutating verbs

Relative paths resolve against `TEST_ORIGIN` (`http://localhost:8787`)
unless you pass an absolute URL.

### `session.logout()`
POST `/auth/logout` with the session's cookies. Revokes the refresh
chain; the access cookie's short TTL runs out naturally.

### `readLastVerifyToken(getNoopSentEmails)`
Peeks the noop email buffer's most recent `verify-email` and pulls the
token out of the URL. Callers wire it as a closure so the fixtures
package doesn't have to import from `apps/api`.

### `truncateTables(db, tables[])`
Empties the tables in the order given. **Order matters** — children
first (D1 has no FK cascade). Mirror `apps/api/src/dao/user-dao.ts#deleteUser`.

### `CSRF_HEADERS` + `TEST_ORIGIN`
The frozen `Record<string, string>` and origin string used everywhere.
Import when constructing anonymous requests (no session) that still
need CSRF headers — e.g. testing the auth surface itself.

## `pnpm dev:reset`

Wipes local Miniflare state, reapplies every migration, prints
credentials for a bootstrap admin.

### Safety rails

The script REFUSES to run unless `RUNWAY_LOCAL=1` is set. Second guard:
it rejects any db name containing `prod` or `preview`. Third guard: it
always passes `--local` to wrangler. Together these mean the script
cannot destroy remote data, even by accident.

```bash
RUNWAY_LOCAL=1 pnpm dev:reset
# → wipes .wrangler/state, applies all migrations, prints
#   curl commands to create the dev-admin user
```

After the reset:
1. `pnpm dev` in a separate terminal.
2. Use the printed curl to signup as `admin@runway.local` /
   `correct-horse-battery-staple`.
3. Verify the email (dev prints the token to server logs).
4. `pnpm db:seed:admin --email admin@runway.local --db runway_dev`.

## Extending the harness

Adding a product-specific factory:

```ts
// packages/test-fixtures/src/notes.ts
export async function createNote(
  session: RunwaySession,
  input: { title?: string; body?: string } = {},
): Promise<{ id: string }> {
  const res = await session.fetch("/demo/notes", {
    method: "POST",
    body: JSON.stringify({
      title: input.title ?? "test note",
      body: input.body ?? "…",
    }),
  });
  if (res.status !== 201) {
    throw new Error(`createNote: expected 201, got ${res.status}`);
  }
  return res.json();
}
```

Export it from `packages/test-fixtures/src/index.ts`. Every consumer
gets a first-class factory following the same pattern as `createMember`.

## Design notes

- **No back-reference to `apps/api`.** Fixtures are dependency-injected
  everywhere — the package can be dropped into a downstream product that
  reuses the same auth pipeline shape without changes.
- **Structural typing over drizzle imports.** `truncateTables` accepts
  `unknown[]` for tables so we don't need to peer-depend on drizzle-orm.
- **Session cookie handling is a class, not a helper.** `RunwaySession`
  hides the two-cookie + CSRF-header dance; every mutating call goes
  through `session.fetch` and stays right by construction.
- **Fixture drift is caught by `fixtures-smoke.test.ts`.** If a phase-1-3
  change breaks a fixture assumption, that smoke test fails before any
  consumer test does.

## References

- Code: `packages/test-fixtures/src/`
- Smoke test: `apps/api/test/integration/fixtures-smoke.test.ts`
- Migrated exemplars: `apps/api/test/integration/{rbac-flow,settings-flow}.test.ts`
- CLI: `scripts/dev-reset.ts`
