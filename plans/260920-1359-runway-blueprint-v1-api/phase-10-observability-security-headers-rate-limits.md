---
title: "Phase 10: Observability, Security Headers & Rate Limits"
status: todo
---

# Phase 10: Observability, Security Headers & Rate Limits

## Overview

Harden the runtime. **Sentry via `@sentry/cloudflare`** (Red Team F12: toucan-js abandoned) behind `ErrorReporterPort` — no-op when `SENTRY_DSN` unset. **PII scrubber shared with `logger.audit` from P9** — recursive walker over full event bodies (breadcrumbs, exception values, contexts) applied to Sentry's `beforeSend`. Structured request logging with `x-request-id` piped to Cloudflare Logpush. **`/healthz` split into two endpoints (Red Team F6):** `/healthz` shallow public (no external calls) for load balancers; `/readyz` deep (D1 + KV + schema-head check), gated by shared-secret header, rate-limited. **Rate Limiting API via GA `[[ratelimits]]` binding** (Red Team F2) with valid `period` values (10 or 60 only). Security headers on every response. `/docs` and `/openapi.json` disabled in production. **`jti` revocation cleanup Cron** prunes expired revocations nightly.

## Requirements

- Functional
  - [ ] `ErrorReporterPort.capture(err, ctx)` no-ops when DSN missing; sends to Sentry when set
  - [ ] Every unhandled error captured with `request_id`, `principal_id` (if any), URL, method
  - [ ] Every request logged with `{request_id, method, path, status, duration_ms, principal_id?}` as JSON to console → Logpush
  - [ ] `/healthz` returns 200 `{ok, buildSha}` — SHALLOW; no D1/KV calls; public; ~1ms
  - [ ] `/readyz` returns 200 `{ok, buildSha, checks: {db, kv, schema_head_match}}` — DEEP; gated by `X-Readyz-Token` header matching `env.READYZ_TOKEN` (Cloudflare Load Balancer/uptime pings inject this); rate-limited via `RL_READYZ` (60/min)
  - [ ] Rate limiter returns 429 problem+json with `Retry-After` header on exhaustion; SYNC audit event `auth.login.rate_limited` on `/auth/login` breach
  - [ ] All responses include security headers
  - [ ] `/docs` and `/openapi.json` return 404 in production
  - [ ] **Cron trigger** (`0 3 * * *`) prunes `jwt_revocations WHERE expires_at < now()` and idempotency_keys WHERE expires_at < now()
- Non-functional
  - [ ] Log line kept under 4KB (Logpush limit)
  - [ ] No PII in logs by default: uses same `deepScrub` from P9 for logger + Sentry
  - [ ] Sentry `beforeSend` recursively scrubs full event body incl. `breadcrumbs`, `exception.values[].value`, `contexts`
  - [ ] Rate limits sourced from `env.RATE_LIMIT_*` (Zod-parsed at boot, from Phase 8's env-based rate-limit resolution)
  - [ ] Sentry auto-`fetch`-breadcrumbs disabled to prevent leaking outbound provider bearer tokens (Resend, etc.)

## Architecture

```
apps/api/src/
├── ports/
│   └── error-reporter-port.ts
├── adapters/
│   ├── sentry-reporter.ts       # @sentry/cloudflare wrapper
│   └── noop-reporter.ts
├── middleware/
│   ├── logger.ts                # (from P4, now filled with structured JSON; imports deepScrub from P9)
│   ├── security-headers.ts
│   └── rate-limit.ts            # factory: rateLimit({binding, key})
├── routes/
│   └── health.routes.ts         # /healthz shallow + /readyz deep
└── crons/
    └── jti-revocation-pruner.ts # scheduled handler
```

**Sentry adapter (`@sentry/cloudflare`):**

```ts
import * as Sentry from '@sentry/cloudflare';

export function createSentry(env: Env): ErrorReporterPort {
  if (!env.SENTRY_DSN) return NoopReporter;
  const client = Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    release: env.BUILD_SHA,
    tracesSampleRate: 0.1,
    // Disable auto-fetch breadcrumbs to avoid leaking outbound provider tokens
    integrations: (defaults) => defaults.filter((i) => i.name !== 'Fetch'),
    beforeSend: (event) => deepScrub(event),  // shared with logger.audit
    beforeBreadcrumb: (crumb) => deepScrub(crumb),
  });
  return new SentryReporter(client);
}
```

**Security headers (applied on every response):**

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()
Cross-Origin-Opener-Policy: same-origin
```

**Rate limit bindings (wrangler.toml — GA syntax, valid periods):**

```toml
[[ratelimits]]
name = "RL_AUTH_LOGIN"
namespace_id = "1001"
simple = { limit = 5, period = 60 }        # 5/min per key

[[ratelimits]]
name = "RL_AUTH_SIGNUP"
namespace_id = "1002"
simple = { limit = 3, period = 60 }        # 3/min per IP  (was invalid period=300)

[[ratelimits]]
name = "RL_AUTH_VERIFY"
namespace_id = "1003"
simple = { limit = 10, period = 60 }       # 10/min per IP

[[ratelimits]]
name = "RL_AUTH_REFRESH"
namespace_id = "1004"
simple = { limit = 30, period = 60 }       # 30/min per user

[[ratelimits]]
name = "RL_READYZ"
namespace_id = "1005"
simple = { limit = 60, period = 60 }       # 60/min per IP
```

**Values reference `env.RATE_LIMIT_*` when Cloudflare eventually supports dynamic limits.** For v1, they are STATIC per deploy — changing requires a re-deploy. This resolves the Settings-vs-binding dual-source-of-truth ambiguity (Red Team F10 sub-finding): rate-limit thresholds live in env only, not in Settings.

Rate keys:

- `RL_AUTH_LOGIN`: `login:${normalizedEmail}:${ip}` (compound to defeat both single-account and single-IP attackers)
- `RL_AUTH_SIGNUP`: `signup:${ip}`
- `RL_AUTH_VERIFY`: `verify:${ip}`
- `RL_AUTH_REFRESH`: `refresh:${userId}`
- `RL_READYZ`: `readyz:${ip}`

**`/healthz` shallow (no external calls, public, safe for LB probes):**

```json
{ "ok": true, "buildSha": "01H..." }
```

**`/readyz` deep (requires `X-Readyz-Token: <READYZ_TOKEN>`, rate-limited):**

```json
{
  "ok": true,
  "buildSha": "01H...",
  "checks": { "db": "ok", "kv": "ok", "schema_head_match": "ok" },
  "durationMs": 14
}
```

Deep check wraps every dependency call in `Promise.race([call, timeout(200ms)])` so a stuck KV doesn't hang the endpoint.

## Related Code Files

- Create: `apps/api/src/ports/error-reporter-port.ts`
- Create: `apps/api/src/adapters/{sentry-reporter,noop-reporter}.ts`
- Create: `apps/api/src/middleware/{security-headers,rate-limit}.ts`
- Create: `apps/api/src/crons/jti-revocation-pruner.ts`
- Fill: `apps/api/src/middleware/logger.ts` (structured JSON with request_id; imports `deepScrub` from P9)
- Move: `/healthz` from `index.ts` to `apps/api/src/routes/health.routes.ts` (split into shallow + deep)
- Modify: `apps/api/src/index.ts` — install security-headers globally; rate-limit on relevant routes; wire error reporter into global error handler; register cron handler
- Modify: `apps/api/wrangler.toml` — `[[ratelimits]]` bindings (GA syntax); add cron `0 3 * * *` to existing `[triggers] crons` list; Logpush destination is user-owned, documented
- Modify: `apps/api/src/env.ts` — Zod-parse `SENTRY_DSN?`, `APP_ENV`, `BUILD_SHA`, `READYZ_TOKEN`, all `RATE_LIMIT_*`
- Modify: `.dev.vars.example` — `SENTRY_DSN=`, `APP_ENV=development`, `BUILD_SHA=dev`, `READYZ_TOKEN=dev-token`
- Modify: `.github/workflows/deploy.yml` — inject `BUILD_SHA=${{ github.sha }}` as var
- Install: `@sentry/cloudflare`

## Implementation Steps

1. **TDD ErrorReporterPort:**
   - Failing test: with no DSN → capture is no-op; with DSN → captures via mock transport
   - Failing test: PII scrubbing: nested `password` in event.contexts, `Authorization` in breadcrumb, JWT in URL query — all scrubbed via `deepScrub`
   - Implement Noop + Sentry adapters with `@sentry/cloudflare`
2. **Wire error handler (P4)** to call `reporter.capture` before returning 500
3. **Logger middleware:** structured JSON with `request_id`, `method`, `path`, `status`, `duration_ms`, `principal_id`; passes payload through `deepScrub` before `console.log`
4. **Security headers middleware:** constant map; unit test asserts each header present on every response
5. **Rate limit factory:**
   - `rateLimit({binding: 'RL_AUTH_LOGIN', keyFn: (c) => \`login:${normalizeEmail(email)}:${ip}\`})`
   - On block: 429 problem+json with `Retry-After` from binding response
   - For `/auth/login` specifically, on block → SYNC audit `auth.login.rate_limited`
   - Wire on `/auth/*` routes AND `/readyz`
6. **`/healthz` shallow:** returns constant JSON; no D1/KV calls
7. **`/readyz` deep:**
   - Gate: check `X-Readyz-Token` header vs `env.READYZ_TOKEN`; missing/mismatch → 401 problem+json
   - Rate-limited via `RL_READYZ`
   - D1 `SELECT 1`, KV get, schema_head comparison — each wrapped in `Promise.race` with 200ms timeout
   - Return `checks` map; 503 if any fails
8. **Cron pruner** (`jti-revocation-pruner.ts`): `DELETE FROM jwt_revocations WHERE expires_at < ?`; also `DELETE FROM idempotency_keys WHERE expires_at < ?`. Wired via wrangler `[triggers] crons`.
9. **Production guards:**
   - `/docs` and `/openapi.json` conditionally mounted only if `env.APP_ENV !== 'production'`
   - Integration test asserts production build hides these
10. **Integration tests:**
    - 6 rapid `POST /auth/login` from same IP → 6th returns 429 with `Retry-After` + audit event fired
    - Force handler to throw → error reporter called; response is 500 problem+json without stack
    - `curl /healthz` returns shallow JSON in <10ms
    - `curl /readyz` without token → 401
    - `curl -H "X-Readyz-Token: dev-token" /readyz` returns full check map
    - Kill D1 (via env override) → `/readyz` returns 503
    - PII scrub test: force a ZodError containing password → assert Sentry event body does NOT contain the password value
11. **Docs:** `docs/observability.md` — Sentry setup, Logpush destination, healthz vs readyz semantics, rate limit tuning, READYZ_TOKEN rotation

## Todo

- [ ] `@sentry/cloudflare` adapter with no-op fallback
- [ ] Sentry `beforeSend` + `beforeBreadcrumb` use shared `deepScrub`; auto-fetch breadcrumbs disabled
- [ ] Logger emits structured JSON with request_id and deepScrub-applied payload
- [ ] Security headers applied on every response (unit test verifies each)
- [ ] Rate limit factory + GA `[[ratelimits]]` bindings in wrangler.toml with valid periods
- [ ] All 5 rate-limit bindings declared: LOGIN, SIGNUP, VERIFY, REFRESH, READYZ
- [ ] `/healthz` shallow + `/readyz` deep with token gate
- [ ] `/docs` and `/openapi.json` disabled in prod (verified)
- [ ] PII scrubber shared between logger.audit (P9) and Sentry adapter
- [ ] Rate-limit thresholds sourced from env (Zod-parsed); no Settings coupling
- [ ] Cron pruner for jwt_revocations + idempotency_keys wired + tested
- [ ] `auth.login.rate_limited` SYNC audit event on 429

## Success Criteria

- [ ] Bruno test: force login 6× → 429 + sync audit
- [ ] `curl -I /` shows all security headers
- [ ] Force error with password in ZodError → Sentry mock receives event; assert no password string appears anywhere in serialized event
- [ ] `curl /healthz` returns ~1ms shallow response (no D1/KV)
- [ ] `curl -H X-Readyz-Token /readyz` returns `checks.db=ok`; without token → 401
- [ ] `curl /readyz` 61× → 61st returns 429
- [ ] Kill D1 (via env override) → `/readyz` returns 503
- [ ] Production build: `curl /docs` → 404; `curl /openapi.json` → 404
- [ ] Cron pruner: pre-seed 100 expired jti rows → invoke scheduled handler → all deleted

## Risk Assessment

- **`@sentry/cloudflare` breaking changes:** Actively maintained; pin exact version; smoke test on upgrade.
- **Sentry integrations shape:** The API for disabling `Fetch` integration differs from toucan-js. Verify in a test that outbound provider tokens (e.g., Resend Bearer) are NOT in captured breadcrumbs.
- **Log volume via Logpush costs:** Non-error logs may need sampling post-launch. Documented.
- **Rate limit binding is GA:** No longer beta. If future Cloudflare deprecation lands, wrap behind an adapter interface so we can swap to KV-based token bucket.
- **`/readyz` shared-secret rotation:** Rotating `READYZ_TOKEN` breaks probes until rotated on the probe side too. Runbook in `docs/observability.md`.
- **Cron overlap on long DB deletes:** Cron may fire before previous run finishes if pruning >5 min. Not expected for expected volumes; safeguard with a `CREATE INDEX ... expires_at` (Phase 3) + `LIMIT 10000` in delete + iterate.
- **Rate limit key normalization on email:** Lowercase + trim to prevent `alice@foo.com` vs `Alice@foo.com` bypassing per-account throttle.
