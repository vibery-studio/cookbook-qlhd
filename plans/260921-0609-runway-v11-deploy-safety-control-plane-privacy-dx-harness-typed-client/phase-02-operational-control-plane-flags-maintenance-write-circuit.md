---
phase: 2
title: "Operational Control Plane (flags, maintenance, write circuit)"
status: completed
priority: P1
effort: "1-2d"
dependencies: []
---

# Phase 2: Operational Control Plane

## Overview

Settings (P8) let operators change *values*. This phase ships control-plane
primitives that let operators change *behavior* — turn things off, gate
rollouts, stop damage — without a code deploy. Four surfaces: (1) typed
feature flags with deterministic hash-based percentage rollout, (2)
global maintenance mode, (3) global write circuit breaker, (4) named
kill switches for high-risk integrations (email delivery in v1.1;
future: billing, webhooks).

## Requirements

- Functional
  - `flags.get<K>(key, principal?)` returns typed boolean/percentage
    result. Percentage flags use `hash(principalId + flagKey) % 100 <
    percentage` for deterministic-per-user assignment.
  - `flags.list()` returns every registered flag with current state,
    percentage, last-changed-by, last-changed-at.
  - `PUT /admin/flags/:key { enabled?, percentage?, allowlist? }`
    validates against a typed registry (like settings) and persists to
    D1. Requires `flags:write` permission.
  - Maintenance mode: single flag `system.maintenance_mode`. When ON,
    all mutating routes return 503 with `Retry-After`. Allow-list of
    exempt routes (health, readyz, `/admin/flags/*` so operators can
    turn it back off).
  - Write circuit breaker: single flag `system.writes_disabled`. When
    ON, state-changing routes return 503; reads pass through. Distinct
    from maintenance mode which blocks all non-safelisted traffic.
  - Named kill switches: `email.enabled` (blocks email adapter sends
    with a no-op + audit line). Adding a kill switch = 1 line in the
    registry + 1 gate in the code path being killed.
  - Every flag mutation emits a SYNC audit event (`flag.updated` or
    `flag.kill_switch_activated`).
- Non-functional
  - Flag reads served from KV cache (5-min TTL) with D1 fallback,
    mirroring the SettingsService pattern. Reads MUST be <10ms.
  - Flag registry typed: `FlagKey` is a string union derived from a
    frozen `as const` array (compile-time exhaustiveness).
  - No SDK dependency (no LaunchDarkly). Blueprint stays vendor-free.
  - Percentage assignment is deterministic and stable per (principal,
    flag) tuple — a user in the 20% bucket stays there until the flag
    changes.

## Architecture

```
apps/api/src/
├── flags/
│   ├── registry.ts             # FLAG_REGISTRY: typed catalog
│   ├── flags-port.ts           # interface (mirrors SettingsPort)
│   ├── flags-service.ts        # KV cache → D1 → registry default
│   └── keys.ts                 # export const FLAG_KEYS
├── dao/
│   └── flags-dao.ts            # upsertFlag, listAllFlags, findByKey
├── middleware/
│   ├── require-not-maintenance.ts   # blocks state-changing when maintenance ON
│   └── require-writes-enabled.ts    # blocks state-changing when writes_disabled ON
└── routes/
    └── admin-flags.routes.ts    # GET list / GET :key / PUT :key
```

Schema addition (new migration `0005_add_flags.sql`):

```sql
CREATE TABLE IF NOT EXISTS feature_flags (
  key         TEXT PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 0,  -- 0/1 boolean
  percentage  INTEGER,                     -- null for boolean flags; 0-100 for gradual
  allowlist   TEXT,                        -- JSON array of principal ids (optional overlay)
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);
```

Registry (v1.1 seed):

```ts
export const FLAG_REGISTRY = {
  "system.maintenance_mode": {
    kind: "boolean",
    default: false,
    description: "Block all non-safelisted routes with 503",
  },
  "system.writes_disabled": {
    kind: "boolean",
    default: false,
    description: "Block state-changing routes; reads pass through",
  },
  "email.enabled": {
    kind: "boolean",
    default: true,
    description: "Kill switch for outbound email; when false, adapter no-ops",
  },
  "signup.enabled": {
    kind: "boolean",
    default: true,
    description: "When false, /auth/signup returns 503; existing users unaffected",
  },
} as const;
```

Percentage flags aren't seeded in v1.1 — the shape is supported but
consumers add their own (e.g. `feature.new_pricing`).

Middleware order in `index.ts` (new middlewares slot between logger and
auth):

```
requestId → logger → securityHeaders
  → requireNotMaintenance   (NEW; skips GET /healthz, GET /readyz, PUT /admin/flags/*)
  → requireWritesEnabled    (NEW; skips GET/HEAD)
  → requireOrigin → requireFetchHeader
  → [route-specific]
```

## Related Code Files

- Create: `apps/api/src/flags/{registry,flags-port,flags-service,keys}.ts`
- Create: `apps/api/src/dao/flags-dao.ts`
- Create: `apps/api/src/middleware/require-not-maintenance.ts`
- Create: `apps/api/src/middleware/require-writes-enabled.ts`
- Create: `apps/api/src/routes/admin-flags.routes.ts`
- Create: `apps/api/src/db/migrations/0005_add_flags.sql` + snapshot + journal update
- Modify: `apps/api/src/db/schema.ts` (add `featureFlags` table)
- Modify: `apps/api/src/index.ts` (install the two new middlewares)
- Modify: `apps/api/src/routes/index.ts` (mount `adminFlagsRoutes`)
- Modify: `apps/api/src/adapters/email-select.ts` (return noopEmailAdapter when `email.enabled === false`)
- Modify: `packages/rbac/src/catalog.ts` (add `flags:read` + `flags:write` permissions)
- Modify: `apps/api/src/db/migrations/0001_seed_rbac.sql` (via a new 0006 seed migration — do NOT edit 0001; grant flags:* to admin)
- Create: `docs/control-plane.md`

## Implementation Steps

1. Write the migration (`0005_add_flags.sql`) + update journal + snapshot chain.
2. Add `featureFlags` to `schema.ts` + `schema` export.
3. Write `flags/registry.ts` mirroring `settings/registry.ts` shape (typed
   const with `kind: "boolean"` v1; extensible to `percentage` later).
4. Write `flags-dao.ts` (find/list/upsert; JSON-encode `allowlist`).
5. Write `FlagsService` with the same KV-cache-first read pattern as
   `SettingsService`. `get()` throws on schema mismatch (loud failure).
   Include `evaluate(key, principal?)` that resolves boolean + optional
   allowlist overlay + percentage bucket.
6. Write `require-not-maintenance.ts` middleware: reads
   `flags.get('system.maintenance_mode')`; when ON, returns 503 with
   `Retry-After: 60`. Skip on: GET/HEAD to `/healthz`, `/readyz`, and
   POST to `/admin/flags/*` (so operator can toggle off).
7. Write `require-writes-enabled.ts` middleware: reads
   `flags.get('system.writes_disabled')`; when ON, only allows
   GET/HEAD/OPTIONS. Everything else → 503.
8. Wire both middlewares in `index.ts` (order documented above).
9. Update `email-select.ts` to check `flags.get('email.enabled')`
   before returning the real adapter; when false, return
   `noopEmailAdapter` and log a `flag.kill_switch_active` audit line
   per send attempt (rate-limited to 1/min to avoid log spam).
10. Add `flags:read` + `flags:write` to `packages/rbac/src/catalog.ts`.
11. New seed migration `0006_seed_flags_permissions.sql` grants both to
    admin role.
12. Write `admin-flags.routes.ts` — GET list (settings:read? no, use
    `flags:read`), GET :key, PUT :key. Same shape as
    `admin-settings.routes.ts`. RBAC gate per-verb.
13. Integration tests:
    - Enable `signup.enabled=false`, POST `/auth/signup` → 503.
    - Enable `system.writes_disabled`, POST `/demo/notes` → 503; GET
      `/me` still works.
    - Enable `system.maintenance_mode`, ANY route → 503 except health/
      readyz/`/admin/flags/*`.
    - Turn off `email.enabled`, signup → no email in noop buffer +
      audit log entry.
    - Percentage flag (test-only registered): user in 20% bucket gets
      true consistently across 100 evaluations.
14. Write `docs/control-plane.md`.

## Success Criteria

- [ ] Flag registry is compile-time exhaustive (unknown key rejected)
- [ ] Admin CRUD RBAC-gated (member → 403, admin → 200)
- [ ] Cache invalidation on PUT proven by test
- [ ] Kill-switch on `email.enabled` proven: sign up while OFF → no
      email; sign up while ON → email lands
- [ ] Maintenance mode proven: /admin/flags PUT stays reachable to
      turn it OFF (bootstrap-recovery invariant)
- [ ] Writes-disabled proven: reads still succeed
- [ ] Percentage evaluator deterministic across 1000 iterations
- [ ] docs/control-plane.md walks through: adding a flag, using it,
      operating maintenance mode, rotating a kill switch

## Risk Assessment

- **Cache-write ordering** (same as SettingsService H2): fast reader
  can race a write and cache the pre-write value. Mitigation:
  documented residual window; short KV TTL (5min) bounds max
  staleness. For maintenance mode, this means a bad rollout stays
  live for up to 5min in one region on the worst path — acceptable
  vs. the alternative of an SDK.
- **Flag misconfig lockout**: turning on `system.maintenance_mode`
  without the `/admin/flags/*` exemption would brick the app.
  Mitigation: exemption is hard-coded in the middleware, not
  configurable. Integration test locks it in.
- **Registry drift**: a flag defined in code but no D1 row → returns
  the registry default. Same discipline as settings (seed migration
  per flag). Documented.
- **Percentage hash collision**: SHA-256 of `principalId + flagKey`
  buckets user 0/100. If a future flag uses the same key across two
  populations, both cohorts get the same bucket. Not a bug per se
  but worth documenting.
- **Kill-switch audit spam**: `email.enabled=false` while under
  signup traffic could emit hundreds of audit lines per minute.
  Mitigation: 1/min rate limit on that specific audit event
  (implementation: a module-scoped `lastLoggedAt` timestamp in the
  email adapter).
