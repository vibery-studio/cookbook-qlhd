# Operational Control Plane

Phase 2 (v1.1) primitives that let an operator change **behavior** without a
code deploy. Distinct from Phase 8 settings, which change **values** (e.g.
email from-address). Four surfaces:

1. **Feature flags** with typed registry + deterministic percentage rollout.
2. **Global maintenance mode** — blocks all non-safelisted traffic with 503.
3. **Global write circuit-breaker** — blocks state-changing routes; reads
   pass through.
4. **Named kill switches** — targeted no-op for a specific integration
   (v1.1: `email.enabled`; add more with one registry line + one gate).

Everything is served from the same D1 table + KV cache pattern as settings.
No SDK. No third-party dependency. The blueprint stays vendor-free.

## Data model

```sql
CREATE TABLE feature_flags (
  key         TEXT PRIMARY KEY,   -- must match a registry entry
  enabled     INTEGER NOT NULL,   -- 0/1 boolean
  percentage  INTEGER,            -- null for boolean flags; 0-100 for rollout
  allowlist   TEXT,               -- JSON array of principal ids (overlay)
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT                -- null on seed rows
);
```

Read path: KV (`flag:<key>`, 5min TTL) → D1 → registry default.
Write path: Zod-validate → D1 upsert → KV bust → SYNC audit event.

## Registry (v1.1 seeds)

| Key                       | Kind    | Default | Purpose                                                              |
|--------------------------|---------|---------|----------------------------------------------------------------------|
| `system.maintenance_mode` | boolean | false   | Block all non-safelisted routes with 503                             |
| `system.writes_disabled`  | boolean | false   | Block state-changing routes; reads pass through                      |
| `email.enabled`           | boolean | true    | Kill switch for outbound email; when false, adapter no-ops           |
| `signup.enabled`          | boolean | true    | When false, `POST /auth/signup` returns 503; existing users unaffected |

The registry is compile-time exhaustive: unknown keys are rejected at the
admin write path (404), and TypeScript refuses `flags.get('typo')` at
compile time.

## Adding a flag

Two lines of code:

1. Append to `apps/api/src/flags/registry.ts`:
   ```ts
   "feature.new_pricing": {
     kind: "percentage",
     default: false,
     description: "Gradual rollout of the redesigned pricing UI",
   },
   ```

2. Seed migration alongside every new flag so `list()` shows a row and
   the operator dashboard doesn't advertise a missing default:
   ```sql
   -- migrations/00NN_seed_new_pricing_flag.sql
   INSERT OR IGNORE INTO feature_flags (key, enabled, percentage, allowlist, updated_at, updated_by)
   VALUES ('feature.new_pricing', 0, NULL, NULL, 0, NULL);
   ```

Use it:

```ts
const flags = new FlagsService({ db: getDb(env), kv: env.SETTINGS });
const enabled = await flags.get('feature.new_pricing', { id: principal.id });
if (!enabled) return legacyResponse();
```

## Using kill switches

Adding a new kill switch is 1 registry line + 1 gate in the code path
being killed. Example: adding `billing.enabled`.

1. Registry: `"billing.enabled": { kind: "boolean", default: true, description: "..." }`
2. Seed migration.
3. In the billing adapter:
   ```ts
   const enabled = await flags.get('billing.enabled');
   if (!enabled) return { ok: false, error: { code: "permanent", message: "billing disabled" } };
   ```

Every kill switch mutation emits a distinct audit event:
- `flag.updated` — normal enable/disable/percentage change.
- `flag.kill_switch_activated` — a kill switch (default=true) was turned
  off. Used for alerts.
- `flag.kill_switch_active` — emitted per-attempt through a killed path,
  rate-limited to 1/min per isolate to avoid log spam.

## Operating maintenance mode

The safest way to turn on maintenance:

```bash
# From a workstation with admin credentials
curl -X PUT https://api.runway.dev/admin/flags/system.maintenance_mode \
  -H "Content-Type: application/json" \
  -H "Origin: https://runway.dev" \
  -H "X-Requested-With: fetch" \
  -H "Cookie: runway_at=<admin-access-cookie>" \
  -d '{"enabled": true}'
```

While maintenance is ON:
- Every route returns `503 Service Unavailable` with `Retry-After: 60`
  and a Problem+JSON body.
- `GET /healthz` and `GET /readyz` are exempt (probes must survive).
- `/admin/flags/*` are exempt (**bootstrap-recovery invariant**: the
  operator must always be able to flip the switch back).

The safelist is hard-coded in `require-not-maintenance.ts` — it is NOT
configurable via another flag, which would create a
brick-yourself-and-lock-yourself-out failure mode.

To turn it back off, PUT `{"enabled": false}` to the same URL. The KV
cache TTL is 5 minutes, so a stale worker in one region may keep
serving 503 for up to 5 minutes after the write. Bounded staleness is
the trade-off for zero-dependency reads.

## Rotating a kill switch

Rotating `email.enabled` (example):

1. Turn OFF: `PUT /admin/flags/email.enabled { "enabled": false }`. Emits
   `flag.kill_switch_activated`.
2. Every outbound email attempt from that moment routes through the
   `kill-switch` adapter — no send, no buffer entry, no per-message log
   line. A single `flag.kill_switch_active` audit event fires per
   isolate per minute.
3. Investigate the underlying problem out-of-band.
4. Turn ON: `PUT /admin/flags/email.enabled { "enabled": true }`.
   `flag.updated` emits. Next `selectEmailAdapter` call reads the fresh
   value (KV cache invalidated).

## Percentage flags

Deterministic per-principal assignment:

```
hash = SHA-256(principalId + flagKey)
bucket = uint32(hash[0..4]) % 100
enabled = (bucket < percentage)
```

Properties:
- The same (principal, flag) always maps to the same bucket. A user in
  the 20% cohort stays there until the percentage changes.
- Different flag keys reshuffle buckets. A user in the 20% cohort of
  `feature.a` is not necessarily in the 20% cohort of `feature.b`.
- `allowlist` overrides bucketing. An included principal sees `true`
  regardless of percentage.
- Anonymous callers (no principal) fall back to `enabled` outright when
  a percentage is set. Design your flag so this is safe.

## Middleware order

```
requestId → logger → securityHeaders
  → requireNotMaintenance   (exempts /healthz, /readyz, /admin/flags/*)
  → requireWritesEnabled    (exempts GET/HEAD/OPTIONS + /admin/flags/*)
  → requireOrigin → requireFetchHeader
  → [route-specific]
```

Maintenance is strictly stronger than writes-disabled — an operator can
compose them ("maintenance OFF but writes OFF" == read-only mode) or
run them independently.

## Risk assessment (residual)

- **Cache-write ordering.** A reader that KV-misses before a writer's
  D1 upsert can populate KV with the pre-write value, extending the
  staleness window to `KV_TTL_SECONDS` (5min) in one region. Acceptable
  vs. the alternative of an SDK. Documented in
  `apps/api/src/flags/flags-service.ts`.
- **Registry drift.** A flag defined in code without a seed migration
  returns the registry default. Discipline: one seed migration per new
  flag.
- **Percentage hash collision.** Two flags sharing the same key across
  two populations bucket users identically. Not a bug per se; document
  when it matters.

## References

- Code: `apps/api/src/flags/`, `apps/api/src/middleware/require-not-maintenance.ts`, `apps/api/src/middleware/require-writes-enabled.ts`, `apps/api/src/routes/admin-flags.routes.ts`
- Migration: `apps/api/src/db/migrations/0005_spicy_big_bertha.sql` (schema), `0006_seed_flags_permissions.sql` (RBAC + seeds)
- Tests: `apps/api/test/integration/flags-flow.test.ts`
