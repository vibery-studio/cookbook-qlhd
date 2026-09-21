---
title: "Runway v1.1 — deploy safety, control plane, privacy, dx harness, typed client"
description: "Ship the operational essentials Codex flagged as missing from v1.0: a real deployment safety gate, an operational control plane (flags + maintenance + write circuit), a privacy lifecycle module (GDPR export/deletion), a local-dev test-fixture harness, and a generated typed OpenAPI client. Everything is scoped to preserve v1's YAGNI/KISS/DRY discipline; each phase closes a gap that every serious product would otherwise re-invent poorly."
status: pending
priority: P1
effort: "5-7 days end-to-end"
tags: [v1.1, essentials, ops, privacy, dx, contracts]
created: 2026-09-21
---

# Runway v1.1 — deploy safety, control plane, privacy, dx harness, typed client

## Overview

v1.0 shipped clean request-level correctness (auth, RBAC, email, settings,
idempotency, audit, observability). Codex's external review flagged five
operational gaps that every serious product would otherwise re-invent under
pressure. This plan closes them without expanding v1's YAGNI perimeter:

1. **Deploy safety gate** — the deploy workflow currently doesn't run the
   schema-head + `/readyz` verifications the docs promise. Close the paper-
   vs-operational-safety gap.
2. **Operational control plane** — feature flags, maintenance mode, and a
   write circuit-breaker so a bad rollout can be stopped without a code
   deploy. Settings ≠ flags.
3. **Privacy lifecycle** — GDPR-shaped account export + deletion pipeline
   with a data retention registry per DAO. Every new consumer will otherwise
   hit their first erasure request unprepared.
4. **Local-dev + test fixture harness** — `createMember()` / `loginAs()` /
   `readSentEmail()` helpers so consumer tests stay short and every new
   product doesn't hand-roll seed logic.
5. **Generated typed OpenAPI client** — finish the OpenAPI loop with a
   published TS client package; consumers get compile-time API integration
   without duplicating Zod types.

The four YAGNI callouts from Codex's review are explicitly out of scope:
multi-tenancy, OAuth adapter, workflow engine, analytics stack.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Every production deploy is gated by schema-head + readyz + smoke; automatic rollback on failure | P1 |
| 2 | Ship the control-plane primitives that let an operator stop damage without a deploy | P1 |
| 3 | Every DAO-owned data type declares its retention/exportability policy; ship account export + deletion pipelines | P1 |
| 4 | New products' integration tests use fixture helpers, not hand-rolled seed logic | P2 |
| 5 | OpenAPI is the single source of truth; consumers get a typed TS client at compile time | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Deploy Safety Gate](./phase-01-deploy-safety-gate.md) | Completed (local orchestrator) |
| 2 | [Phase 2: Operational Control Plane](./phase-02-operational-control-plane-flags-maintenance-write-circuit.md) | Completed |
| 3 | [Phase 3: Privacy Lifecycle Module](./phase-03-privacy-lifecycle-module-export-deletion-retention.md) | Completed |
| 4 | [Phase 4: Local-Dev + Test Fixture Harness](./phase-04-local-dev-test-fixture-harness.md) | Completed |
| 5 | [Phase 5: Generated Typed Client from OpenAPI](./phase-05-generated-typed-client-from-openapi.md) | Pending |

## Success Criteria

- [ ] `pnpm deploy:prod` (or dispatch workflow) runs config-validate → recovery-point → migrations → deploy → readyz smoke → auto-rollback on failure
- [ ] Flag registry + admin CRUD + evaluator with deterministic hashing; kill-switch on email delivery proven in test
- [ ] Global maintenance mode blocks state-changing routes with consistent 503; allow-list preserves ops + `/healthz`
- [ ] Account export returns a signed JSON archive; deletion pipeline revokes sessions, honors grace window, emits an immutable completion audit event
- [ ] Every DAO carries a retention/exportability annotation; sweeper enforces retention where declared
- [ ] `pnpm dev:reset` restores canonical state in <30s; `createMember({ role: 'admin' })` returns a logged-in cookie in an integration test
- [ ] `@runway/client` package exports typed `signup`, `login`, `me`, `admin.listUsers`, `demo.createNote` (+ Problem types) generated from `openapi.json`; CI fails when the generated client drifts from the spec
- [ ] All prior 191 tests still pass; +50 new tests across the five phases
- [ ] Bundle size still under 900KB gzipped
- [ ] Docs updated: `docs/deploy.md`, `docs/control-plane.md`, `docs/privacy.md`, `docs/dev-harness.md`, `packages/client/README.md`

## Non-Goals (YAGNI callouts)

Explicitly deferred beyond v1.1:

- Multi-tenancy (scope column, tenant-scoped queries, per-tenant KV, etc.)
- OAuth/social login adapter
- Generic durable workflow engine
- Analytics/CDP stack, product-event pipeline
- Generic admin UI
- Per-customer flag experimentation analytics
- `@sentry/cloudflare` withSentry HOC wiring (scaffold already in place; still deferred pending real-DSN validation)

## Dependencies + Sequencing

Phases can execute mostly-independently; recommended order:

1. **Phase 1 first** — small, closes an honest gap, low blast radius. Warm-up.
2. **Phase 2 in parallel with Phase 3** — different files; both write to admin routes but different subtrees.
3. **Phase 4 second-to-last** — depends on none of the above but delivers the biggest DX win when built after the other phases have their tests.
4. **Phase 5 last** — needs the OpenAPI spec to be stable, which it is post-Phases 1-3.

Each phase closes with `pnpm typecheck && pnpm lint && pnpm test` + code-reviewer subagent, per the v1 discipline.

<!-- slug: runway-v11-deploy-safety-control-plane-privacy-dx-harness-typed-client -->
