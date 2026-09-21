---
phase: 5
title: "Generated Typed Client from OpenAPI"
status: pending
priority: P2
effort: "1-2d"
dependencies: [1, 2, 3]
---

# Phase 5: Generated Typed Client from OpenAPI

## Overview

Finish the OpenAPI loop. v1.0 ships `packages/contracts` with a
generated `openapi.json` and a `pnpm openapi:diff` breaking-change
check. What's missing: a typed TypeScript client so consumers get
compile-time API integration without duplicating Zod types.

Ship `@runway/client`: a thin fetch wrapper with named functions per
route, correct request/response types, typed Problem+JSON errors,
and a cookie-auth model matching the blueprint's session shape.
Generated from `openapi.json`; regeneration is a CI-gated step so the
client can't silently drift from the spec.

## Requirements

- Functional
  - `@runway/client` exports one function per API route, named after
    the OpenAPI `operationId` (auto-generated as
    `signup`, `verify`, `login`, `me`, `adminListUsers`,
    `demoCreateNote`, `readyz`, etc.).
  - Each function takes typed input (params + body) and returns
    `Result<Success, Problem>` — never throws for well-formed
    server responses; caller pattern-matches on `result.ok`.
  - Cookie handling: works in browser (cookies from document.cookie
    if same-origin) and in Node (opt-in `cookieJar` param). CSRF
    headers auto-added on mutating verbs.
  - Auto-refresh: on a 401 from `/me` (or any authenticated route),
    the client calls `/auth/refresh` once and retries the original
    request. If refresh fails, propagate the 401.
  - `client.on('unauthorized', handler)` lets the consumer redirect
    to login when refresh fails.
- Non-functional
  - Zero external runtime deps. Only `fetch`.
  - Bundle-size gated: <10KB gzipped for the whole client (excluding
    the `openapi.json` schema).
  - CI check: `pnpm client:check` regenerates the client and diffs
    against the committed copy. Non-zero exit if drift.
  - Uses `openapi-typescript` (dev-only) to generate the types +
    `openapi-fetch` runtime, or a hand-rolled tiny generator. Decide
    per prototype spike in step 1.
  - Published as a workspace package for now (`workspace:*` from a
    consumer app in the same monorepo). Publish-to-npm is a v1.2
    concern.

## Architecture

```
packages/client/
├── package.json               # @runway/client
├── src/
│   ├── index.ts               # public API: createClient, types
│   ├── generated/             # AUTO-GENERATED — do not hand-edit
│   │   ├── types.ts           # openapi-typescript output
│   │   └── operations.ts      # per-operation typed wrappers
│   ├── runtime/
│   │   ├── client.ts          # createClient({ baseUrl, fetch?, cookieJar? })
│   │   ├── result.ts          # Result<T, Problem> discriminated union
│   │   ├── auto-refresh.ts    # 401 → /auth/refresh → retry once
│   │   └── cookies.ts         # cookie-jar for Node consumers
│   └── errors.ts              # ClientError, NetworkError, TimeoutError
├── test/
│   ├── generated.test.ts      # snapshot: types match openapi.json shape
│   ├── auto-refresh.test.ts
│   └── result.test.ts
├── scripts/
│   └── generate.ts            # regenerates src/generated/*
└── tsconfig.json
```

Generation flow:

```
pnpm openapi:export           (already exists) → openapi.json in packages/contracts/dist
pnpm --filter @runway/client generate
  → scripts/generate.ts:
     1. read packages/contracts/dist/openapi.json
     2. run openapi-typescript → types.ts
     3. walk paths, generate operations.ts wrappers per operationId
     4. format via prettier (already available in workspace)
```

CI check (`.github/workflows/ci.yml` extension):

```
- pnpm openapi:export
- pnpm --filter @runway/client generate
- git diff --exit-code packages/client/src/generated
  # non-zero if generated files drifted from committed
```

Consumer usage:

```ts
import { createClient } from '@runway/client';

const runway = createClient({ baseUrl: 'https://api.example.com' });

const result = await runway.signup({
  email: 'alice@x.com',
  password: 'correct-horse-battery-staple',
});

if (!result.ok) {
  // result.problem: Problem+JSON typed
  console.error(result.problem.title);
  return;
}
console.log(result.data.user_id);
```

Auto-refresh:

```ts
const runway = createClient({
  baseUrl: '...',
  onUnauthorized: () => window.location.replace('/login'),
});

// If /me returns 401, client tries /auth/refresh once.
// If refresh works, retries /me.
// If refresh also 401s, onUnauthorized fires.
const me = await runway.me();
```

## Related Code Files

- Create: `packages/client/{package.json, tsconfig.json, vitest.config.ts}`
- Create: `packages/client/src/{index,errors}.ts`
- Create: `packages/client/src/runtime/{client,result,auto-refresh,cookies}.ts`
- Create: `packages/client/src/generated/{types,operations}.ts` (auto-generated; committed)
- Create: `packages/client/scripts/generate.ts`
- Create: `packages/client/test/{generated,auto-refresh,result}.test.ts`
- Create: `packages/client/README.md` (usage + regeneration + migration
  from raw fetch)
- Modify: root `package.json` — add `client:generate` + `client:check`
  scripts
- Modify: `.github/workflows/ci.yml` — add drift-check step
- Modify: `packages/contracts/package.json` — ensure `openapi.json` is a
  workspace-consumable path

## Implementation Steps

1. Spike: prototype the generator. Two candidates:
   - **`openapi-typescript` + `openapi-fetch`** — established, minimal
     custom code, ~5KB runtime.
   - **Hand-rolled generator** — full control, zero external deps.
   Time-box to 2h. Pick whichever produces cleaner output on our
   `openapi.json`.
2. Scaffold `packages/client/` with the chosen approach.
3. Write `runtime/result.ts` — `Result<T, Problem>` discriminated
   union. Every operation wrapper returns this.
4. Write `runtime/client.ts` — `createClient({ baseUrl, fetch?, ... })`
   returns an object with methods per operation. Wire cookies + CSRF
   headers per mutating verb.
5. Write `runtime/auto-refresh.ts` — wraps every authenticated call
   in a `try → 401 → refresh → retry once` pattern. Single-flight
   refresh (concurrent 401s share one refresh promise).
6. Write `scripts/generate.ts` — reads spec, invokes the generator,
   writes to `src/generated/*`. Idempotent.
7. Commit the generated files. CI drift-check keeps them fresh.
8. Write tests:
   - `generated.test.ts` — pins the shape of the generated types
     against a manually-typed control (catches shape regressions from
     the generator).
   - `auto-refresh.test.ts` — mocks a 401 → 200 flow via a fetch
     substitute; asserts single retry, single refresh call.
   - `result.test.ts` — pattern-match discipline.
9. Write `README.md`: install (workspace or npm), usage, auto-refresh
   contract, cookie model, migrating a consumer from raw fetch.
10. Wire CI drift-check into `.github/workflows/ci.yml`.

## Success Criteria

- [ ] `createClient({ baseUrl })` returns typed methods for every
      route in `openapi.json`
- [ ] Adding a new route to the OpenAPI spec + running `pnpm
      client:generate` produces a new method with no manual edits
- [ ] `result.ok` discriminant works (TS narrows correctly on `if
      (!result.ok)`)
- [ ] Auto-refresh proven: mock 401 → single /auth/refresh call →
      retry → 200
- [ ] Concurrent 401s during a single refresh share the refresh
      (single-flight test)
- [ ] `pnpm client:check` fails when a route is added without
      regeneration (CI proof)
- [ ] Bundle-size: `@runway/client` gzip <10KB (excluding
      openapi.json schema)
- [ ] `packages/client/README.md` shows a copy-paste consumer example

## Risk Assessment

- **Generator lock-in**: If we pick `openapi-typescript` and later
  want to switch, the runtime API surface changes. Mitigation: the
  runtime wrapper (`createClient`) hides the generator's shape;
  swap generators without breaking consumers.
- **CI drift-check false positives**: If prettier config changes,
  the generated output shifts and CI fails. Mitigation: pin
  prettier version + include prettier check in the generation script.
- **Cookie model complexity**: Browser vs Node have different
  cookie APIs. Mitigation: Node consumers pass a `cookieJar`
  explicitly; browser consumers rely on `credentials: 'include'`
  and same-origin defaults. Documented.
- **Auto-refresh loops**: A misconfigured server that always 401s
  could trigger an infinite refresh loop. Mitigation: retry-once
  cap; `onUnauthorized` fires after the second consecutive 401.
- **Contract vs implementation drift**: OpenAPI spec is generated
  from Zod schemas, so client types match. If a route handler
  behaves differently from its spec (rare), the client will
  compile against the spec but fail at runtime. Mitigation:
  integration tests already cover the server contract; the client
  is a mirror, not a source of truth.
- **Publishing story**: v1.1 keeps this as a workspace package.
  Publishing to npm requires a separate release pipeline
  (versioning, changesets). Documented as a v1.2 concern.
