---
title: "Phase 8: System Settings Module"
status: completed
---

# Phase 8: System Settings Module

## Overview

Runtime-mutable, admin-editable, typed configuration store — **scoped tightly** (Red Team F14): only values that a human operator would legitimately change without a redeploy live here. All boot-time knobs (auth TTLs, password rules, rate-limit thresholds) live in Zod-parsed `Env` and require a redeploy to change. `SettingsPort.get<T>(key, schema)` reads KV cache (5min TTL) → D1 fallback → Zod-validates → returns typed value. `SettingsPort.set(key, value, actor)` writes D1, busts KV, records SYNC audit event. Admin API `GET/PUT /admin/settings/:key` with `settings:read`/`settings:write` permissions. Seed migration inserts v1 defaults. **No `scope` column** (multi-tenant is a v2 migration; Red Team F14).

## Requirements

- Functional
  - [ ] `settings.get('email.from_address')` returns validated string; falls back to registered default when row absent
  - [ ] `settings.set(key, value, actor)` validates value against registry schema, upserts D1, busts KV, calls `logger.audit(..., {sync:true})`
  - [ ] Unknown keys rejected at compile-time (typed catalog) AND runtime (registry lookup)
  - [ ] `GET /admin/settings` → list all keys with current values
  - [ ] `GET /admin/settings/:key` → single value
  - [ ] `PUT /admin/settings/:key { value }` → 200 with updated value; 422 on schema violation
  - [ ] Seed migration inserts v1 defaults so blueprint runs without post-setup steps
- Non-functional
  - [ ] KV cache TTL 300s; `settings.set` triggers immediate cache bust
  - [ ] All settings JSON-serializable
  - [ ] Registry contains ONLY runtime-mutable operational values (email from/name in v1)

## Architecture

```
apps/api/src/
├── settings/
│   ├── registry.ts             # SETTINGS_REGISTRY: Record<key, {schema, default, description}>
│   ├── settings-port.ts        # interface
│   ├── settings-service.ts     # implements port: KV → D1 → registry default
│   └── keys.ts                 # export const SETTING_KEYS = [...] as const
├── dao/
│   └── settings-dao.ts
└── routes/
    └── admin-settings.routes.ts # mounted under /admin/settings

apps/api/src/db/migrations/
└── 000X_seed_settings.sql       # inserts registry defaults (no scope column)
```

**Registry (v1 — minimal, runtime-mutable only):**

```ts
export const SETTINGS_REGISTRY = {
  'email.from_address': {
    schema: z.string().email(),
    default: 'no-reply@example.com',
    description: 'From address on all outbound emails',
  },
  'email.from_name': {
    schema: z.string().min(1).max(64),
    default: 'Runway',
    description: 'From name on all outbound emails',
  },
} as const;

export type SettingKey = keyof typeof SETTINGS_REGISTRY;
```

**Removed from registry (moved to env, require redeploy):**

- `auth.access_token_ttl_seconds` → hard-coded 120s in Phase 5 (mid-flight changes surprise users)
- `auth.refresh_token_ttl_seconds` → hard-coded 604800s
- `auth.password_min_length` → `env.PASSWORD_MIN_LENGTH` (Zod-parsed at boot)
- `rate_limit.auth_login_per_minute` → `env.RATE_LIMIT_AUTH_LOGIN` (Zod-parsed at boot); Cloudflare `[[ratelimits]]` binding is static per deploy anyway (see P10) — dual source-of-truth resolved

**Read path:**

```
get(key) →
  cache.get(`setting:${key}`) → hit? parse+return
  d1.select where key=? → row? parse+return + cache.set(TTL 300)
  → registry.default
```

**Write path (SYNC audit):**

```
set(key, value, actor) →
  registry[key].schema.parse(value)  // throws on invalid
  d1.upsert(key, JSON.stringify(value), now, actor)
  cache.delete(`setting:${key}`)
  logger.audit({actor, action:'settings.update', target:`settings:${key}`, metadata:{newValue: value}}, {sync: true})
```

## Related Code Files

- Create: `apps/api/src/settings/{registry,settings-port,settings-service,keys}.ts`
- Create: `apps/api/src/dao/settings-dao.ts`
- Create: `apps/api/src/routes/admin-settings.routes.ts` (mount into admin.routes.ts)
- Create: `apps/api/src/db/migrations/000X_seed_settings.sql` (no scope column)
- Modify: `apps/api/src/env.ts` — Zod-parse `PASSWORD_MIN_LENGTH`, `RATE_LIMIT_AUTH_LOGIN`, `RATE_LIMIT_AUTH_SIGNUP` at boot
- Modify: `apps/api/src/index.ts` — instantiate `SettingsService`, put on context via middleware `c.set('settings', service)`
- Modify: `apps/api/src/services/email-service.ts` (P7) — replace env fallback with `settings.get('email.from_address')`
- Modify: `apps/api/src/services/auth-service.ts` (P5) — read `env.PASSWORD_MIN_LENGTH` (NOT via settings)

## Implementation Steps

1. **TDD registry + service (unit-testable with in-memory KV+D1 mocks):**
   - Failing test: `get('email.from_address')` returns default when no row; returns row value when present; caches; busts on set
   - Failing test: `set` rejects invalid value; accepts valid; records audit SYNC
2. Implement `registry.ts` with `as const` typed record (2 keys only)
3. Implement `SettingsService` with KV binding + D1 client
4. Implement `settings-dao.ts` (upsert with `ON CONFLICT(key) DO UPDATE`)
5. Write migration — for each registry key, `INSERT OR IGNORE` row with default value
6. Wire `SettingsService` in `index.ts` via middleware attaching to context
7. Rewire P7 email-service to read from settings; auth-service reads `env.PASSWORD_MIN_LENGTH`
8. Implement admin routes:
   - `GET /admin/settings` → array of `{key, value, description, updatedAt}`
   - `GET /admin/settings/:key` → single
   - `PUT /admin/settings/:key { value }` → validates via registry, upserts, returns updated
9. Integration test:
   - `PUT /admin/settings/email.from_address` as admin → 200
   - Signup after change → noop email has new from-address
   - Non-admin → 403
   - Invalid value → 422 problem+json with schema error
   - Unknown key → 404

## Todo

- [ ] Registry with typed keys and Zod schemas (v1: 2 email keys only)
- [ ] SettingsService with KV cache + D1 fallback + default
- [ ] Seed migration idempotent
- [ ] Admin CRUD routes enforced by RBAC (`settings:read`, `settings:write`)
- [ ] Cache invalidation on write proven in test
- [ ] Email service consumes settings; auth service uses env
- [ ] SYNC audit event fired on every write
- [ ] Env Zod parser rejects invalid `PASSWORD_MIN_LENGTH` / rate-limit values at boot

## Success Criteria

- [ ] `SettingsService` tests green with in-memory mocks
- [ ] Bruno test: change from-address → next signup uses new address (verified via noop buffer)
- [ ] Setting unknown key → 404 problem+json
- [ ] Setting invalid value → 422 with Zod errors (no `received` leakage — Phase 4 error map)
- [ ] Second GET within TTL served from KV (debug log verifies in test)

## Risk Assessment

- **Cache staleness across regions:** KV eventual consistency ~60s. For only 2 email keys this rarely matters; document.
- **JSON serialization edge cases:** All setting values must be JSON-serializable; enforced by Zod schemas (no `Date`, `BigInt`, `Function`).
- **Registry drift on rename:** Renaming a setting key requires a migration and a code change; document the pattern in `docs/settings.md` (add new key + copy value + deprecate old).
- **v2 multi-tenant scope:** Not activated in v1. Adding `scope` column is a straightforward v2 migration + service-level scope resolver.
