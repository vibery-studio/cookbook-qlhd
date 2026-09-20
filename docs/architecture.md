# Architecture

Layer diagram + boundary rules. Read this once when landing on the
blueprint; refer back when adding features.

## Request flow

```
                      ┌─────────────────────────────┐
   HTTPS request  ──► │ Cloudflare Worker (isolate) │
                      └─────────────────────────────┘
                                    │
                                    ▼
                      ┌──────────────────────────────┐
                      │ Hono OpenAPIHono app          │
                      │  buildApp(env) per request    │
                      └──────────────────────────────┘
                                    │
                                    ▼
   ┌───────────── Global middleware chain ─────────────────┐
   │  requestId → logger → securityHeaders → requireOrigin │
   │  → requireFetchHeader                                 │
   └───────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌──────────── Per-route middleware ─────────────────────┐
   │  bodyLimit → requireAuth → requirePerm → rateLimit    │
   │  → withIdempotency                                    │
   └───────────────────────────────────────────────────────┘
                                    │
                                    ▼
                   ┌──────────────────────────────┐
                   │ Route handler (openapi.get)  │
                   └──────────────────────────────┘
                                    │
                                    ▼
                   ┌──────────────────────────────┐
                   │ Service (business logic)     │
                   │  ─ auth-service              │
                   │  ─ admin-service             │
                   │  ─ email-service             │
                   │  ─ settings-service          │
                   └──────────────────────────────┘
                                    │
                                    ▼
                   ┌──────────────────────────────┐
                   │ DAO (pure functions → DTOs)  │
                   │  no drizzle types leak out   │
                   └──────────────────────────────┘
                                    │
                                    ▼
                   ┌──────────────────────────────┐
                   │ Cloudflare bindings          │
                   │  D1 (SQL) ─ KV ─ Queue ─ RL  │
                   └──────────────────────────────┘
```

Adjacent paths:

- **Ports & adapters** — `EmailPort` + `ErrorReporterPort` invert
  the dependency so tests inject fakes and env drives selection.
- **Cron handlers** live in `apps/api/src/crons/*` and are
  dispatched from `scheduled()` in `index.ts` by matching
  `event.cron`.
- **Queue handlers** live in `apps/api/src/queues/*` and receive
  batches from `queue()` in `index.ts`.

## Layer contracts

| Layer | May depend on | MUST NOT depend on |
|-------|---------------|--------------------|
| Route (`src/routes/*`) | middleware, service, DTO, Zod, Hono | drizzle, D1, KV directly |
| Middleware (`src/middleware/*`) | DTO, ports (via factory), Hono | routes, services |
| Service (`src/services/*`) | DAO, ports, DTO | Hono context, `c.req`, `c.res` |
| DAO (`src/dao/*`) | drizzle, schema, DTO | Hono, services, KV directly (session-cache exception) |
| Port (`src/ports/*`) | pure types | anything else |
| Adapter (`src/adapters/*`) | ports, external SDKs | services, DAO |

The Hono context (`c`) stays inside routes + middleware. Services
receive plain data + a `deps` bag; they cannot reach `c.req` or
`c.res` — this is what makes them unit-testable outside of
miniflare.

## DAO/DTO discipline

DAO functions:

1. Take a `Db` + input parameters.
2. Return a DTO — plain interface, no drizzle types.
3. Handle application-level cascade via `db.batch([...])`.

Anti-patterns (ESLint-enforced):

- No `BaseDao` class hierarchy.
- No `drizzle.$inferSelect` leaking past the DAO file.
- No cross-layer imports (services can't import from routes;
  middleware can't import from services).

Full contract: [dao-pattern.md](./dao-pattern.md).

## Env vs Settings split

**Env** (Zod-parsed at boot, redeploy to change):

- Secrets: `JWT_SECRET`, `TOKEN_PEPPER`, `READYZ_TOKEN`, `RESEND_API_KEY`
- Security thresholds: `PASSWORD_MIN_LENGTH`, `RATE_LIMIT_*`
- Auth TTLs: hard-coded constants in `auth-service.ts` (change
  requires code review)

**Settings** (runtime-mutable via `PUT /admin/settings/:key`):

- Operational values that a human operator legitimately changes
  without a redeploy: currently `email.from_address` and
  `email.from_name`

The dividing line: could an operator change this and lock out
users mid-request? If yes, it's env. Reasoning:
[settings.md#values-not-in-the-registry](./settings.md).

## Boundary invariants

1. **No secrets in logs.** All structured logs run through
   `deepScrub` (recursive, case-insensitive denylist).
2. **RFC 7807 Problem+JSON on every 4xx/5xx.** Never leak stack
   traces in production (env-gated in `error-handler.ts`).
3. **Application-level cascade.** D1 `PRAGMA foreign_keys` isn't
   reliable across HTTP-fronted statements; DAO helpers batch
   dependent deletes.
4. **CAS everywhere writes are races.** Refresh token rotation,
   verification token consume, idempotency sentinel — all use
   `UPDATE ... WHERE ... RETURNING` or `INSERT OR IGNORE`.
5. **Sync audit on security-critical events.** Reuse detection,
   settings updates, admin role changes, DLQ arrivals: audit line
   lands in Logpush before the response returns.
6. **URLs from user input pass an allowlist.** No `javascript:`,
   `data:`, relative, or off-origin URLs in rendered emails.

## Package boundaries

Workspace layout:

- **`apps/api`** — the Worker. All routing + wiring lives here.
- **`packages/auth`** — pure crypto primitives (scrypt, JWT,
  HMAC, URL sanitizer, timing-safe compare). Zero external deps
  beyond `jose` + `@noble/hashes`.
- **`packages/rbac`** — pure policy engine + Hono middleware
  factory. Only `hono` peer dep.
- **`packages/email-templates`** — React Email components + Zod
  prop schemas + URL allowlist. Only `react` + `@react-email/*`
  + `zod`.
- **`packages/contracts`** — exported OpenAPI JSON (build artifact).
- **`packages/config`** — shared ESLint / tsconfig / vitest
  configs. Consumed by every other package.

## Extension points

Each `port` in `apps/api/src/ports/*` is an extension seam. Add a
new adapter by implementing the interface, then swap it in via
env-driven selection (`selectEmailAdapter`,
`selectErrorReporter`).

Adding a resource: [recipes/add-resource.md](./recipes/add-resource.md).
