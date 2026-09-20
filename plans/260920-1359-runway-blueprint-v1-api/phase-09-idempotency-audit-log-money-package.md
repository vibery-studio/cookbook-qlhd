---
title: "Phase 9: Idempotency & Structured Audit Logging"
status: todo
---

# Phase 9: Idempotency & Structured Audit Logging

## Overview

Two generic capabilities every serious product needs, shipped as blueprint primitives.

1. **Idempotency middleware** — required on protected mutating routes for authenticated principals. Namespaced key `${principalId}:${method}:${path}:${header}` (Red Team F7) — no cross-endpoint collisions, no IP-fallback poisoning. **CAS insert** with in-flight sentinel row + rowcount check protects against concurrent-same-key races. 24h TTL. Refuses `Idempotency-Key` header on unauthenticated routes.
2. **Structured audit logging** — `logger.audit({actor, action, target, metadata}, opts?)` writes JSON to `console.log` → Cloudflare Logpush → user-chosen destination. **No `audit_log` D1 table, no admin-audit route** (Red Team F14). Security-critical events call with `{sync: true}` — write completes before response returns; high-volume events fire-and-forget. Sensitive fields scrubbed by `logger.audit` itself (defense-in-depth, not caller responsibility).

**Removed from v1 (Red Team F14):** `packages/money`, `audit_log` D1 table, `admin-audit-service`, `admin-audit.routes.ts`, `GET /admin/audit`, cursor pagination logic, `audit:read` permission. Documented as v2 recipes.

A demo `POST /demo/notes` route showcases idempotency end-to-end in the golden path.

## Requirements

- Functional
  - [ ] Middleware `withIdempotency` reads `Idempotency-Key` header; scoped by authenticated `principal.id` only — **refuses `Idempotency-Key` on unauthenticated routes with 400** (Red Team F7)
  - [ ] Header format enforced by Zod: ULID or UUID only (36 chars max)
  - [ ] Namespaced cache key: `sha256(${principalId}:${method}:${path}:${header})` — bounds D1 PK length
  - [ ] Concurrent same-key: **CAS insert of sentinel row** `INSERT OR IGNORE (key, request_hash, response_status=NULL, ...)`; winning request executes handler; losing request polls for completion (up to 5s) then either returns cached result or 425 Too Early with `Retry-After: 1`
  - [ ] First completed request executes handler, updates row with `{status, body, request_hash}`, TTL 24h
  - [ ] Second request with same key + same request_hash → returns cached response verbatim
  - [ ] Second request with same key + different request_hash → 409 problem+json `type=/errors/idempotency-conflict`
  - [ ] Request hash includes stable headers (Content-Type, Content-Length) + method + path + body
  - [ ] Only success responses (200-299) are cached
  - [ ] `logger.audit({...}, {sync?: boolean})` writes structured JSON via `console.log`
  - [ ] `sync:true` awaits the write before returning (security-critical events)
  - [ ] `sync:false` (default) fires via `ctx.waitUntil` — errors routed through ErrorReporterPort (P10) so failures aren't silent
  - [ ] Sensitive keys (`password`, `token`, `authorization`, `cookie`, `secret`) recursively scrubbed inside `logger.audit` before serialization
- Non-functional
  - [ ] Idempotency lookup adds <10ms to request (D1 primary key lookup on hashed key)
  - [ ] Audit writes never block response for `sync:false` events
  - [ ] `sync:true` audit writes add <10ms

## Architecture

```
apps/api/src/
├── middleware/
│   └── idempotency.ts          # withIdempotency() factory; CAS + polling loser
├── dao/
│   └── idempotency-dao.ts      # `INSERT OR IGNORE` sentinel + upsert-on-complete + read-until-complete helpers
├── observability/
│   └── logger.ts               # logger.audit(event, opts) with recursive scrub + sync/async
└── routes/
    └── demo.routes.ts          # POST /demo/notes (fills P4 stub); uses withIdempotency
```

**Idempotency middleware flow (concurrency-safe):**

```
withIdempotency({ ttlSeconds: 86400 }) →
  header = c.req.header('Idempotency-Key')
  principal = c.get('principal')

  if !header: return next()   // opt-in

  if !principal:
    return 400 problem+json `type=/errors/idempotency-requires-auth`

  headerParsed = z.union([z.string().ulid(), z.string().uuid()]).parse(header)  // throws → 422

  keyRaw = `${principal.id}:${c.req.method}:${new URL(c.req.url).pathname}:${headerParsed}`
  cacheKey = sha256(keyRaw)
  requestHash = sha256(c.req.method + path + await c.req.text() + Content-Type + Content-Length)

  // CAS: insert sentinel row (status=NULL) or fail
  inserted = idempotencyDao.tryInsertSentinel({key: cacheKey, request_hash: requestHash, expires_at: now+86400})

  if !inserted:
    // Someone else is executing or already executed
    row = idempotencyDao.get(cacheKey)
    if row.request_hash !== requestHash:
      return 409 problem+json (idempotency-conflict)
    if row.response_status !== null:
      return c.body(row.response_body, row.response_status)
    // in-flight; poll up to 5s
    row = pollUntilComplete(cacheKey, 5000)
    if row.response_status: return c.body(...)
    return 425 problem+json `type=/errors/idempotency-in-flight` with `Retry-After: 1`

  // Execute handler
  await next()
  if response.status >= 200 && response.status < 300:
    idempotencyDao.updateWithResponse({key: cacheKey, response_status, response_body})
  else:
    idempotencyDao.deleteSentinel(cacheKey)   // don't cache non-2xx; allow retry
```

**Audit logger (structured, scrubbed, sync-capable):**

```ts
export function auditLog(env, ctx) {
  return async function audit(
    event: { actor: string | null; action: string; target?: string; metadata?: Record<string, unknown>; ip?: string | null },
    opts: { sync?: boolean } = {}
  ) {
    const scrubbed = deepScrub(event);  // recursive walk; denylist: password, token, authorization, cookie, secret, apikey, api_key, ssn, pan
    const line = JSON.stringify({ ts: Date.now(), kind: 'audit', ...scrubbed });
    if (opts.sync) {
      console.log(line);   // Logpush ingests console output
      return;
    }
    if (ctx?.waitUntil) {
      ctx.waitUntil(
        (async () => {
          try { console.log(line); }
          catch (e) { reporter?.capture(e, { context: 'audit-writer' }); }
        })()
      );
    } else {
      console.log(line);   // fallback for test contexts
    }
  };
}
```

**Security-critical audit events (SYNC always):**

- `auth.refresh.reuse_detected` (from P5)
- `auth.login.rate_limited` (from P10)
- `settings.update` (from P8)
- `admin.user.role_changed`, `admin.user.disabled` (P6)
- `email.send.failed` (DLQ arrival)

**High-volume events (async, ctx.waitUntil):**

- `user.login` (success)
- `user.logout`
- `email.send` (success)
- `user.signup`

## Related Code Files

- Create: `apps/api/src/middleware/idempotency.ts`
- Create: `apps/api/src/dao/idempotency-dao.ts`
- Create: `apps/api/src/observability/logger.ts` (`logger.audit` + `deepScrub`)
- Fill: `apps/api/src/routes/demo.routes.ts` (POST /demo/notes with idempotency)
- Create: `apps/api/src/db/migrations/000X_demo_notes.sql` (small notes table for the demo)
- Create: `docs/recipes/add-money.md` (Dinero.js integration recipe — v2)
- Create: `docs/recipes/add-audit-store.md` (audit-log D1 table + admin query recipe — v2)
- Create: `docs/audit.md` (event catalog, Logpush destination setup, sync vs async policy)
- Create: `docs/idempotency.md` (usage patterns, key format, CAS semantics)
- Modify: several P5-P8 services — call `logger.audit(...)` with correct sync/async setting
- **Removed:** `apps/api/src/ports/audit-port.ts`, `apps/api/src/services/{audit-service,admin-audit-service}.ts`, `apps/api/src/dao/audit-log-dao.ts`, `apps/api/src/routes/admin-audit.routes.ts`, `packages/money/**`, `audit_log` table migration

## Implementation Steps

1. **TDD idempotency middleware:**
   - Failing integration test: 2× POST /demo/notes with same key → same body
   - Failing test: same key + different body → 409
   - Failing test: unauthenticated request with header → 400
   - Failing test: 20 concurrent same-key requests → exactly one handler execution, 19 either see cached response or get 425
   - Failing test: invalid header format (`test-1`) → 422
   - Implement middleware factory + DAO helpers
2. **TDD logger.audit:**
   - Failing test: nested `password` field scrubbed 3 levels deep
   - Failing test: sync mode blocks until console.log completes (with a mock console)
   - Failing test: async mode uses ctx.waitUntil; a thrown error in the write is captured via reporter
   - Implement `deepScrub` (recursive walk with case-insensitive denylist)
3. **Wire audit calls into existing services** (P5, P6, P7, P8): search+replace pattern for stubs left by earlier phases. Every call must specify sync or accept default.
4. **Fill `POST /demo/notes` route** — accepts `{ title, body }`, creates a row in `notes` demo table (migration `000X_demo_notes.sql`), returns note. Applies `withIdempotency`.
5. **Contract test:** demo routes present in spec; idempotency 409 + 425 + 400 documented as response types
6. **Docs:** `docs/idempotency.md`, `docs/audit.md`, and recipes for `add-money.md` + `add-audit-store.md`

## Todo

- [ ] Idempotency middleware tested end-to-end including concurrent race
- [ ] Header Zod validation refuses non-ULID/UUID
- [ ] Unauth requests with header → 400
- [ ] CAS sentinel + polling loser proven
- [ ] `logger.audit` with recursive scrub + sync/async paths tested
- [ ] Existing services rewired to use `logger.audit`
- [ ] Demo notes resource + migration
- [ ] Docs written (including v2 recipes for money + audit-store)

## Success Criteria

- [ ] Bruno test: 2× POST /demo/notes same key → identical body
- [ ] 2× POST /demo/notes same key + different body → 409
- [ ] Unauth POST /demo/notes with `Idempotency-Key` → 400
- [ ] Concurrent 10× same key → exactly one execution (asserted via handler counter)
- [ ] Bruno test: `logger.audit({action:'test.foo', metadata:{password:'x'}})` output contains `[REDACTED]` not `x`
- [ ] Sync audit test: force a settings.update; verify audit line is in captured console before response byte

## Risk Assessment

- **Idempotency CAS lock is D1-bound (single db):** D1 uses SQLite semantics; INSERT OR IGNORE is atomic within a statement. Multi-Worker instances still serialize on the D1 backend.
- **Polling loser latency (5s max):** Rare in practice (handler usually completes in <1s). Documented; clients should still retry on 425 with backoff.
- **`ctx.waitUntil` on isolate teardown:** Async audit can be lost on hard isolate death. Mitigation: security-critical events already use `sync:true`. Documented; a v2 durable audit-store recipe covers stricter compliance needs.
- **Body-hashing memory:** Cap body size (2MB) via existing Hono limit; document.
- **Logpush destination is user-owned:** Blueprint doesn't provision R2/Datadog for you. `docs/audit.md` provides setup steps and a schema for typical destinations.
- **Cross-endpoint replay via same key:** Prevented by including method+path in key namespace + `request_hash` mismatch → 409.
