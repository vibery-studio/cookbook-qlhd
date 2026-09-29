# e2e kit: browser tests for the UI row (proven in the 2026-09-29 rehearsal, row 4)

Copy, don't rebuild. Row 4 spent most of its PLAN building this harness; it is here ready.

| File | Goes to | Adapt |
|---|---|---|
| `playwright.config.ts` | `apps/web/playwright.config.ts` | port (8791; 8788 may be taken), nothing else |
| `global-setup.ts` | `apps/web/e2e/global-setup.ts` | `USERS` role ids = the roles your row 1 created; the Bên B settings keys; `seedContracts()` = one row per status you need |
| `fixtures.ts` | `apps/web/e2e/fixtures.ts` | the sidebar labels |

What it gives: its own `wrangler dev` + its own D1 data dir (never touches `pnpm dev` data) · migrations applied fresh each run ·
3 role accounts seeded through the real API, one saved login each (no login rate-limit burn) · `pageAs(browser, role)`.
Needs: `@playwright/test` (1.63.0) as a devDependency of `apps/web`, script `"e2e": "playwright test"`, `apps/api/.dev.vars`.

## UI proof budget (keep row 4 inside its slot)
- ONE spec: the §7 World checklist clicked through by the 3 roles (desktop). ONE mobile smoke (390 px: menu opens, list readable, no horizontal scroll).
- Design law is checked by eye on 3 screenshots (list · contract drawer · paper), not by pixel assertions.
- Run the e2e ONCE at PROOF (serial API tests first, then e2e; never both at once).
- No screenshot-review polish loop: visual nits go into the PROOF log as a list for the next row.

## Where row 4 lost its time (measured 2026-09-29) → rules
- **Waiting on ports** (one `lsof` poll loop = 6.7 min): never poll. Run `bash docs/cookbook/e2e-kit/free-ports.sh [ports]` once; a port still busy belongs to another project → use another port.
- **Slow red runs** (140 s each: failing tests waited the 60 s timeout): the config fails fast (expect/action 5 s, test 30 s). Watch it fail ONCE.
- **Repeat runs** (13 green runs + 3 stability + 4 screenshot re-runs): screenshots are taken INSIDE the one PROOF run (`PROOF_SHOTS=1`); no stability re-runs.
- **Contention** (API suite + e2e together = one 10-min block, port exhaustion): serial — API suite, then e2e.
