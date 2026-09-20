# Email Pipeline (Phase 7)

Provider-agnostic email with URL allowlisting, Zod-validated props,
retry queue with exponential backoff, DLQ, and a cron-triggered
sweeper backstop.

## Layers

```
auth-service (or any caller)
   ↓  EmailPort.send(msg)
email-with-retry adapter
   ↓ raw adapter (noop | resend)
   |   on transient failure ↓
   |   env.EMAIL_RETRY_QUEUE.send(payload, delaySeconds)
   |
email-retry-consumer (queue handler)
   ↓ retryEmail(deps, payload)
   |   on attempt N failure ↓
   |   enqueue attempt N+1 (30s → 2m → 10m → 30m)
   |
   |   after attempt 5 → DLQ (dead_letter_queue = "email-dlq")
```

The **cron sweeper** (`crons/verify-email-sweeper.ts`, `*/5 * * * *`)
is a durable backstop — even if Queues drops a message or Resend is
down for hours, unverified users >15min old get a fresh email until
`verify_email_resend_count >= 3`.

## Configuration

Environment variables (set via `.dev.vars` locally, `wrangler secret
put` in prod):

- `EMAIL_PROVIDER=noop|resend` — selector. Defaults to `noop`.
- `RESEND_API_KEY=re_...` — required when `EMAIL_PROVIDER=resend`.
- `APP_ORIGIN=https://runway.dev` — url-allowlist origin match. Any
  URL prop that doesn't share this origin is refused at render time.

Placeholder from-address defaults to `no-reply@example.com` — that
address bounces. **Before production**: verify a domain in Resend,
set up DKIM/SPF, and update `DEFAULT_FROM_ADDRESS` in
`adapters/email-select.ts`.

## URL Allowlist

`sanitizeUrl(rawUrl, appOrigin)`:

- Refuses anything not starting with `https://` (blocks `javascript:`,
  `data:`, `vbscript:`, `file:`, protocol-relative, relative paths).
- Rejects URLs whose parsed `.protocol !== "https:"` (defense against
  homoglyphs).
- Rejects embedded credentials (`https://user:pass@host/...`).
- If `appOrigin !== ""`, requires the URL's origin to match exactly.
  Off-origin `https://` URLs pass only when `appOrigin` is `""`
  (e.g., linking to a public help center in a future template).

Failures throw `UnsafeUrlError`; the render aborts before HTML
generation. Test coverage: `packages/email-templates/test/url-allowlist.test.ts`.

## Retry Schedule

`services/email-service.ts` — `computeBackoffSeconds(nextAttempt)`:

| nextAttempt | delay |
|-------------|-------|
| 2 | 30s |
| 3 | 2m |
| 4 | 10m |
| 5 | 30m |
| >5 | — (DLQ) |

`QUEUE_MAX_DELAY_SECONDS = 43200` (12h) mirrors Cloudflare Queues'
per-message `delaySeconds` cap. Any future schedule extension is
clamped by `Math.min(desired, QUEUE_MAX_DELAY_SECONDS)`.

`MAX_RETRY_ATTEMPTS = 5`. After attempt 5's failure, the retry
consumer stops re-enqueueing; the message routes to the DLQ.

## DLQ

Two paths land on `email-dlq`:

1. **App-level exhaustion** — when the retry-consumer sees
   `retryEmail` return `{kind: "failed"}` (after `MAX_RETRY_ATTEMPTS`
   or a permanent classification), it explicitly pushes the payload
   to `EMAIL_DLQ_QUEUE` via the dedicated producer binding, then
   `ack()`s the retry-queue message. The DLQ payload extends the
   retry payload with `finalReason` + `finalAttemptAt`.
2. **Platform exhaustion** — CF Queues' built-in
   `dead_letter_queue = "email-dlq"` fires when a message hits
   `max_retries` on the retry consumer via `msg.retry()` (i.e., our
   safety-net path for unexpected exceptions).

`email-dlq` is a sink-only queue in v1 — no consumer wired in
`wrangler.toml`. Operator inspection:

```
wrangler queues consumer email-dlq peek
```

To attach a consumer that emits audit logs, add
`[[queues.consumers]] queue = "email-dlq"` to `wrangler.toml` and wire
`emailDlqConsumer` from `queues/email-dlq-consumer.ts` into
`index.ts`'s `queue()` dispatcher.

## Cron Sweeper

`wrangler.toml`:
```toml
[triggers]
crons = ["*/5 * * * *"]
```

Every 5 minutes the scheduled handler (`index.ts` → `verifyEmailSweeper`)
queries:

```sql
SELECT id, email, verify_email_resend_count
FROM users
WHERE status = 'pending'
  AND verified_at IS NULL
  AND created_at < now - 900       -- 15 min pending gate
  AND verify_email_resend_count < 3
  AND updated_at < now - 600       -- 10 min per-user cooldown
ORDER BY id
LIMIT 100
```

For each row: mint a fresh verification token, enqueue a verify email
via the retry-wrapped adapter, bump the counter **only when the
adapter delivered synchronously or permanently failed** (not on
`provider: "queued"` — that means the retry pipeline took over and
will deliver later; charging a slot there would double-count).
`updated_at` is bumped on every pass regardless, so the cooldown keeps
the user out of the next tick.

Users at the cap of 3 resends are ignored — manual admin intervention
takes over.

Batch size cap (100/tick) prevents runaway operator cost during a
backlog; next tick picks up the rest.

## Templates

`packages/email-templates`:

- `verify-email.tsx` — subject: "Verify your Runway account"
- `password-reset.tsx` — subject: "Reset your Runway password"

Adding a template: (1) add `.tsx` file with a React Email component;
(2) add a Zod schema + prop type to `prop-schemas.ts`; (3) extend the
`TemplatePropsUnion` discriminated union; (4) add a branch to
`renderTemplate` in `render.ts`; (5) extend `EmailMessage` in
`apps/api/src/ports/email-port.ts`.

## Observability

Structured logs on every consequential event:

- `email.send.noop` — noop adapter fired
- `email.retry.consumer.error` — consumer caught an unexpected throw
- `email.send.dlq` — message reached DLQ (in the DLQ consumer, when wired)
- `email.sweeper.tick` — sweeper ran, N users processed
- `email.sweeper.permanent_failure` — adapter returned permanent for a swept user

Phase 10 pipes these into Logpush + Sentry.

## Testing

- `packages/email-templates/test/*` — render + URL allowlist + prop
  schema (27 tests, no D1)
- `apps/api/test/services/email-service.test.ts` — backoff schedule
  + retryEmail + sendEmail outcomes (12 tests)
- `apps/api/test/integration/verify-email-sweeper.test.ts` — sweeper
  age filter, resend cap, adapter-outcome bump (5 tests)
- `apps/api/test/integration/auth-flow.test.ts` — signup pathway
  (already covers noop capture end-to-end)
