# Runway

A members-only Cloudflare Workers monorepo blueprint: pnpm + Turborepo, Hono API,
D1/KV/Queues, GitHub Actions CI/CD with preview environments per PR.

## What is Runway

Runway is a production-ready starting point for a Cloudflare Workers backend.
It ships with lint/typecheck/test/build pipelines, a Wrangler-based `apps/api`
skeleton, and CI/CD (PR preview deploys, prod deploy, nightly security scans)
wired from commit 1. See the architecture and phased build-out in
[`plans/260920-1359-runway-blueprint-v1-api`](./plans/260920-1359-runway-blueprint-v1-api).

## Prerequisites

- Node 22 (`.nvmrc` pinned)
- pnpm 10.28.2 (`corepack enable` recommended)
- A Cloudflare account, then `wrangler login`

Pre-req install time (Node/pnpm/wrangler + Cloudflare account + `wrangler login`)
is not included in the bootstrap time below — budget it separately on a fresh
machine.

## Bootstrap

```bash
pnpm bootstrap
```

Installs all workspace dependencies and builds every package. Target: under
5 minutes once `wrangler login` is already done. Actual timing (hardware,
network baseline) is recorded when first measured against a clean clone.

## Development

```bash
pnpm dev
```

Runs `wrangler dev` for `apps/api` with local D1/KV bindings.

## Testing

```bash
pnpm test
```

Runs Vitest (Node) and `vitest-pool-workers` (workerd) across the workspace.

## Build

```bash
pnpm build
```

Builds every package via Turborepo, respecting `dependsOn` ordering. CI fails
the build if the compressed `apps/api/dist` bundle exceeds 900KB.

## Lint & Typecheck

```bash
pnpm lint
pnpm typecheck
```

Shared ESLint (typescript-eslint recommended-type-checked) and strict
TypeScript config live in `packages/config`.

## Architecture

See the phase plans under
[`plans/260920-1359-runway-blueprint-v1-api`](./plans/260920-1359-runway-blueprint-v1-api)
for the full monorepo layout, CI/CD workflows, and binding contracts.

## License

UNLICENSED — All rights reserved.
