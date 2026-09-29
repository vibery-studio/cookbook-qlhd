# Runway Docs

Navigation for the blueprint's documentation. Every doc is
self-contained; read in any order.

## Start here

- [../README.md](../README.md) — 5-min quickstart
- [architecture.md](./architecture.md) — layer diagram, port/adapter
  boundaries, DAO/DTO flow

## Domain deep-dives

- [auth.md](./auth.md) — password auth, JWT + refresh CAS, CSRF
  stack, max-time-to-revoke
- [rbac.md](./rbac.md) — permission catalog, ownership pattern,
  cache invalidation
- [email.md](./email.md) — Resend + noop adapters, retry queue,
  DLQ, cron sweeper
- [settings.md](./settings.md) — typed registry, KV cache, admin CRUD
- [idempotency.md](./idempotency.md) — CAS middleware, header
  format, DLQ hand-off
- [audit.md](./audit.md) — event catalog, sync-vs-async policy,
  deepScrub
- [observability.md](./observability.md) — Logpush, error
  reporter, security headers, rate limits, /readyz
- [deploy.md](./deploy.md) — migrations, rollback playbook
- [dao-pattern.md](./dao-pattern.md) — DAO/DTO contract, drizzle
  usage rules

## Recipes (extension points)

- [recipes/add-resource.md](./recipes/add-resource.md) — the
  10-step "add a new resource" walkthrough
- [recipes/add-money.md](./recipes/add-money.md) — Dinero.js
  integration (v2)
- [recipes/add-audit-store.md](./recipes/add-audit-store.md) —
  durable D1 audit log (v2)
- [recipes/add-ses-adapter.md](./recipes/add-ses-adapter.md) —
  Amazon SES via aws4fetch (v2)

## Golden path smoke tests

- [bruno/README.md](./bruno/README.md) — Bruno collection covering
  CSRF, auth, RBAC, idempotency invariants
