# System Settings (Phase 8)

Runtime-mutable, admin-editable, typed configuration. Values here can
be changed by an operator via `PUT /admin/settings/:key` **without a
redeploy**. Anything that would break running requests when changed
mid-flight (auth TTLs, password rules, rate-limit thresholds) lives
in `env` and is Zod-parsed at boot instead.

## Model

- **Registry** (`apps/api/src/settings/registry.ts`): closed set of
  typed keys with per-key Zod schema, default, and description.
- **Storage**: single `settings` table (`key` PK, `value` TEXT
  JSON-serialized, `updated_at`, `updated_by`).
- **Cache**: KV (`env.SETTINGS`) with 5-minute TTL. Write path
  deletes the cache entry before the audit log so the next reader
  never races on a stale value.
- **No `scope` column in v1** — multi-tenant is a v2 migration.

## Read path

```
settings.get(key)
  ↓ KV: `setting:<key>`     — hit → parse+return
  ↓ D1: SELECT WHERE key=?  — hit → Zod-validate → cache → return
  ↓ registry default        — no D1 row → return default
```

Zod validation on the D1 hit is intentional: if a legacy row's value
no longer matches the current schema (e.g., schema tightened after
the row was written), `get` throws. Loud failure is preferred to
silently continuing with a bogus value.

## Write path

```
settings.set(key, value, actor)
  ↓ Zod-parse against registry schema (throws on invalid)
  ↓ D1 upsert (INSERT ... ON CONFLICT(key) DO UPDATE)
  ↓ KV delete (`setting:<key>`)
  ↓ SYNC audit log (console.log for v1; Phase 9 → real audit sink)
```

`updated_by` is the actor's ULID (the authenticated admin's principal
id). Seed rows carry `updated_by = NULL` so operator tooling can
distinguish "never touched" from "explicitly set back to default".

## v1 registry

| Key | Schema | Default | Description |
|-----|--------|---------|-------------|
| `email.from_address` | `z.string().email()` | `no-reply@example.com` | From address on outbound emails |
| `email.from_name` | `z.string().min(1).max(64)` | `Runway` | From name on outbound emails |

Both are consumed by the Resend adapter selector (Phase 7). Changing
either takes effect on the next send after the KV cache TTL or the
next `settings.set` (whichever comes first) — because the adapter is
built per-request in `email-with-retry.ts`, a value change propagates
to Resend on the very next request that resolves the cache miss.

## Adding a key

1. Add an entry to `SETTINGS_REGISTRY` with `schema`, `default`,
   `description`. Type inference at call sites updates automatically
   (return type of `settings.get<K>` is `z.infer<schema>`).
2. Add a seed row to a new migration:
   ```sql
   INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by)
     VALUES ('your.key', '"default"', 0, NULL);
   ```
3. Callers use `await settings.get('your.key')`.

Adding to D1 without adding to the registry leaves the value
unreachable from typed code — the registry is the source of truth
for what keys exist.

## Renaming a key

Renames are two migrations:

1. Add the new key + a copy of the current value; leave the old key
   in place.
2. After all callers are updated, delete the old key.

**Never rename by replacing the row's `key` column** — mid-deploy
requests can hit either the old or new code, and losing the row
mid-transition means falling back to the default.

## Admin API

- `GET /admin/settings` — array of `{key, value, description,
  updated_at, updated_by}` (requires `settings:read`).
- `GET /admin/settings/:key` — single snapshot; 404 for unknown
  keys.
- `PUT /admin/settings/:key {"value": ...}` — Zod-validates,
  upserts, returns snapshot. 404 on unknown key, 422 on schema
  failure, 200 on success. Requires `settings:write`.

All routes use the same auth flow as other admin endpoints
(`requireAuth` → `requirePerm`). Anonymous requests get 401 via
`requireAuth`; authenticated non-admins get 403 via `requirePerm`.

## Testing

- `apps/api/test/integration/settings-flow.test.ts` — service unit
  (get default / roundtrip / invalid rejection / list) + admin route
  suite (RBAC, 404, 422, 200 round-trip).

## KV consistency

Cloudflare KV has ~60s eventual consistency across regions. For the
v1 keys (email from-address/from-name), stale values in one region
for a minute after a change is acceptable — the worst case is a
handful of emails go out with the previous from-address. If a future
key needs strict global consistency, put it in `env` (redeploy-only)
instead.

## Values NOT in the registry (env-only)

| Env var | Zod-parsed at boot | Redeploy required |
|---------|---------------------|-------------------|
| `PASSWORD_MIN_LENGTH` | yes | yes |
| `RATE_LIMIT_AUTH_LOGIN` | yes | yes |
| `RATE_LIMIT_AUTH_SIGNUP` | yes | yes |
| `JWT_SECRET`, `TOKEN_PEPPER`, `READYZ_TOKEN` | yes | yes (rotate via secret) |
| Auth TTLs (access, refresh, verify) | hard-coded in `auth-service.ts` | yes (code change) |

Runtime-mutable authentication knobs would let an operator lock
users out mid-request; the redeploy cost is a feature, not a bug.
