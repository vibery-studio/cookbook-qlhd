---
title: "Phase 4: OpenAPI Contract & Hono Route Skeleton"
status: in-progress
---

# Phase 4: OpenAPI Contract & Hono Route Skeleton

## Overview

Wire `@hono/zod-openapi`, define the app-wide response shape (Problem+JSON errors), scaffold all route groups (`/auth`, `/me`, `/admin`, `/demo`), and set up the OpenAPI 3.1 spec generation pipeline. Because routes are DEFINED through the OpenAPI DSL, a spec-vs-code "parity" test is tautological (Red Team F13) — dropped. Drift detection uses `oasdiff` against the spec from `main` fetched at CI time; spec is **NOT committed** to the repo (`packages/contracts/dist/openapi.json` is gitignored; generated in CI). Zod global error map strips `received` values so Sentry cannot leak submitted passwords via Zod issues (Red Team F9 fold-in). No handler logic yet — routes return 501 Not Implemented; later phases fill them in.

## Requirements

- Functional
  - [ ] All routes declared with Zod schemas for path, query, headers, body, responses
  - [ ] Global error handler emits Problem+JSON (RFC 7807) with `type`, `title`, `status`, `detail`, `instance`, `errors[]` for validation failures
  - [ ] **Zod global error map** (`z.setErrorMap`) strips the `received` field from every issue before it reaches error handler / Sentry
  - [ ] `GET /openapi.json` serves the live spec
  - [ ] `GET /docs` serves Swagger UI (dev/preview only, disabled in prod via env)
  - [ ] Spec generated in CI (NOT committed); `oasdiff` compares HEAD spec against `main` branch spec (fetched via `git fetch origin main`) — fails CI on breaking changes
  - [ ] Build outputs `packages/contracts/dist/openapi.json` for local dev convenience; `.gitignore` excludes it
- Non-functional
  - [ ] Every response schema has a Zod validator; no `z.any()` in public shapes
  - [ ] Error envelope is uniform across every route
  - [ ] Zod error output never contains raw request field values (`received`)

## Architecture

```
apps/api/src/
├── index.ts                        # app bootstrap, mounts routes, error handler
├── routes/
│   ├── auth.routes.ts              # POST /auth/signup, /verify, /login, /logout, /refresh
│   ├── me.routes.ts                # GET /me
│   ├── admin.routes.ts             # GET /admin/users, PUT /admin/settings/:key
│   └── demo.routes.ts              # POST /demo/notes (idempotency demo)
├── middleware/
│   ├── request-id.ts               # x-request-id in + out
│   ├── error-handler.ts            # Problem+JSON
│   └── logger.ts                   # structured log with request-id
├── dto/                            # shared Zod schemas
│   ├── error.ts                    # ProblemDto
│   ├── pagination.ts
│   └── common.ts
└── openapi.ts                      # OpenAPIHono instance + doc metadata

packages/contracts/
├── src/
│   ├── index.ts                    # re-exports Zod schemas usable by future SPA
│   └── openapi.json                # generated on build (checked in? see risk)
├── package.json
└── tsconfig.json
```

**Problem+JSON envelope example:**

```json
{
  "type": "https://runway.dev/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request body did not match the expected schema",
  "instance": "/auth/signup",
  "request_id": "01HXYZ...",
  "errors": [{ "path": "email", "message": "invalid email" }]
}
```

**Success envelope:** Return the resource directly (no wrapper); pagination uses `Link` header + `X-Total-Count`. Keep API narrow — envelopes are for errors only.

## Related Code Files

- Create: `apps/api/src/openapi.ts`
- Create: `apps/api/src/routes/{auth,me,admin,demo}.routes.ts` (all handlers return 501)
- Create: `apps/api/src/middleware/{request-id,error-handler,logger}.ts`
- Create: `apps/api/src/dto/{error,pagination,common}.ts`
- Create: `apps/api/src/zod-error-map.ts` (`z.setErrorMap` — strips `received` from every issue)
- Create: `packages/contracts/src/index.ts` re-exporting shared DTOs
- Modify: `apps/api/src/index.ts` to wire OpenAPIHono, mount routes, install middleware, install zod error map
- Modify: `packages/config/vitest.base.ts` to add integration test path
- Create: `scripts/export-openapi.ts` (build/CI: writes `packages/contracts/dist/openapi.json` — gitignored)
- Create: `scripts/openapi-diff.ts` (CI-only: `git fetch origin main`, run export against both refs, compare via `oasdiff`)
- Modify: `.github/workflows/ci.yml` to run `openapi:diff`
- Modify: `.gitignore` to exclude `packages/contracts/dist/`

## Implementation Steps

1. Install `@hono/zod-openapi`, `@hono/swagger-ui`, `zod`, and the `oasdiff` binary via GH action (`Tufin/oasdiff-action`)
2. Create `openapi.ts`: `new OpenAPIHono()` with `info` (title=Runway API, version from package.json)
3. Define `ProblemDto` Zod schema in `dto/error.ts`; register as reusable component
4. Write `zod-error-map.ts`: `z.setErrorMap` returns an object with `message` only — never emits `received`, `expected` string values that quote input. Unit test with a synthetic ZodError from `password.parse('hunter2')` → assert output does NOT contain the string `hunter2`
5. Write `middleware/request-id.ts` (generate ULID if missing, echo back)
6. Write `middleware/error-handler.ts`: catches ZodError → 422 problem (uses scrubbed error map output); HttpException → problem; unknown → 500 problem (no stack in prod)
7. Scaffold route files. Each route:
   - Zod schemas for request + response
   - Handler returns 501 with problem body `type=/errors/not-implemented`
8. Mount routes in `index.ts`; install `zod-error-map` at boot; expose `/openapi.json` and `/docs` (Swagger UI)
9. Add `[env].production` conditional to disable `/docs` and `/openapi.json` in prod
10. Write `scripts/export-openapi.ts` — imports app, calls `getOpenAPIDocument`, writes to `packages/contracts/dist/openapi.json` (gitignored)
11. Wire `pnpm build` to run export as a post-step (local dev convenience only)
12. Write `scripts/openapi-diff.ts`: in CI, `git fetch origin main`, `git worktree add /tmp/main-openapi origin/main`, run `pnpm --dir /tmp/main-openapi build` to produce main's spec, then run `oasdiff breaking main.json head.json` — exit 1 on breaking changes
13. Add `openapi:diff` step to `ci.yml`
14. `.gitignore` excludes `packages/contracts/dist/`
15. **Removed:** tautological "spec ↔ code parity" test. Route registration is the spec; there is no separate SSOT to compare against.

## Todo

- [ ] OpenAPIHono wired with metadata
- [ ] Zod global error map installed; unit-tested to strip `received`
- [ ] Global middleware stack (request-id, error, logger) installed in correct order
- [ ] Problem+JSON schema registered as reusable component
- [ ] All v1 route stubs declared (501 handlers)
- [ ] `/openapi.json` + `/docs` served (non-prod only)
- [ ] Spec exported to `packages/contracts/dist/openapi.json` on build (local convenience)
- [ ] `.gitignore` excludes `packages/contracts/dist/`
- [ ] `openapi:diff` runs in CI against `origin/main` and blocks breaking changes

## Success Criteria

- [ ] `curl /openapi.json` (in dev/preview) returns valid OpenAPI 3.1 JSON
- [ ] `curl /openapi.json` in prod → 404
- [ ] Zod validation with sensitive field value fails safely: response body + Sentry event contain NO submitted value
- [ ] Malformed request body → 422 problem+json with field-level errors (no `received` leakage)
- [ ] Synthetic breaking PR (rename response field on `/me`) causes `openapi:diff` to fail CI
- [ ] `git status` after `pnpm build` shows no changes to `packages/contracts/dist/`

## Risk Assessment

- **Spec drift vs `main` fetch:** `origin/main` must be reachable in CI. GitHub Actions default checkout fetches shallow; use `fetch-depth: 0` or `git fetch --deepen`. Document in `docs/ci.md`.
- **Swagger UI + `/openapi.json` in prod:** Both disabled via env check (`env.APP_ENV === 'production'`). Integration test asserts prod 404.
- **@hono/zod-openapi version drift:** Pin exact version; smoke test on upgrade.
- **`oasdiff` false positives on additive-only changes:** Use `oasdiff breaking` (not `oasdiff diff`) to focus on breaking changes only; document semver policy in `docs/openapi.md`.
- **Cross-build determinism:** Building `main`'s spec inside CI requires reproducible builds. Use `pnpm install --frozen-lockfile` and pinned deps in `packages/contracts` chain.
