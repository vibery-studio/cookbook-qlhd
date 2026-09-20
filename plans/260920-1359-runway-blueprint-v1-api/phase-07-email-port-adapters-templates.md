---
title: "Phase 7: Email Port, Adapters & Templates"
status: todo
---

# Phase 7: Email Port, Adapters & Templates

## Overview

Provider-agnostic email pipeline: `EmailPort` interface, **Resend + Noop adapters only** (Red Team F9 + scope critic: SES SigV4 hand-roll dropped from v1; documented as v2 recipe using `aws4fetch`). React Email templates for `verify-email` and `password-reset` with **per-template Zod-validated `props` via discriminated union** (Red Team F7: enforcement, not aspiration). Cloudflare Queue-backed retry with exponential backoff **capped at Cloudflare Queues' documented max message delay** (Red Team F8) + DLQ. **Cron-triggered sweeper Worker** re-enqueues verify-email for unverified users older than 15 min (defense-in-depth against Queue message loss during outages). From-address and from-name resolved from System Settings at send time. Template render output escapes all URLs through an https-only allowlist. All emails audit-logged via `logger.audit(...)`.

## Requirements

- Functional
  - [ ] `EmailPort.send({ template, to, props })` renders template + returns `Result<{messageId}>`
  - [ ] Resend adapter POSTs to `https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>`
  - [ ] Noop adapter appends to an in-memory ring buffer + logs; readable via test helper for integration tests
  - [ ] On 5xx / network error: enqueue to `email-retry` Queue; consumer retries with exponential backoff (30s, 2m, 10m, capped at CF Queues' documented max message delay) + max 5 attempts
  - [ ] After max attempts: move to `email-dlq` Queue + `logger.audit({action:'email.send.failed', sync:true})` + Sentry capture
  - [ ] **Cron-triggered sweeper Worker** (Phase 10 `[triggers]` block) runs every 5 minutes: queries `users WHERE status='pending' AND verified_at IS NULL AND created_at < now - 900`, re-enqueues verify email for each. Prevents queue-loss-induced signup dead-ends.
  - [ ] Templates rendered via React Email → `{ html, text, subject }`
- Non-functional
  - [ ] Adapter switch is env-only (`EMAIL_PROVIDER=resend|noop`); zero code changes to swap providers
  - [ ] Provider secrets never logged; scrubbed from Sentry (P10)
  - [ ] Template rendering deterministic (no time-dependent output in template body)
  - [ ] **Per-template `props` typed as a discriminated union at the `EmailPort` boundary** — TS compiler forces per-template shape; Zod runtime-validates before render
  - [ ] All URLs rendered into templates pass an https-only allowlist check (must start with `env.APP_ORIGIN` or `https://`; refuses `javascript:`, `data:`, relative)
  - [ ] Total email code path stays within bundle-size gate (900KB, from Phase 2)

## Architecture

```
apps/api/src/
├── ports/
│   └── email-port.ts           # EmailMessage = discriminated union by template
├── adapters/
│   ├── email-resend.ts
│   ├── email-noop.ts
│   └── email-select.ts         # factory: env.EMAIL_PROVIDER → adapter instance
├── services/
│   └── email-service.ts        # loadSettings → renderTemplate → adapter.send → on failure enqueue
├── queues/
│   ├── email-retry-consumer.ts # Queue consumer handler
│   └── email-dlq-consumer.ts
└── crons/
    └── verify-email-sweeper.ts  # scheduled handler; wired via wrangler.toml [triggers]

packages/email-templates/
├── src/
│   ├── verify-email.tsx        # React Email component
│   ├── password-reset.tsx
│   ├── render.ts               # renderTemplate(name, props) → {html, text, subject}; Zod-validated + URL-allowlist checked
│   ├── url-allowlist.ts        # sanitizeUrl(url, appOrigin): string | throws
│   ├── prop-schemas.ts         # Zod schemas per template
│   └── index.ts
├── package.json
└── test/
    ├── render.test.ts          # snapshot renders + XSS/URL-poison fixtures
    └── prop-schemas.test.ts
```

**EmailPort interface (discriminated union):**

```ts
export type EmailMessage =
  | { template: 'verify-email'; to: string; props: { userName: string; verifyUrl: string } }
  | { template: 'password-reset'; to: string; props: { userName: string; resetUrl: string; expiresIn: string } };

export interface EmailSent { messageId: string; provider: 'resend' | 'noop'; }
export interface EmailPort {
  send(msg: EmailMessage): Promise<
    | { ok: true; value: EmailSent }
    | { ok: false; error: EmailError }
  >;
}
```

**Retry queue payload (versioned):**

```json
{ "v": 1, "attempt": 1, "message": {...}, "firstAttemptAt": 1234567890 }
```

**Backoff schedule** (must respect CF Queues per-message max `delay_seconds` — verify current cap in `docs/email.md`; if platform max is 12h, keep 6h; else cap to platform max):

- attempt 1 fail → attempt 2 in 30s
- attempt 2 fail → attempt 3 in 2min
- attempt 3 fail → attempt 4 in 10min
- attempt 4 fail → attempt 5 in min(30min, platform_cap)
- attempt 5 fail → DLQ

The Cron sweeper (5-min tick) is the durable backstop: even if Queue drops messages, unverified users get re-notified.

## Related Code Files

- Create: `apps/api/src/ports/email-port.ts`
- Create: `apps/api/src/adapters/email-{resend,noop,select}.ts`
- Create: `apps/api/src/services/email-service.ts`
- Create: `apps/api/src/queues/{email-retry-consumer,email-dlq-consumer}.ts`
- Create: `apps/api/src/crons/verify-email-sweeper.ts`
- Create: `packages/email-templates/src/{verify-email,password-reset,render,url-allowlist,prop-schemas,index}.tsx`
- Create: `packages/email-templates/test/{render,prop-schemas}.test.ts`
- Create: `docs/recipes/add-ses-adapter.md` (v2 recipe using `aws4fetch`, NOT hand-rolled SigV4)
- Modify: `apps/api/src/index.ts` — export Queue handlers + scheduled handler (`export default { fetch, queue, scheduled }`)
- Modify: `apps/api/wrangler.toml` — `[[queues.producers]]` for `email-retry` and `email-dlq`; `[[queues.consumers]]` for retry (dead_letter_queue = `email-dlq`); `[triggers] crons = ["*/5 * * * *"]`
- Modify: `apps/api/src/services/auth-service.ts` (P5) — replace stub port with real `EmailService`
- Modify: `.dev.vars.example` — `EMAIL_PROVIDER=noop`, `RESEND_API_KEY=`, `APP_ORIGIN=`

## Implementation Steps

1. **TDD templates first (pure, node-testable):**
   - Failing test: `render.test.ts` — verify-email renders with valid props produces stable html + text + subject
   - Failing test: `render.test.ts` XSS — planting `javascript:alert(1)` in `verifyUrl` throws from `sanitizeUrl` (rendered HTML never contains it)
   - Failing test: `prop-schemas.test.ts` — invalid props (bad email, missing fields) rejected by Zod before render
   - Install `react-email`, `@react-email/components`, `@react-email/render`
   - Implement `verify-email.tsx`, `password-reset.tsx`
   - `render.ts` exports typed `renderTemplate(name, props)` — Zod-validated props via discriminated union, URL fields passed through `sanitizeUrl`
2. **Prototype bundle-size check EARLY:** After steps 1-2 write minimal render call, run `pnpm build` and confirm `apps/api/dist` stays under 900KB. If over budget, pivot NOW to mustache-precompiled templates (documented fallback with ~150 LOC budget); do not proceed to adapters until this gate is green.
3. **Ports & adapters:**
   - `email-port.ts` interface with discriminated union `EmailMessage`
   - `email-noop.ts` — ring buffer + log; export test helper `getNoopSentEmails(env)`
   - `email-resend.ts` — `fetch('https://api.resend.com/emails', ...)`; parse response; typed errors
   - `email-select.ts` factory
4. **Email service:**
   - Reads `email.from_address` + `email.from_name` from Settings (P8) or env fallback
   - Calls adapter → on failure classifies error (4xx = permanent → DLQ immediately; 5xx/network = transient → enqueue retry)
5. **Queue consumers:**
   - `email-retry-consumer` reads batch, retries send, on failure re-enqueues with `attempt+1` and `delaySeconds` = next-scheduled-backoff **capped at CF Queues per-message max delay** (verify via `WebFetch` against Cloudflare Queues limits page; encode cap as constant in code + `docs/email.md`)
   - `email-dlq-consumer` audit-logs SYNC + Sentry-captures; no auto-retry
6. **Cron sweeper (`verify-email-sweeper.ts`):**
   - Query `users WHERE status='pending' AND verified_at IS NULL AND created_at < now - 900`
   - For each: check that verification token hasn't expired; if it has, generate a new one; enqueue verify email
   - Rate-limit sweep re-sends (e.g., max 3 re-sends per user; add `verify_email_resend_count` column or use audit log count)
7. **Wire into auth-service:** replace stub port; integration tests still pass (using noop provider)
8. **Integration tests:**
   - Signup → noop buffer has one email with sanitized verifyUrl containing verification token
   - Force adapter to throw → message ends up in retry queue (mock Queue producer)
   - After N retries → DLQ, sync audit fires
   - Force `sanitizeUrl` receives `javascript:...` → throws before render
   - Sweeper: pre-seed a pending user older than 15min → invoke scheduled handler → assert new email enqueued
9. **Wrangler config:** wire queue producers + consumer + cron trigger; dev uses local Queue emulator
10. **Docs:** `docs/email.md` — provider setup, verified domain requirements, DKIM/SPF notes, DLQ inspection, Queue max-delay cap; `docs/recipes/add-ses-adapter.md` — full recipe for SES via `aws4fetch` in v2

## Todo

- [ ] React Email templates rendering deterministically
- [ ] Discriminated-union `EmailMessage` compiled-in
- [ ] Per-template Zod prop schemas enforced in `renderTemplate`
- [ ] URL allowlist / sanitizer with XSS unit test
- [ ] Ports/adapters implemented with tests (**no SES**)
- [ ] Retry queue wired; consumer handler exported from Worker
- [ ] Backoff cap verified against CF Queues docs + encoded as constant
- [ ] DLQ configured on retry queue
- [ ] Cron sweeper wired + `wrangler.toml` `[triggers]` set + test proves it fires
- [ ] Auth signup email works end-to-end via noop in test
- [ ] Env-based provider swap tested (`EMAIL_PROVIDER=resend` → hits Resend mock)
- [ ] Bundle-size gate verified at 900KB after email code path added
- [ ] `docs/email.md` written
- [ ] `docs/recipes/add-ses-adapter.md` written (aws4fetch pattern)

## Success Criteria

- [ ] `pnpm test` includes template render snapshots + XSS fixture + prop-schema rejection
- [ ] Auth signup integration test: noop provider captures verify-email; extracting the URL and calling `/auth/verify` succeeds
- [ ] URL-poison test: `javascript:alert(1)` planted in `verifyUrl` throws → email never renders
- [ ] Killing the adapter in a test (throw on send) causes the message to land in `email-retry` queue with `attempt=1`
- [ ] Force max failures → DLQ receives + sync audit log entry present
- [ ] Cron sweeper test: seed unverified user 20 min old → scheduled invocation enqueues re-verify
- [ ] `pnpm build` still under 900KB after full email path implemented

## Risk Assessment

- **React Email bundle size:** Bundle-size gate at 900KB is enforced by Phase 2 CI. Prototype in step 2; pivot to mustache-precompile fallback (documented, ~150 LOC) if over budget. Do not proceed to full implementation without confirming the budget.
- **Queue billing:** Retry backoff with `delaySeconds` per message + max attempts + Cron sweeper create bounded operation cost. Document expected volume in `docs/email.md`.
- **CF Queues max delay:** Verify current cap via docs at implementation time. Encode as `QUEUE_MAX_DELAY_SECONDS` constant; backoff calculation uses `Math.min(desired, QUEUE_MAX_DELAY_SECONDS)`.
- **From-address deliverability:** Placeholder default (`no-reply@example.com`) will bounce. `docs/email.md` mandates verified domain before production use; blueprint README calls this out.
- **Race between P8 Settings and P7:** Until P8 lands, EmailService reads from env vars; after P8, reads from Settings with env fallback. Guard with `try { settings.get } catch { env }`.
- **Cron sweeper double-sends:** Sweeper must be idempotent; use audit-log count or a `verify_email_resend_count` column to cap resends per user (e.g., 3) and cooldown between sweeps (e.g., 10min).
