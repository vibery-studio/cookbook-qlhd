# Observability (Phase 10)

Structured logs to Logpush, error reporting via `ErrorReporterPort`,
security headers on every response, GA rate limits on auth
endpoints, split health probes, and a nightly cron pruner. This
doc describes what ships and how to operate it.

## Logs

All runtime output goes through `console.log` / `console.error`.
Cloudflare Logpush ingests stdout+stderr and ships to your
destination.

**Line kinds** (`kind` field in the JSON payload):

- `request` — one line per HTTP request via
  `middleware/logger.ts`. Fields: `request_id`, `method`, `path`,
  `status`, `duration_ms`, `principal_id?`. Runs through
  `deepScrub` defensively.
- `audit` — emitted by `createAuditLogger` in
  `observability/logger.ts`. Sync + async modes documented in
  `docs/audit.md`.
- `email.send.noop`, `email.send.dlq`, `email.sweeper.tick`, etc.
  — email pipeline events (docs/email.md).
- `error.noop_reporter` / `error.sentry_scaffold` — errors
  captured through the reporter port when a real Sentry HOC is
  not wired.
- `cron.pruner.tick` — nightly cleanup pass reports rows deleted
  from `jwt_revocations` + `idempotency_keys`.

## Logpush setup

Blueprint does not provision destinations. Bring your own R2 bucket
or SIEM.

1. Create destination (R2, Datadog, Splunk, S3).
2. Cloudflare dashboard → **Analytics & Logs → Logpush → Create
   job**. Dataset: `workers_trace_events`. Optionally filter
   `ScriptName` to only the runway worker.
3. Choose fields: `Message` (carries `console.log`), `EventTimestamp`,
   `ScriptName`, `Outcome`.
4. Point at destination + set batch cadence (5min → R2, 30s →
   SIEM).

Filter inside your destination on `kind == "audit"` to isolate
audit events; on `kind == "request"` for request logs; on
`error.*` prefix for the error-path lines.

## Error reporter

`ports/error-reporter-port.ts` declares the shape. Selection:

- `SENTRY_DSN` unset → `adapters/noop-reporter.ts` emits a
  structured `console.error` line. Every error still lands in
  Logpush; there's no silent drop.
- `SENTRY_DSN` set → `adapters/sentry-reporter.ts` emits a
  `sentry-scaffold` line telling the operator the DSN is present
  but the `withSentry` HOC wiring (introduced in
  `@sentry/cloudflare@10.x`) is not yet installed. Real Sentry
  ingestion lands in a follow-up.

Both paths run every unhandled error through `deepScrub` (shared
with `logger.audit`) via the reporter's structured payload, so no
`password`/`token`/`authorization` value leaks into logs.

**Real Sentry integration recipe** (v1.1):

1. Wrap the worker default export with
   `withSentry((env) => Sentry.init({dsn: env.SENTRY_DSN, ...}))`.
2. Move `beforeSend` + `beforeBreadcrumb` scrubbing into the
   `init` options.
3. Disable the `Fetch` integration to prevent leaking outbound
   provider tokens (Resend, etc.) into breadcrumbs.
4. Replace the `sentry-scaffold` capture with `Sentry.captureException`.

## Security headers

Applied globally in `middleware/security-headers.ts` on every
response including error paths. Fixed values:

| Header | Value |
|--------|-------|
| `strict-transport-security` | `max-age=31536000; includeSubDomains; preload` |
| `content-security-policy` | `default-src 'self'; frame-ancestors 'none'; base-uri 'self'` |
| `x-content-type-options` | `nosniff` |
| `x-frame-options` | `DENY` |
| `referrer-policy` | `strict-origin-when-cross-origin` |
| `permissions-policy` | `accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()` |
| `cross-origin-opener-policy` | `same-origin` |

Once an SPA / third-party is served, tighten `content-security-policy`
to a specific origin allowlist rather than `'self'`.

## Rate limits

Cloudflare's GA `[[ratelimits]]` binding. Five buckets:

| Binding | Limit | Key | Purpose |
|---------|-------|-----|---------|
| `RL_AUTH_LOGIN` | 5/min | `login:<lowercase-email>:<ip>` | Login stuffing |
| `RL_AUTH_SIGNUP` | 3/min | `signup:<ip>` | Signup spam |
| `RL_AUTH_VERIFY` | 10/min | `verify:<ip>` | Token brute-force |
| `RL_AUTH_REFRESH` | 30/min | `refresh:<ip>` | Refresh-cycling |
| `RL_READYZ` | 60/min | `readyz:<ip>` | Probe abuse |

On denial: 429 Problem+JSON (`type=/errors/rate-limited`) with
`Retry-After: 60`. Login denials fire a SYNC audit event
`auth.login.rate_limited` (per docs/audit.md).

**Development bypass**: `middleware/rate-limit.ts` returns early
when `env.APP_ENV === "development"`. The limits still exist in
the wrangler config (so preview + prod deploy identically) but
local iteration + integration tests don't trip them.

Thresholds are ENV-time (wrangler.toml constants). Changing them
requires a redeploy — this is by design; runtime-mutable auth
thresholds would let an operator lock users out mid-request.

## Health probes

- **`/healthz`** — shallow, public, no external calls.
  `{ok, build_sha}`. Suitable for LB liveness probes. Not
  rate-limited (broken probe must not lock out healthy probes).
- **`/readyz`** — deep. Requires `X-Readyz-Token: <READYZ_TOKEN>`
  matching the env-configured token. Rate-limited via
  `RL_READYZ`. D1 `SELECT 1` + KV probe, each wrapped in
  `Promise.race(200ms)`. Returns 200 with a `checks` map when
  everything is ok; 503 when any check fails; 401 without the
  token.

Rotate `READYZ_TOKEN` via `wrangler secret put` in each env.
Update the probe caller (Cloudflare Load Balancer, uptime service)
to send the new token *before* rotating the server secret to avoid
a rotation-window outage.

## Cron jobs

Two crons registered in wrangler.toml `[triggers]`:

| Schedule | Handler | Purpose |
|----------|---------|---------|
| `*/5 * * * *` | `verifyEmailSweeper` | Re-send verify emails for pending users >15min old (docs/email.md) |
| `0 3 * * *` | `pruneExpiredRows` | Delete expired `jwt_revocations` + `idempotency_keys` rows |

Dispatch happens in `index.ts:scheduled()` by matching
`event.cron` — new crons must be added to the dispatch table.
Both handlers use `ctx.waitUntil` so the scheduled invocation
returns as soon as work is queued; the runtime keeps the isolate
alive until the work resolves.

## What NOT to log

- Request bodies (idempotency middleware buffers them for hashing
  but doesn't log).
- Cookies / auth headers.
- Anything user-typed until it's been through `deepScrub` OR
  it's a fixed structural field (email address in `audit` events
  is intentional; the address is the actor identity).

If you're logging a variable and you're not sure whether it can
carry secrets, wrap it in `deepScrub(payload)` before
`JSON.stringify`.

## Runbook: reading Logpush

Typical incident triage query (destination-agnostic pseudocode):

```
kind:audit AND action:auth.refresh.reuse_detected
kind:audit AND action:auth.login.rate_limited AND target:*<ip>*
kind:error.* AND request_id:<id>
kind:cron.pruner.tick
kind:email.send.dlq
```

## Testing

- `apps/api/test/observability/security-headers.test.ts` — every
  header present on every response, including 404
- `apps/api/test/observability/readyz.test.ts` — token gate + 200
  with checks
- `apps/api/test/observability/logger.test.ts` — deepScrub +
  sync/async modes (from Phase 9)
- `apps/api/test/integration/expired-rows-pruner.test.ts` —
  deletes expired rows, keeps live ones
- `apps/api/test/healthz.test.ts` — shallow health probe shape
