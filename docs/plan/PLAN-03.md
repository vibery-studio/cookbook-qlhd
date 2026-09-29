# PLAN-03: Vòng đời hợp đồng — tạo, gửi duyệt, duyệt/từ chối, phát hành có số, hủy + thay thế

Status: Approved 2026-09-29
Spec: docs/spec/SPEC-03.md · Roadmap: ROADMAP-01 row 3 · builds on row 02 (`template_versions`, `getTemplateVersionById`, `getCurrentVersion`)

## 1. Acceptance tests — written first, seen failing
File: `apps/api/test/integration/contracts-acceptance.test.ts` (35 tests, one `it` per AC; AC id in the name). Compiles now
(`tsc --noEmit -p .` → 0 errors in the file; eslint clean). `contracts`/`approval_steps`/`price_list` edits only via raw SQL.
Clock: `vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true })` + `vi.setSystemTime` pins 28/09/2026 (and 30/06, 01/07,
31/12 17:30 UTC); after a jump the test re-logs in (120 s JWT). Red run: **red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised)** (central, `CI=true`).
Pure functions: `apps/api/test/domain/contract-*.test.ts`, written by C-03-002 against the signatures in that card.

| AC | How it's proven | Fails now? |
|---|---|---|
| AC-1 | `AC-1: draft_has_no_number` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-2 | `AC-2: issue_assigns_next_number` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-3 | `AC-3: series_is_per_type_and_year` (issue at 2026-12-31T17:30Z → HD-2027-001) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-4 | `AC-4: missing_required_field_refuses` (+ blank title, + customer without contact/phone/email → `ten_khach,sdt,email`) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-5 | `AC-5: optional_missing_field_allowed` (+ "Căn cứ" line when given, DEC-8 pair → 422) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-6 | `AC-6: server_prices_from_price_list_on_doc_date` (+ DEC-4 draft edit on 01/07 re-prices) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-7 | `AC-7: amount_math_is_integer` (API half) · unit: `test/domain/contract-pricing.test.ts`, `contract-words.test.ts` ("lẻ" 105.000), `contract-dates.test.ts` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-8 | `AC-8: snapshot_isolated_from_live_data` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-9 | `AC-9: creator_cannot_approve` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-10 | `AC-10: approval_is_per_document` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-11 | `AC-11: threshold_rule_selects_approval` · unit: `contract-policy.test.ts` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-12 | `AC-12: multi_step_in_order` (see risk 3) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-13 | `AC-13: submit_refused_when_no_eligible_approver` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-13b | `AC-13b: submit_needs_distinct_approvers` · unit: `contract-assignment.test.ts` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-13c | `AC-13c: one_person_one_step` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| DEC-10 | `DEC-10: would_block_later_step` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-14 | `AC-14: pending_is_locked` · `§4 two tabs: … 409 stale` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-15 | `AC-15: issued_is_immutable_void_keeps_number` (+ DEC-9 "ĐÃ HỦY" band, hash unchanged; copy twice → 409) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-16 | `AC-16: every_move_writes_one_audit_row` (+ no PII/amount in metadata) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-17 | `AC-17: idempotent_create_and_issue` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-18 | `AC-18: numbering race` (10 × Promise.all → `10|10|1|10`; 5 on one → `[200,409×4]`, MAX 10→11; tallies `console.log`ged for PROOF) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-19 | `AC-19: missing-field probe` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-20 | `AC-20: self-approval probe` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-21 | `AC-21: live-data probe` (rename + phone + new G6 price row) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-22 | `AC-22: template-edit probe` (v2 via `POST /templates/{id}/versions`) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-23 | `AC-23: replay probe` (`idempotency-replay: true`) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-24 | `AC-24: tamper probe` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-25 | `AC-25: approve-then-edit probe` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-26 | `AC-26: not logged in → 401 everywhere …` (13 endpoints; admin → 403) | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-27 | `AC-27: XSS` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-28 | `AC-28: /approvals/mine` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| AC-29 | `AC-29: GET /contracts filters …` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| §4 Two people (TODO(PLAN) of SPEC §8) | `§4 two people: approve and reject at the same moment …` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| §4 Failure (TODO(PLAN) of SPEC §8) | `§4 failure: dying between issue and saving the paper …` | red ✓ (2026-09-29: `Tests 35 failed (35)` — 34× 404 at /templates·/contracts (rows 02/03 not built), 1× `GET /contracts: expected 404 to be 401`; fake-Date risk 1 not yet exercised) |
| FR-10 | unit: `test/events/contract-events.test.ts` (listener throws → dispatch still resolves) | written by C-03-003 |

## 2. Files that change
| File | New / Modify | Why (FR) |
|---|---|---|
| `apps/api/src/db/schema.ts` + `migrations/<next>_*.sql` (+ custom SQL if drizzle can't express a CHECK/partial index) + `meta/*` | M / N | `contracts`, `approval_steps` (SPEC §3.1) |
| `apps/api/src/privacy/data-inventory.ts` | M | new tables classified (row-1 precedent) |
| `apps/api/src/domain/contract/{types,pricing,amount-words,dates,format,policy,assignment,state,merge,render,number,hash,snapshot}.ts` | N | pure rules §3.2 (FR-1, FR-2, FR-4, FR-5, FR-6) |
| `apps/api/src/dto/contracts.ts` · `dto/error.ts` | N / M | §3.5 schemas; 6 new slugs + Problem extension fields |
| `apps/api/src/routes/contracts.routes.ts` · `routes/approvals.routes.ts` · `routes/index.ts` | N / M | 13 endpoints, guards, result → HTTP mapping |
| `apps/api/src/events/contract-events.ts` | N | in-process dispatcher + log listener (FR-10) |
| `apps/api/src/services/contract/{not-implemented,create,update,copy,submit,decide,issue,void,read,render}-service.ts` · `services/contract/snapshot-builder.ts` | N | one command per file (FR-1…FR-9) |
| `apps/api/src/dao/{contract-write,approval,contract-issue,contract-render,contract-read}-dao.ts` | N | CAS + audit in one `db.batch`; Rung B; queue join |
| `packages/client/src/generated/*` | M | `pnpm client:generate` |
| `apps/api/test/domain/contract-*.test.ts` · `test/events/contract-events.test.ts` | N | pure + dispatcher unit tests |

Not touched: `packages/rbac/src/catalog.ts` (all `contract:*` exist, SPEC-01) · root `package.json`/lock (no new dependency;
SHA-256 via `@noble/hashes`, already used by `middleware/idempotency.ts`) · `dao/audit-dao.ts` (read-only reuse: `auditInsert`,
`writeAuditEvent`, `listAudit`) · row 02 files (import only `getTemplateVersionById`, `getCurrentVersion`).

## 3. Cards — one small job each, in order (docs/plan/cards/C-03-NNN.md)
- [C-03-001] Schema + migration + data inventory → unblocks all ACs · depends on **C-02-003 merged** (last row-02 migration)
- [C-03-002] Pure domain (types + 12 modules) + unit tests → AC-7, AC-11, AC-13b, FR-1/2/4/5/6 · depends on none
- [C-03-003] OpenAPI contract: DTOs, error slugs, routes (full result mapping), service stubs (501), events, client → unblocks all · depends on C-03-001, C-03-002 (+ C-02-001 merged: `dto/error.ts` shared)
- [C-03-004] Render: `/render` from snapshot (draft) / stored bytes (issued) / rebuild-once / void band → AC-5, AC-8, AC-27, §4 failure · depends on C-03-003
- [C-03-005] Read: list + counts, detail + timeline + `can`, `/approvals/mine`, `/contracts/{id}/audit` → AC-1, AC-28, AC-29, AC-26 · depends on C-03-003
- [C-03-006] Create / edit draft / copy (snapshot builder) → AC-4, AC-5, AC-6, AC-7, AC-19, AC-23, AC-24, §4 two tabs · depends on C-03-003 (+ row 02 C-02-004)
- [C-03-007] Submit (I9) + approve/reject (SoD, one-person-one-step, DEC-10) → AC-9…AC-14, AC-13b, AC-13c, DEC-10, AC-20, §4 two people · depends on C-03-003
- [C-03-008] Issue (Rung B + paper once) + void → AC-2, AC-3, AC-15, AC-17, AC-18, AC-21, AC-22, AC-25 · depends on C-03-004 (green run also needs 006 + 007)
- [C-03-009] PROOF: full suite, probes with real output, Nhật Minh fixture, Swagger, attack pass, PROOF log → AC-1…AC-29 · depends on all

Parallel groups (the driver dispatches; `touches` are disjoint inside a group):
- **Wave 0:** C-03-001 ∥ C-03-002 (schema vs. pure `domain/contract/**` + `test/domain/**`). C-03-002 may start before row 02 is done.
- **Wave 1:** C-03-003 alone (it owns every shared API file).
- **Wave 2:** C-03-004 ∥ C-03-005 ∥ C-03-006 ∥ C-03-007 (each owns its DAO + service files only).
- **Wave 3:** C-03-008 (imports `saveRenderedOnce` from C-03-004's DAO). **Wave 4:** C-03-009.
- An AC goes green only when all cards on its path are merged (e.g. AC-9 = 006 + 007; AC-15 = 006 + 007 + 008). Each card's done-check names the
  `-t` filters the driver runs after the card's wave is merged; build agents do not run vitest.

Shared files, **serialized by the driver** (only the named card edits them; a later card needing a change stops and reports → C-03-003b):
`apps/api/src/db/schema.ts` + `db/migrations/**` incl. `meta/` (C-03-001, after row 02) · `privacy/data-inventory.ts` (C-03-001, after row 02) ·
`dto/error.ts` (C-03-003, after C-02-001) · `routes/index.ts` (C-03-003) · `packages/client/src/generated/*` (C-03-003) ·
`packages/rbac/src/catalog.ts` and root `package.json`/`pnpm-lock.yaml` (not touched by row 03).
Cross-row: migration numbered at build time as "next" after row 02's last one; row 04a owns `apps/web/**`, `wrangler.toml` assets, `/me` display_name.

## 4. Risks
1. **Clock seam.** AC-3/AC-6 need a pinned business date at the API boundary. Plan: vitest fake `Date` (tests and `SELF` share one isolate;
   CF docs list only KV/R2/cache as unaffected by fake timers; KV here uses `expirationTtl` only). `shouldAdvanceTime` keeps `Date.now` moving
   (the idempotency poll loops on it). If the red run shows the Worker does not see the pinned time → stop, propose a `now` seam
   (services already take `now: Date` from the route — C-03-003 passes `new Date()` once per request), not a test-only header.
2. **Rung B in drizzle.** The issue UPDATE (subquery MAX+1 + `printf` + NOT EXISTS over steps) and the audit `INSERT … SELECT … WHERE issue_token`
   are written with drizzle `sql` inside `db.batch` (row-1 precedent: `updateCustomerCas`). UNIQUE `(type, series_year, seq)` partial
   `WHERE seq IS NOT NULL` + UNIQUE `number` are the last net; a UNIQUE violation → 409 `state-conflict`, never 500. C-03-001 re-reads the D1
   `batch()` and SQLite NULL-in-UNIQUE pages first (SPEC §1 TODO(PLAN)).
3. **AC-12 wording.** `approve` has no `step_no` (SPEC §3.5 body `{note?}`), so "director before manager" cannot target step 2; it lands on
   step 1 and the 409 comes from DEC-10 (`would-block-later-step`) in the 1 GĐ + 1 QL team. Ordering itself is structural: the CAS always
   targets the lowest `waiting` step. Test written that way.
4. **SoD audit row.** `creator_cannot_approve` / `one_person_one_step` refusals write `permission.denied` {rule, target `contract:<id>`} awaited
   before the 403 (`writeAuditEvent`); `requirePerm` denials keep target = path (SPEC-01). `one_person_one_step` sits inside the step CAS
   (`NOT EXISTS … decided_by = :actor`); on 0 rows the service re-reads to choose 403 vs 409.
5. **Eligibility in two places.** `/approvals/mine` (one SQL join, C-03-005) and submit/decide (`eligibleAssignment`, C-03-007) must agree.
   Mitigation: both derive from domain `isEligible()`; AC-28 + AC-13c pin the behaviour.
6. **Values schema.** `values` is a strict Zod object of the 7 manual keys of the seeded template (unknown → 422); the snapshot builder
   also rejects any key that is not a `manual` field of the pinned version. A second template with other manual keys would need a
   dynamic schema — out of scope (one template, SPEC-02 DEC-3).
7. **Row-02 dependency.** C-03-006 reads versions only through row 02's `getTemplateVersionById` / `getCurrentVersion`; the field/policy
   shape is re-declared structurally in `domain/contract/types.ts` (no import of row-02 internals). If row 02's shape drifts → SPEC-03 first.
8. **Stub mechanics.** Routes are final in C-03-003; stubs throw `NotImplementedYet` which the routes' `handle()` maps to 501, so wave-2
   cards edit only services/DAOs. C-03-009 deletes `not-implemented.ts` once unused.
- Conflicts with ENGINEERING.md: none — expand-only migration, CAS + `db.batch`, services never see `c`, Problem+JSON, client regenerated in
  C-03-003. SoD deliberately NOT via `requirePerm({ownerId})` (docs/rbac.md admin bypass; workbook §9).

## 5. Trace check (before the STOP)
- [x] every FR has at least one AC (FR-1 AC-1/6/7/24 · FR-2 AC-4/5/19 · FR-3 AC-14/22/two-tabs · FR-4 AC-11/13/13b · FR-5 AC-9/12/13c/20/DEC-10 ·
  FR-6 AC-2/3/18/25 · FR-7 AC-10/15 · FR-8 AC-16/17/23 · FR-9 AC-28/29/1 · FR-10 events unit test)
- [x] every AC has a row in §1 · every AC is served by a card (§3) · every "now" edge case has an AC (incl. the two SPEC §8 TODO(PLAN) tests)

## 6. PROOF log (step 5)
- (C-03-009)
