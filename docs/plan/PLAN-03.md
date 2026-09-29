# PLAN-03: Vòng đời hợp đồng — tạo, gửi duyệt, duyệt/từ chối, phát hành có số, hủy + thay thế

Status: Done 2026-09-30
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
Checks (driver, 2026-09-29, after D-1 fix): typecheck `Tasks: 7 successful, 7 total` · lint `Tasks: 2 successful, 2 total` · web build `✓ built in 1.13s` · `CI=true pnpm test` `Tasks: 9 successful` — api `Tests 247 passed | 2 skipped (249)` (contracts-acceptance 35/35), web 35 passed.
Run 2026-09-29 on the real app (dev server already up on :8787, local D1 at 0014, template seeded). curl + one cookie jar per user, write headers `Origin: http://localhost:8787` + `X-Requested-With: fetch` + `Content-Type: application/json` + a fresh UUID `Idempotency-Key` per logical action. Fresh users via `POST /admin/users` + `POST /auth/activate`: p3-gd1, p3-gd2 (giam_doc), p3-ql (quan_ly), p3-nv1, p3-nv2 (nhan_vien) @example.vn. Local D1 had 0 contracts at the start, so the series really starts at HD-2026-001. No vitest, no D1 reset/migrate, no source edits; DB reads = `wrangler d1 execute runway_dev --local` SELECT only. Access cookies expire in minutes — re-login between phases (not a bug). Doc date the API used = 2026-09-29 ("today"), not 28/09, so end dates are 28/03/2027 and 28/09/2027 (same rule, shifted a day). Template current version at start = v6 (body identical to v1 text, "trong 7 ngày"; v5 carries the row-02 entity text but v6 replaced it); I posted **v7** ("7 → 10 ngày") for the template-edit probe, so local D1 is now at template v7. For I9 probes I temporarily set gd@/p2-giam_doc/p2-quan_ly/p3-gd2 to `disabled` via `PATCH /admin/users/{id}` and set them back to `active` afterwards (`SELECT` of non-active users → 0).

### Fixture Nhật Minh (real output, trimmed)
- customers (gd1 `POST /customers`): "Nhật Minh A" `01M3PZQQ20553NS6R8K2G7XY48`, "Nhật Minh B" `01M3PZQX5BDNMHPSFPPP1J6A42`.
- missing field: nv1 `POST /contracts` G6·1·500bps without `chuc_vu_nguoi_ky` → **422** `missing-fields`, `detail:"Thiếu: Chức vụ người ký."`, `missing_fields:[{key:"chuc_vu_nguoi_ky",label:"Chức vụ người ký"}]`.
- A: nv1 create G6 · 1 · 500 → 201 `01M3PZQXA5EQ37E0PGY9BNZ9CM` draft, `number:null seq:null`, total **2565000**, doc_date 2026-09-29, `tong_tien "2.565.000"`, `tong_tien_bang_chu "Hai triệu năm trăm sáu mươi lăm nghìn đồng"`, `ngay_bat_dau 29/09/2026 → ngay_ket_thuc 28/03/2027`, `giam_gia "5"`, snapshot `template.version_no 6`.
- A: nv1 submit → 200 pending, steps `[[1,"Quản lý duyệt","waiting"]]` (1 step) · ql approve → 200 approved · ql issue → 200 `HD-2026-001`, seq 1, series_year 2026, `rendered_hash 133afd9c…eaab6`. Timeline `contract.created, submitted, approved, issued`. `can` after issue `{void:true, others:false}`.
- A `/render` → 200 `text/html; charset=utf-8`, `ETag "133afd9c…eaab6"` (= sha256 of the body), CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`; page has "Số: HD-2026-001", "2.565.000 đồng (bằng chữ: Hai triệu năm trăm sáu mươi lăm nghìn đồng), đã gồm VAT, đã trừ giảm giá 5%", "từ ngày 29/09/2026 đến hết ngày 28/03/2027", 0 leftover `{{`.
- B: nv1 create G12 · 2 · 1500 → total **8160000**, "Tám triệu một trăm sáu mươi nghìn đồng", 29/09/2026 → 28/09/2027 · submit → pending steps `[[1,"Quản lý duyệt"],[2,"Giám đốc duyệt"]]` · ql `/issue` while pending → 409 · ql approve → pending (step 1 approved) · gd1 approve → approved · gd1 issue → 200 **HD-2026-002**. Timeline `created, submitted, approved, approved, issued`.
- void A: ql `void {"reason":"  "}` → 422 · nv1 void → 403 · ql void with reason → 200 `voided`, `number HD-2026-001`, `seq 1`, `void_reason` kept · `/render` of voided: `ETag` unchanged `133afd9c…`, body has "ĐÃ HỦY" ×1 and "Số: HD-2026-001" · PATCH voided → 409 `state-conflict`.
- copy A (nv1) → 201 draft `01M3PZRTYYVZ98WS6346F0XV5V`, `source_contract_id` = A, total 2565000 · copy A again → 409 (`"Hợp đồng đang ở trạng thái "voided"…"`) · copy: submit → ql approve → ql issue → **HD-2026-003**; A now `replaced_by_id` = the copy, number still HD-2026-001.
- `/docs` → 200; `openapi.json` has 13 operations under `/contracts*` + `/approvals/mine` (get,post,patch across 11 paths).

### Probes (workbook §7)
- **Numbering race, 10 concurrent** — 10 contracts created + submitted + approved (10 × `approved`), then `for id …; do (POST /contracts/$id/issue) & done; wait`: 10 × `200`, numbers HD-2026-004 … HD-2026-013 (one each). Series already held 001–003 (A, B, copy), so the tally over the whole series and over this batch:
  ```
  SELECT COUNT(*), COUNT(DISTINCT seq), MIN(seq), MAX(seq) FROM contracts WHERE type='contract' AND series_year=2026
  → {"n":13,"d":13,"mn":1,"mx":13}                     (13|13|1|13: no gap, no duplicate)
  … AND seq>3  → {"n":10,"d":10,"mn":4,"mx":13}         (the batch: 10|10|4|13)
  ```
- **Numbering race, 5 concurrent on ONE approved contract** (5 different Idempotency-Keys) → `200 ["HD-2026-014",14]` + 4 × `409 state-conflict current_status:"issued"`; tally:
  ```
  → {"n":14,"d":14,"mn":1,"mx":14}     (MAX +1 exactly)   audit contract.issued rows for that id: 1
  ```
  Final series after the whole run: `{"n":16,"d":16,"mn":1,"mx":16}`.
- **Missing-field probe** — above (422 `missing-fields`, D1 `SELECT COUNT(*) FROM contracts` 28 before and 28 after all refusals). Whitespace-only `"   "` → same 422. Then `"Phó Giám đốc"` → 201 and `/render` prints "Đại diện: Nguyễn Văn A — Chức vụ: Phó Giám đốc" (A's own signer line stays "Giám đốc").
- **Self-approval probe** — ql creates −5%, submits, ql approves own → **403** `rule:"creator_cannot_approve"`, `detail:"Người tạo hợp đồng không được tự duyệt."`, contract still `pending`; `GET /audit?action=permission.denied` → `{actor_name:"P3 ql", target:"contract:01M3PZSWJJM5TA8PP3VY8JCXXP", metadata:{rule:"creator_cannot_approve", permission:"contract:approve"}}` (exactly 1). gd1 creates −15%, ql approves step 1, gd1 approves step 2 → 403 `creator_cannot_approve` (+ audit row); gd1 on step 1 → 403 same. admin approve → 403 `Missing required permission`, audit `{actor_name:"Quản trị hệ thống", target:"/contracts/<id>/approve", metadata:{permission:"contract:approve"}}`. nv2 approve nv1's → 403 + audit `{actor_name:"P3 nv2", target:"/contracts/<id>/approve", metadata:{permission:"contract:approve", method:"POST", …}}`.
- **Live-data probe** — customer "Live Data Co" / 0903000003 → contract L issued `HD-2026-016`, `ETag fb71054c…c23`; `PATCH /customers/{id}` `{name:"Live Data RENAMED", phone:"0999999999"}` → 200; `/render` again → **`cmp` BYTE-IDENTICAL**, ETag same `fb71054c…`, still "Tên cửa hàng: Live Data Co", "Điện thoại: 0903000003", list/`GET` `customer_name` "Live Data Co". A draft's `/render` (customer renamed after create) also byte-identical. (Price-list change NOT done through the API here; covered by test AC-21 + AC-6.)
- **Template-edit probe** — gd1 `POST /templates/{id}/versions` v7 (7→10 ngày) → 201; L's render hash `fb71054c…` unchanged, text "trong 7 ngày"; new contract → `snapshot.template.version_no 7`, "trong 10 ngày"; existing draft D stays `version_no 6` / "trong 7 ngày" until `PATCH {expected_version, use_latest_template:true}` → 200, then v7 / "trong 10 ngày".
- **Replay probe** — `POST /contracts` same key + body twice → `201 …EF` both times, second has header `idempotency-replay: true`, row count +1; same key + other body → **409** `Idempotency-Key reused with different request body`. Issue: same key twice → `200 HD-2026-016` both (no second number); same key `{"x":1}` → 409.
- **Tamper probe** — `total:1000000, unit_price:1` at root → 422 `unrecognized key(s) in object`; inside `values` → 422 same; `number:"HD-2026-999", status:"issued"` → 422; DT14 → 422 (3 messages naming `ma_goi`); `so_bao_gia` without `ngay_bao_gia` → 422 `field_rules[0]` "phải cùng có hoặc cùng không có". Zero rows created. Honest request → total 2565000.
- **Approve-then-edit probe** — NOT reachable through the API (PATCH on `pending`/`approved` → 409 `state-conflict`, verified for `pending`); owned by `contracts-acceptance` "AC-25: approve-then-edit probe" (edits the snapshot in the DB, expects 409 `changed-after-approval`, no number used). Not run here (no vitest).
- **I9** — only gd1 as active Giám đốc (+ ql): gd1 creates −15% → submit **409** `no-eligible-approver` `{step_no:2,label:"Giám đốc duyệt"}`, contract stays `draft`, `approval_steps` for it = `{"steps":0}` (D1). ql creates −15% → submit 409 same (AC-13b). nv1 creates −15% → submit 200, steps 1 + 2 (AC-13b other half). With gd2 active again: gd1 submits → 200; ql approves step 1; gd2 approves step 2 → `approved`.
- **DEC-10 (would-block-later-step)** — 1 GĐ + 1 QL, nv1 −15% pending: gd1 approve step 1 → **409** `Would block a later step`, `detail:"Nếu bạn quyết bước này, bước \"Giám đốc duyệt\" sẽ không còn ai duyệt được."`, `step_no 2`, steps still `[[1,waiting],[2,waiting]]`; ql approve step 1 → 200; ql on step 2 → 403 (`Bạn không có quyền hoặc vai trò cho bước này`); gd1 step 2 → 200 `approved`.
- **One-person-one-step (AC-13c)** — nv1 −15%, enough people: gd1 step 1 → 200, gd1 step 2 → **403** `rule:"one_person_one_step"`, `detail:"Mỗi người chỉ được quyết một bước của cùng một hợp đồng."`, audit row `rule one_person_one_step`; `/approvals/mine` for gd1 no longer lists it, gd2's does (step 2); gd2 step 2 → 200 `approved`).
- **DEC-2** — gd1 created −15% (ql step 1, gd2 step 2) then gd1 `/issue` own contract → 200 `HD-2026-015`.
- **Approve vs reject race** — ql `approve` ∥ gd1 `reject` on a pending step 1 → `409 (current_status:"rejected")` + `200 rejected`; steps `[[1,rejected],[2,waiting]]`.
- **Reject** — no `note` → 422; with note → 200 `rejected`, approve after → 409; copy of a rejected contract → 201 draft, `steps` 0, `source_contract_id` set, no number (AC-10).
- **Queue (AC-28)** — nv1 −15% pending: ql and gd1 see `[[1,"Quản lý duyệt"]]`, nv1 → 403 (audit row), ql does not see its own contract; after ql approved step 1: ql sees `[]`, gd1 and gd2 see `[[2,"Giám đốc duyệt"]]`. `GET /contracts?status=pending&limit=50` → only `pending` rows, `counts {"draft":10,"pending":5,"approved":4,"issued":15,"rejected":1,"voided":1}`, `limit=51|0` → 422.
- **Edit rules** — nv2 PATCH nv1's draft → **403** `rule:"creator_only"` (see Result D-1: no audit row); nv1 PATCH ok (version 2→3, total recomputed 8100000 for 3 shops); stale `expected_version` → 409 `stale`; PATCH `pending`/`issued`/`voided` → 409 `state-conflict`; nv2 submit nv1's draft → 403 `creator_only` + audit `{rule:"creator_only", permission:"contract:submit"}`.
- **Audit (AC-16)** — `GET /contracts/{B}/audit` (gd1) → `created(null→draft), submitted(draft→pending), approved(pending→pending), approved(pending→approved), issued(approved→issued, HD-2026-002)`; nv1 on it → 403. Global `/audit` dump (6 pages, 72 688 bytes): grep for customer names/phones/emails/reject or void reasons/`Điều 5` → **0** hits; action mix `contract.created 37, submitted 27, approved 28, issued 16, rejected 2, voided 1, updated 3`.

### Attack pass
- no cookie: `GET /contracts`, `/contracts/{id}`, `/render`, `/audit`, `/approvals/mine` → all **401**, no body leak (grep `Nhật Minh|HD-2026` → 0); `POST submit|approve|reject|issue|void|copy`, `POST /contracts`, `PATCH /contracts/{id}` with valid write headers → all **401**.
- CSRF (nv1 cookie): copy without `Origin`/`X-Requested-With` → 403; `Origin: https://evil.example` → 403.
- ids: `nope`, `' OR 1=1--` → 422 (GET, render, approve); unknown ULIDs (`…9CN`, all-zero) → 404 (GET, render, approve). Query: `limit=51|0`, `status=bogus`, `cursor=garbage` → 422; `created_by=nope` → 200 (empty).
- roles: nv1 `/issue` and `/void` → 403 (+ audit `contract:issue`); admin `GET /contracts` and `POST /contracts` → 403; other creator's draft PATCH → 403.
- XSS: customer `<script>alert(1)</script>` → contract created; `/render` 200 prints `Tên cửa hàng: &lt;script&gt;alert(1)&lt;/script&gt;`, `grep -c '<script'` → 0; headers `Content-Type: text/html; charset=utf-8`, `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`, `x-content-type-options: nosniff`. Customer with no phone/email → contract create refused (required `sdt`/`email` → 422 missing), not a bug.
- Not run here (automated only): year boundary 00:30 01/01/2027 VN (AC-3), death between issue and saving the paper (§4 failure test), price-list change (AC-6/21), direct-DB snapshot edit (AC-25).

### Human checklist (open http://localhost:8787/docs; writes need `Origin` + `X-Requested-With: fetch` — use curl for POSTs. Login users: p3-gd1 / p3-gd2 (Giám đốc), p3-ql (Quản lý), p3-nv1 / p3-nv2 (Nhân viên) @example.vn, password `p3-correct-horse-battery`)
1. `GET /templates` → ONE contract template, current v7 (+ the P2 test template); `GET /templates/{id}` → fields, required marked, steps "Quản lý duyệt" + "Giám đốc duyệt" (>10%).
2. As nv1 `POST /contracts` for a customer, leave `chuc_vu_nguoi_ky` out → 422 "Thiếu: Chức vụ người ký.", and `GET /contracts` shows no new row.
3. Add the value → 201, `number:null`; `GET /contracts/{id}/render` in a browser → paper with "Số: (chưa có số)" and "NHÁP"; `POST …/submit`.
4. As the same user (or any creator) `POST …/approve` → 403 "Người tạo hợp đồng không được tự duyệt."; as gd1 `GET /audit?action=permission.denied` → the refused attempt (rule `creator_cannot_approve`).
5. As ql approve (and, for −15%, gd1 then approve step 2), then `POST …/issue` → `number` HD-2026-NNN, next in the series; `/render` header `ETag` = stored hash.
6. As gd1 rename the customer and post a new template version, re-open the issued `/render` → same bytes, same ETag.
7. `POST …/void` with a reason → `voided`, keeps its number, `/render` shows "ĐÃ HỦY"; `POST …/copy` → new draft; submit → approve → issue → next number, old one shows `replaced_by_id`.
8. −15% by the ONLY Giám đốc → submit 409 naming "Giám đốc duyệt"; `GET /approvals/mine` as ql / gd1 / nv1 → what each may decide now (nv1 → 403).
9. Log out → any `/contracts*` → 401.

### Closing audit (workbook §7) — skeleton, driver to confirm
1. Layer map (10) — route `apps/api/src/routes/contracts.routes.ts` + `approvals.routes.ts` · validation Zod in the same route files + `apps/api/src/dto/contracts.ts` (strict, unknown keys → 422) · auth `requirePerm` in routes + SoD in `apps/api/src/services/contract/decide-service.ts` / `submit-service.ts` · command `apps/api/src/services/contract/{create,update,submit,decide,issue,void,copy,render,read}-service.ts` (+ `snapshot-builder.ts`) · domain `apps/api/src/domain/contract/{merge,pricing,amount-words,dates,policy,assignment,state,number,render,snapshot,hash,format}.ts` · persistence `apps/api/src/dao/{contract-write,contract-read,contract-issue,contract-render,approval,audit,price-list,customer,template}-dao.ts` + migration `apps/api/src/db/migrations/0014_wooden_gauntlet.sql` · event `apps/api/src/events/contract-events.ts` · listener log line in the same file (default `logListener`, failure isolated) · adapter n/a (printable HTML, no outbound call) · audit rows written in the same `db.batch` inside the DAOs above; `permission.denied` from `requirePerm` `onDeny` and `writeAuditEvent` in the SoD refusals.
2. Guard audit (§6 rows) — read/render/list `requirePerm contract:read` · create/patch `contract:write` (+ creator_only) · submit `contract:submit` + creator · approve/reject step permission + role + `creator_cannot_approve` + `one_person_one_step` + DEC-10 (`decide-service.ts`, `domain/contract/assignment.ts`) · issue/void `contract:issue` · `/approvals/mine` `contract:approve` · contract audit `audit:read` · every refusal audited (see Result D-1 for PATCH) · input strictness (Zod `.strict()`) · rendering safety `domain/contract/render.ts` escape + CSP `middleware/security-headers.ts` · PII kept out of audit/log (probe above) · fail-closed policy unreadable → approval required (`domain/contract/policy.ts`, unit test).
3. Rung — **B**: one `UPDATE … SET seq=(SELECT COALESCE(MAX(seq),0)+1 …), number=printf(…) WHERE id AND status='approved' AND NOT EXISTS(unapproved / hash-mismatched step)` in `contract-issue-dao.ts` + audit `INSERT…SELECT` in the same `db.batch`; UNIQUE `(type, series_year, seq)` and UNIQUE `number` as last net; no counter table. Why: D1 has no interactive transaction, so one statement is the atomic unit (proved by the race tallies above).
4. Invariants → proof — I1 AC-1/2/3/18 + race tallies · I2 AC-8/14/21/22 + live-data and template-edit probes · I3 AC-4/5/19 + missing-field probe · I4 AC-6/7/24 + tamper probe · I5 AC-9/10/12/13c/20 + self-approval probe · I6 AC-15 + void/copy run · I7 AC-16 + contract audit read-back · I8 AC-17/23 + replay probe · I9 AC-13/13b + DEC-10 + I9 probes. `WORKBOOKS.md` does not exist yet → the ledger line is for the driver: `documents · v1.0 · rung B · endpoints: …13 operations… · events: contract.created, contract.updated, contract.submitted, contract.approved, contract.rejected, contract.issued, contract.voided`.

### Result
- All probes above PASS on the running app; AC-1…AC-29 observed at API level except those listed "Not run here" (owned by `contracts-acceptance`; driver runs the suite).
- Differences from SPEC-03 (not fixed):
  - D-1 (SPEC §3.5 PATCH row / §4 Permissions): non-creator `PATCH /contracts/{id}` → 403 `creator_only` but **no** `permission.denied` audit row (2 attempts, 0 rows). Submit by a non-creator does write one (`rule:"creator_only"`). AC-26 asks only for 403, §3.5 says "403 + permission.denied". **Fixed by driver:** AC-26 now asserts both rows (red first: `expected [ 'contract:submit' ] to deeply equal [ 'contract:submit', 'contract:write' ]`), `update-service.ts` writes `permission.denied` {rule creator_only, permission contract:write} → 35/35.
  - D-2: `permission.denied` rows from `requirePerm` (admin, nv2, nv1) have `target` = request path, not `contract:<id>` (SPEC-01 behaviour; workbook §6 says target `document:<id>`). SoD refusals use `contract:<id>` as specified.
  - D-3: doc date is "today" (2026-09-29), so fixture dates are 29/09→28/03/2027 and 29/09→28/09/2027 (SPEC fixture assumes 28/09). Numbers and totals match (HD-2026-001 2.565.000đ, HD-2026-002 8.160.000đ).
  - D-4: race tallies are `13|13|1|13` / `14|14|1|14` (series already had 3 numbers), not `10|10|1|10`; the batch filter `seq>3` shows `10|10|4|13`. No duplicate, no gap.
  - D-5: `void` with a blank reason → 422 generic `Validation failed` (fine); copying an already-replaced voided contract → 409 with the detail "ở trạng thái voided" (message does not say it already has a replacement).
  - D-6: the card's step 1 (remove `NotImplementedYet` + route mapping when unused) is not done — `not-implemented.ts` is still imported by `contracts.routes.ts` and `approvals.routes.ts`; `WORKBOOKS.md` not present. **Fixed by driver:** stub class + 11 try/catch wrappers + 501 responses removed, OpenAPI + client regenerated, suite re-run green (247 passed). `WORKBOOKS.md` never existed in this repo — n/a.
  - D-7: card step 2 (fresh D1 via `mv apps/api/.wrangler/state`) not done by request; used the running D1 (0 contracts at the start).
- Local D1 left with 36 contracts (10 draft, 5 pending, 4 approved, 15 issued, 2 rejected, 1 voided), template v7, users p3-*.
- Human approval: [x] 2026-09-30 (D-1, D-6 fixed; D-2…D-5 accepted)
