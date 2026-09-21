# @runway/client

Typed TypeScript client for the Runway API — generated from
`packages/contracts/dist/openapi.json`, with cookie-auth,
CSRF-header injection, and single-flight auto-refresh on 401.

Zero external runtime deps beyond `openapi-fetch` (~5KB gzipped).

## Install

Inside the monorepo:

```json
{
  "dependencies": {
    "@runway/client": "workspace:*"
  }
}
```

npm publishing is a v1.2 concern; today the client is workspace-only.

## Usage

```ts
import { createClient } from "@runway/client";

const runway = createClient({
  baseUrl: "https://api.runway.example",
  onUnauthorized: () => window.location.replace("/login"),
});

// Signup returns Result<{ user_id: string }>
const r = await runway.signup({
  email: "alice@example.com",
  password: "correct-horse-battery-staple",
});

if (!r.ok) {
  console.error(r.problem.title, r.problem.detail);
  return;
}
console.log("Created user:", r.data.user_id);
```

`Result<T>` is a discriminated union — TypeScript narrows to the
success branch after `if (!r.ok) return;`. No try/catch dance for
domain errors.

## Available operations

The typed wrapper covers the auth + `/me` surface directly:

- `signup({ email, password })`
- `verify({ token })`
- `login({ email, password })`
- `logout()`
- `refresh()`
- `me()`

For every other route in the OpenAPI spec, drop to the raw
`openapi-fetch` client exposed as `client.typed`:

```ts
const r = await runway.typed.GET("/admin/users", {
  params: { query: { limit: 20 } },
});
// r.data / r.error / r.response — see openapi-fetch docs
```

Adding a new named wrapper is 6 lines in `src/runtime/client.ts`.

## Auto-refresh (401 handling)

Every request that receives a 401 triggers **one** `POST /auth/refresh`
and retries the original call **once**. Concurrent 401s during the
same window share the refresh promise (single-flight) — the client
never storms the server with parallel refresh attempts.

Failure modes:

- Refresh itself 401s → the original 401 propagates and `onUnauthorized`
  fires once.
- Refresh succeeds but the retry 401s → `onUnauthorized` fires.

`onUnauthorized` is the extension point for "redirect to login" behavior.

## Cookies + CSRF

Browser callers get `credentials: "include"` on every request — the
API's `runway_at` + `runway_rt` cookies flow automatically for
same-site pages.

Mutating verbs (POST/PUT/PATCH/DELETE) get `Origin` + `X-Requested-With`
headers added — the API's `requireOrigin` + `requireFetchHeader`
middlewares reject requests missing either.

Node consumers can pass a custom `fetch` (e.g. `node-fetch` + a
`tough-cookie` jar) to handle cookie persistence server-side:

```ts
import fetch from "node-fetch";
import { CookieJar } from "tough-cookie";

const jar = new CookieJar();
const runway = createClient({
  baseUrl: "http://localhost:8787",
  fetch: async (url, init) => {
    const cookieHeader = await jar.getCookieString(url);
    const res = await fetch(url, {
      ...init,
      headers: { ...init?.headers, cookie: cookieHeader },
    });
    for (const c of res.headers.raw()["set-cookie"] ?? []) {
      await jar.setCookie(c, url);
    }
    return res;
  },
});
```

## Regeneration

The client's types come from `packages/contracts/dist/openapi.json`,
which itself is produced by the API's Zod schemas via
`@hono/zod-openapi`. To regenerate the client after changing a route:

```bash
pnpm openapi:export             # produces packages/contracts/dist/openapi.json
pnpm client:generate            # writes packages/client/src/generated/types.ts
git add packages/client/src/generated
```

CI runs `pnpm client:check` after build. If a PR modifies the API
without regenerating the client, that check fails with a clear message
telling you what to run locally.

## Migrating from raw fetch

Before:

```ts
const res = await fetch(`${BASE}/auth/signup`, {
  method: "POST",
  credentials: "include",
  headers: {
    "content-type": "application/json",
    origin: window.location.origin,
    "x-requested-with": "fetch",
  },
  body: JSON.stringify({ email, password }),
});
if (res.status === 409) {
  showConflict();
  return;
}
if (!res.ok) {
  showGenericError();
  return;
}
const { user_id } = await res.json();
```

After:

```ts
const r = await runway.signup({ email, password });
if (!r.ok) {
  r.problem.status === 409 ? showConflict() : showGenericError();
  return;
}
const { user_id } = r.data;
```

Half the code, twice the type-safety, one place to change when a
route's shape shifts.

## Design notes

- **Generator-swap safe.** The runtime `createClient` hides
  `openapi-fetch`'s API surface. Callers depend on `RunwayClient`,
  not on the generator. Swapping to a hand-rolled generator later
  wouldn't break consumers.
- **Contract vs implementation drift.** The OpenAPI spec is generated
  from the Zod schemas in `apps/api`, so client types match the
  handler declarations. If a handler behaves differently from its
  spec (rare), the client compiles fine but calls fail at runtime.
  Integration tests in `apps/api/test/` cover that gap.
- **Publishing story.** Workspace-only for v1.1. `changesets` + npm
  publish arrives with v1.2 alongside the first external consumer.

## References

- Runtime: `src/runtime/{client,result,auto-refresh}.ts`
- Errors: `src/errors.ts`
- Generated: `src/generated/types.ts` (do not edit)
- Scripts: `scripts/generate.ts`, `scripts/check-drift.ts`
- Tests: `test/{result,auto-refresh,generated}.test.ts`
