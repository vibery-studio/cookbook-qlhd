# Runway

A members-only Cloudflare Workers blueprint. Ships auth, RBAC,
email pipeline, runtime-mutable settings, idempotency + audit
logging, observability, and security hardening — all wired,
tested, and documented from day one.

Start a new members-only product without re-solving these problems:

- Password auth (scrypt + JWT + refresh CAS)
- RBAC (typed catalog + Hono middleware)
- Email (React Email templates + Resend + retry queue + cron backstop)
- System settings (typed registry + KV cache + admin API)
- Idempotency (CAS + DLQ handoff)
- Structured audit logging
- Rate limits, security headers, split health probes, cron pruners

## 5-minute quickstart

```bash
# 1. Clone + install
git clone <this-repo> && cd runway
pnpm bootstrap

# 2. Wrangler auth (one-time)
wrangler login

# 3. Local dev + tests
pnpm dev              # http://localhost:8787
pnpm test             # 191 tests + 2 skipped

# 4. Open the golden path
bru run docs/bruno --env local
```

**Prereqs**: Node 22, pnpm 10.28+, `wrangler login`. Budget those
separately.

## What's inside

```
apps/api                     Cloudflare Workers app
├── src/
│   ├── routes/              signup, verify, login, refresh, logout, me,
│   │                          admin/users, admin/settings/*, demo/notes,
│   │                          healthz, readyz
│   ├── middleware/          requireAuth, requireOrigin, requireFetchHeader,
│   │                          requirePerm, withIdempotency, rateLimit,
│   │                          securityHeaders, logger, error-handler
│   ├── services/            auth-service, admin-service, email-service
│   ├── settings/            SettingsService (typed registry)
│   ├── dao/                 pure functions returning DTOs — no BaseDao
│   ├── ports/               EmailPort, ErrorReporterPort
│   ├── adapters/            noop + resend + retry-wrapped email; noop + sentry-scaffold reporters
│   ├── crons/               verify-email sweeper, nightly expired-rows pruner
│   └── queues/              email-retry + DLQ consumers
├── db/schema.ts             drizzle-orm — 12 tables + settings + notes
└── db/migrations/           SQL migrations 0000–0004

packages/
├── auth                     scrypt, jose HS256 JWT, HMAC token hashing, URL sanitizer, timing-safe compare
├── rbac                     pure policy engine + Hono middleware factory
├── email-templates          React Email + Zod prop schemas + URL allowlist
├── contracts                exported OpenAPI JSON
├── config                   shared ESLint / tsconfig / vitest config
└── (money & audit-store)    NOT included in v1; recipes in docs/recipes/
```

## Where to go from here

New engineer? Start with **[docs/index.md](./docs/index.md)** — it
lists every domain doc plus the recipes for extending the
blueprint.

Skipping ahead:

- **Add a resource** (notes, orders, whatever): [docs/recipes/add-resource.md](./docs/recipes/add-resource.md)
- **Add a permission**: [docs/rbac.md](./docs/rbac.md) → §"Adding a permission"
- **Add an email template**: [docs/email.md](./docs/email.md) → §"Templates"
- **Configure Sentry / Logpush**: [docs/observability.md](./docs/observability.md)
- **Deploy to prod**: [docs/deploy.md](./docs/deploy.md)

## Design principles

- **Ports & adapters**: every external system (email, error reporter,
  even KV cache) hides behind a port so tests inject fakes.
- **DAO returns DTOs**: no leaking drizzle row types past `src/dao/`.
  Rules enforced by ESLint + `docs/dao-pattern.md`.
- **Explicit env-vs-settings split**: security-critical values live
  in env (Zod-parsed at boot, redeploy to change). Operational
  values live in settings (typed registry, mutable via
  `PUT /admin/settings/:key`).
- **Application-level cascade**: no PRAGMA foreign_keys (D1 unreliable);
  DAO helpers batch dependent deletes in one atomic transaction.
- **YAGNI over DRY**: three similar lines beat one leaky abstraction.
  If a shape emerges twice, keep both. Extract on the third.

## CI/CD

- PR: lint / typecheck / test / OpenAPI diff / bundle-size gate /
  secret scan (gitleaks). No preview deploy by default — enable
  when needed.
- Nightly: dep audit + secret scan
- Prod deploy: manual dispatch only

Full workflow map: [docs/ci.md](./docs/ci.md) (coming soon).

## Tests

- 27 email-templates (URL allowlist, XSS, deterministic render)
- 37 auth (password, JWT, tokens, origin, timing-safe compare)
- 17 rbac (policy + middleware)
- 3 config (shared ESLint rules)
- 99 api (integration + unit; auth flow, RBAC flow, idempotency,
  settings, email sweeper, /readyz, security headers, DLQ hand-off,
  cron pruner)
- 2 skipped (require production-env override)

## License

UNLICENSED — All rights reserved.
