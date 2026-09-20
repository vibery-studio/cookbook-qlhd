# Bruno Collection — Runway Golden Path

Smoke tests that hit the running Worker over HTTP. Complements the
in-process integration tests (which use `SELF.fetch` from
`cloudflare:test`) by exercising the CSRF stack, cookies, and
security headers as a real HTTP client sees them.

## Prereqs

- [Bruno CLI](https://docs.usebruno.com/bru-cli/overview): `npm i -g @usebruno/cli`
- Worker running locally: `pnpm --filter @runway/api dev` (defaults to `http://localhost:8787`)

## Run

```bash
cd docs/bruno
bru run --env local
```

The `local` env expects the Worker at `http://localhost:8787` with
the default dev secrets from `apps/api/.dev.vars.example`. A
`preview` env can be added when preview deploys are wired.

## What the collection covers

- **Healthz** shallow probe (public, no external calls)
- **CSRF stack**: refuses mutating requests without `Origin` +
  `X-Requested-With: fetch`
- **Signup** happy path returns 201 + user_id
- **/me** unauth path returns 401
- **/admin/users** unauth path returns 401
- **/readyz** without token returns 401
- **Idempotency middleware**: unauth+header → 401 (auth first);
  invalid header format → 422

## What it deliberately doesn't cover

- End-to-end verify → login → cookie flow (requires the noop email
  buffer, which is process-local; integration tests own this)
- Rate-limit trip (dev-env bypasses rate limits so tests remain
  reliable; verified by unit tests in
  `apps/api/test/observability/`)
- Concurrent race scenarios (integration tests own this via
  `Promise.all`)

## Add a request

```bash
bru create request my-new-check
```

Then edit the `.bru` file. Every request should include a `docs`
block explaining what invariant it guards.
