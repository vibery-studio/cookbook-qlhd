# Audit Logging (Phase 9)

Structured JSON audit events emitted via `console.log`. Cloudflare
Logpush ingests console output and ships it to an operator-chosen
destination (R2, Datadog, Splunk, etc.). No `audit_log` D1 table
in v1 — recipe for adding one is in `docs/recipes/add-audit-store.md`.

## Contract

`createAuditLogger({ ctx })` returns an `audit(event, opts?)`
function:

```ts
audit(
  {
    actor: "01USER0000000000000000AAAA" | "system:cron" | null,
    action: "auth.refresh.reuse_detected",
    target: "user:01USER...",
    metadata: { chain_root: "abc..." },
    ip: "1.2.3.4",  // optional
  },
  { sync: true },  // optional, default false
);
```

Every event is walked through `deepScrub` (recursive, case-insensitive
denylist: `password`, `token`, `authorization`, `cookie`, `secret`,
`apikey`, `api_key`, `access_token`, `refresh_token`, `ssn`, `pan`,
`credit_card`, `cvv`, `private_key`, and substrings thereof). Sensitive
values are replaced with `[REDACTED]`; the caller doesn't need to
remember the denylist.

## `audit_events` is append-only (SPEC-06 FR-13)

The in-app `audit_events` D1 table (SPEC-01 FR-4) refuses `UPDATE`/`DELETE`: triggers `trg_audit_events_no_update` /
`trg_audit_events_no_delete` (migration `0018_audit_events_append_only.sql`) `RAISE(ABORT)`. Product code only inserts.
Tests empty it only via `clearAuditEvents(env.DB, where?)` from `@runway/test-fixtures` (drop triggers → delete →
recreate from `sqlite_master`, one batch). Never add another cleanup path.

## Sync vs async

**Sync** (`sync: true`) — `console.log` fires synchronously; the
audit call returns after the write. Use for events that MUST survive
a Worker isolate death:

- `auth.refresh.reuse_detected`
- `settings.update`
- `admin.user.role_changed`
- `admin.user.disabled`
- `email.send.failed` (DLQ arrival)
- `auth.login.rate_limited` (Phase 10)

**Async** (default, `sync: false`) — enqueued via `ctx.waitUntil`
so the response returns before the write flushes. Use for high-
volume events where the tradeoff of "possible loss on isolate
death" is acceptable:

- `user.signup`
- `user.login`
- `user.logout`
- `email.send` (success)

When `ctx` is unavailable (some test / cron paths), async falls
back to sync — never dropped silently.

## Event catalog

Blueprint stable events (dashboards + alerts key off these strings):

| Action | Actor | Target | Sync? | Emitted from |
|--------|-------|--------|-------|--------------|
| `auth.refresh.reuse_detected` | userId | `user:<id>` | yes | auth-service |
| `settings.update` | userId | `settings:<key>` | yes | settings-service |
| `admin.user.role_changed` (future) | adminId | `user:<id>` | yes | admin-service |
| `auth.login.rate_limited` (Phase 10) | null or userId | `ip:<addr>` | yes | rate-limit middleware |
| `email.send.failed` (via DLQ) | `system:queue` | `email:<template>` | yes | email-dlq-consumer |
| `user.signup` (future) | userId | `user:<id>` | no | auth-service |
| `email.send` (future) | userId | `email:<template>` | no | email-service |

## Redaction

`deepScrub` walks the ENTIRE event payload before serialization,
not just the metadata. If a caller accidentally puts a `password`
field on the top-level event or nested inside `target`, it still
gets redacted.

Depth is capped at 32 levels; deeper nesting truncates with a
`[TRUNCATED_DEPTH]` sentinel, protecting against maliciously-crafted
inputs that would blow the recursion stack.

Substring matching is deliberate: `user_password_hash`,
`stripe_secret_key`, and `x-api-key` all redact even though they
aren't literal denylist entries. False positives (`bearer_token_id`
would redact because it contains `token`) are the safer failure mode
for an audit log — false negatives leak secrets.

## Logpush setup

Blueprint doesn't provision destinations — bring your own R2 bucket
or SIEM. Steps:

1. Create the destination (R2 bucket, Datadog, etc.).
2. In the Cloudflare dashboard: **Analytics & Logs → Logpush →
   Create job**. Dataset: `workers_trace_events`. Filter to
   `Outcome != "canceled"` and (optionally) filter by
   `ScriptName` for the deployed Worker.
3. Choose the fields to ship. `Message` carries the `console.log`
   line; `ScriptName`, `EventTimestamp`, and `Outcome` provide
   trace context.
4. Point at the destination + set batch cadence. Recommended: 5min
   batches to R2, 30s to Datadog.

## Consuming audit events downstream

The JSON line shape is stable across the blueprint:

```json
{ "ts": 1700000000000, "kind": "audit", "actor": "01USER...", "action": "auth.refresh.reuse_detected", "target": "user:01USER...", "metadata": { "chain_root": "abc..." } }
```

Filter for `kind == "audit"` in your destination's query language
to isolate audit events from regular request logs (which have
`kind: "request"` per the existing logger middleware in Phase 4).

## Testing

`apps/api/test/observability/logger.test.ts` (13 tests) covers:

- Deep-scrub redaction (top-level, nested, arrays, case-insensitive,
  substring matches)
- Depth truncation
- Sync mode writes before return
- Async mode delegates to `ctx.waitUntil`
- Fallback to sync when `ctx` is undefined
