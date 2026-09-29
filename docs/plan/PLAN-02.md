# PLAN-02: Mẫu hợp đồng có phiên bản (templates + seed "Hợp đồng cung cấp dịch vụ phần mềm")

Status: Draft
Spec: docs/spec/SPEC-02.md
Roadmap row: 2 (needs row 1 — done; row 3 builds on `template_versions`)

## 1. Acceptance tests — written first, seen failing
File: `apps/api/test/integration/templates-acceptance.test.ts` (12 `it`). Compiles now (`pnpm --filter @runway/api exec tsc --noEmit -p .` → no output; eslint clean).
`templates` / `template_versions` are touched only by raw SQL. Run: `CI=true pnpm --filter @runway/api exec vitest run test/integration/templates-acceptance.test.ts` (driver runs the red run centrally).
Per-test reset (`resetTemplates`): drops the append-only trigger, deletes test-made templates/versions, puts the seed back on v1, recreates the trigger from `sqlite_master`; keeps the seed's own `template.created` audit row (actor NULL).
| AC | How it's proven | Fails now? |
|---|---|---|
| AC-1 | `AC-1: after migrate, all three roles see exactly the one seeded template…` | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-2 | `AC-2: seed body v1 — no internal note, 16 placeholders…` (+ card C-02-003 runs `checkTemplate` over the seeded row: DEC-5) | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-3 | `AC-3: Giám đốc posts v2…` (v1 byte-for-byte via raw response text) | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-4 | `AC-4: placeholder without a field…` · `AC-4 (input edge cases)…` | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-5 | `AC-5: internal note → internal_note; <script>/onclick…` | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-6 | `AC-6: two concurrent POSTs…` (two distinct Giám đốc, `Promise.all`, raw `SELECT version_no`) | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-7 | `AC-7: the same Idempotency-Key twice…` | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-8 | `AC-8: not logged in → 401; nhan_vien and quan_ly cannot POST…; admin GET → 403` | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-9 | `AC-9: every successful POST writes exactly one … audit row` (incl. seed row) | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-10 | `AC-10: no PATCH/PUT/DELETE … trigger refuses` (OpenAPI + raw UPDATE/DELETE) | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
| AC-11 | `AC-11: POST /templates … 409 duplicate + existing_id` | red ✓ (2026-09-29: `Tests 12 failed (12)` — 404 routes missing / no trigger / no audit row) |
Also: unit tests `apps/api/test/domain/template-check.test.ts` (C-02-002) and `apps/api/test/integration/template-seed-check.test.ts` (C-02-003) — owned by their cards.

## 2. Files that change
| File | New / Modify | Why (FR) |
|---|---|---|
| `apps/api/src/db/schema.ts` | M | `templates`, `template_versions` (FR-1) |
| `apps/api/src/db/migrations/<next>_*.sql` (generated) + `<next+1>_template_versions_append_only.sql` (custom trigger) + `meta/*` | N | tables + `BEFORE UPDATE/DELETE` triggers (FR-1, DEC-6) |
| `apps/api/src/db/migrations/<next+2>_seed_template.sql` (custom) | N | seed template v1 + `template.created` audit row, actor NULL (FR-3, DEC-5) |
| `apps/api/src/privacy/data-inventory.ts` | M | `templates`, `template_versions` → INVENTORY_EXEMPT_TABLES (business records, no personal data) |
| `apps/api/src/dto/templates.ts` · `dto/error.ts` | N / M | zod-openapi schemas; `template-check-failed` slug; `errors[]` items gain optional `code`/`key`/`source` (FR-4, FR-5, FR-6) |
| `apps/api/src/dao/template-types.ts` | N | DTO types + row→DTO mapper shared by read and write DAOs |
| `apps/api/src/routes/templates.routes.ts` · `routes/templates-write.routes.ts` · `routes/index.ts` | N / M | GET ×2 · POST ×2 (contract-first 501 stubs, then handlers) |
| `apps/api/src/domain/template-check.ts` · `domain/template-sources.ts` | N | pure check: placeholders↔fields, sources, `{{#if}}` balance, note/HTML allowlist, limits, policy (FR-6) |
| `apps/api/src/dao/template-dao.ts` · `services/template-read-service.ts` | N | list (cursor ≤50), detail (+`version_no`), `getTemplateVersionById`, `getCurrentVersion` (FR-4, FR-8) |
| `apps/api/src/dao/template-write-dao.ts` · `services/template-write-service.ts` | N | insert template+v1 / next version with CAS + audit in one `db.batch`; check before write (FR-1, FR-5, FR-6, FR-7) |
| `packages/client/src/generated/*` | M | `pnpm client:generate` |
| tests: `test/integration/templates-acceptance.test.ts`, `test/domain/template-check.test.ts`, `test/integration/template-seed-check.test.ts` | N | see §1 |

## 3. Cards — one small job each (docs/plan/cards/C-02-NNN.md)
- [C-02-001] Schema + append-only trigger migration + DTOs + OpenAPI 501 stubs + client:generate → unblocks AC-1…AC-11; serves AC-10 (no PATCH/PUT/DELETE; trigger) · depends on none
- [C-02-002] PURE `checkTemplate` + source registry + limits, with unit tests → AC-4, AC-5 (logic), FR-6 · depends on none
- [C-02-003] Seed migration (template v1 + audit row) + seed-check test (`checkTemplate` over the seeded row) → AC-1, AC-2, AC-9 (seed row) · depends on C-02-001, C-02-002
- [C-02-004] Read side: list/detail DAO + read service + GET handlers, `getTemplateVersionById` / `getCurrentVersion` → AC-1, AC-2, AC-3 (read half), AC-8 (GET 401/403) · depends on C-02-001
- [C-02-005] Write side: `POST /templates`, `POST /templates/{id}/versions` — Zod → perm → `checkTemplate` → CAS+audit batch, idempotency, duplicate/stale → AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-11 · depends on C-02-001, C-02-002, C-02-004
- [C-02-006] PROOF: full suite, Swagger walkthrough, attack pass, PROOF log → AC-1…AC-11 · depends on all

Execution order / parallelism (driver decides; disjoint `touches` inside a group):
- Group A (parallel): **C-02-001 ∥ C-02-002** (schema+contract vs. pure function; no shared files).
- Group B (parallel, after A): **C-02-003 ∥ C-02-004** (seed migration + seed test vs. read DAO/service/GET; disjoint).
- Group C: C-02-005 (needs 002 + 004). Group D: C-02-006.
- Shared files, SERIALIZED by the driver (only the named card edits them; never two agents at once): `packages/client/src/generated/*` (C-02-001; regenerate again only if a later card changes an API shape), `apps/api/src/routes/index.ts` (C-02-001), `apps/api/src/db/schema.ts` + `db/migrations/**` incl. `meta/` (C-02-001 then C-02-003), `packages/rbac/src/catalog.ts` (NOT touched: `template:write` exists), root `package.json` / `pnpm-lock.yaml` (NOT touched: no new dependency).
- Cross-row: migrations are numbered at build time as "next" (row 02 builds before row 03; never hard-code a number). Row 04a owns `apps/web/**`, `wrangler.toml` assets and `/me` display_name; this plan touches none of them. Row 03 imports only `getTemplateVersionById`, `getCurrentVersion`, `checkTemplate`'s source registry (SPEC §3.6).

## 4. Risks
- (1) `Problem.errors[]` is `{path, message}` today; `template-check-failed` needs `{code, key?, source?, message}`. Extend `ProblemDto.errors` items with optional `code/key/source` (backward compatible; `path` stays required → for check errors use `path: key ?? "body"`). Test asserts only `code/key/source/message`. Regenerate client.
- (2) CAS + UNIQUE race (AC-6): both callers pass Zod/check; the loser must get 409 `stale`, never 500. The batch = [INSERT version guarded by "current version_no = expected", UPDATE `templates.current_version_id` … WHERE current = expected id, audit]; a UNIQUE(`template_id`,`version_no`) violation is mapped to `stale` (reuse `isUniqueViolation`). A zero-row guard must abort the whole batch (audit row only when the version row landed) — same pattern as row-1 customers CAS.
- (3) `templates.current_version_id` ↔ `template_versions.template_id` is circular: plain TEXT (no FK) for `current_version_id`; new-template batch order = INSERT templates (current NULL) → INSERT version → UPDATE current_version_id → audit.
- (4) Append-only trigger vs. test isolation and vs. `truncateTables(users)`: `created_by` FKs to users (NULL for the seed). The acceptance test resets by dropping/recreating the trigger; other suites that delete users must not leave template rows behind (they don't create any). Privacy erasure never deletes users (anonymize) → fine; `data-inventory` test forces the exempt-table entry.
- (5) Seed as a hand-written SQL migration: Vietnamese HTML with `'` and `{{ }}`; escape quotes; body must be byte-identical to SPEC §3.5 and pass `checkTemplate` (C-02-003 test). Fixed ULID literals; audit row target `template:<seed id>`, actor NULL (nullable — confirmed in SPEC).
- (6) Hand-rolled HTML allowlist (DEC-2): a tokenizer over `<tag attr="v">`, not a full parser. Reject anything it can't classify (fail-closed): comments, `<!`, unterminated `<`, `javascript:` anywhere in an attribute value, attributes other than `class` with values from the allowed class list. Unit tests carry the attack strings (`<SCRIPT>`, `<p onClick=…>`, `<img src=x onerror=…>`, `<a href="javascript:…">`, nested/uppercase, entity-encoded). No new library (CLAUDE.md: research docs before any install — none needed).
- (6b) "Internal note" detection = case-insensitive, diacritic-tolerant match of `ghi chú nội bộ` and `xóa trước khi gửi khách` on text (unit-tested on the .docx wording).
- (7) The 64 KB limit is bytes (UTF-8), not characters: Vietnamese text is multi-byte. Use `TextEncoder`. The Worker's request-size ceiling is far above 65 KB.
- (8) `POST` order: Zod (422 validation) → `requirePerm` (403 + `permission.denied`) → check (422) → CAS. Zod runs before the permission middleware in this stack? Row 1 wired `requirePerm` before the OpenAPI validator via `app.on(...)`; keep that (a Nhân viên with a bad body must get 403, not 422 — AC-8 sends valid bodies, so either passes; still follow SPEC order and note the result).
- (9) `created_by_name` = `users.display_name` (SPEC-01) — the seed's is NULL → response `null` (mockup shows "Hệ thống").
- (10) List `steps_summary` shape is not fixed in the SPEC → choose `string[]` of step labels (e.g. `["Quản lý duyệt","Giám đốc duyệt (giảm >10%)"]`) and document in the DTO; row 04a reads it. Ask if a different shape is wanted.
- ENGINEERING.md conflicts: none. Schema is expand-only; the trigger is additive (later migrations must not alter it — SPEC DEC-6); no destructive SQL; routes own `c`, DAOs pure, races by CAS in `db.batch`.

## 5. Trace check (before the STOP)
- [x] every FR has at least one AC (FR-1→AC-3,6,10 · FR-2→AC-1,2 · FR-3→AC-1,2 · FR-4→AC-1,3 · FR-5→AC-3,11 · FR-6→AC-4,5 · FR-7→AC-8,9 · FR-8→AC-3 (old version readable by id/no) + C-02-004 exports) · every AC has a row in §1 · every AC is served by a card · every "now" edge case has an AC (Input→AC-4/5 · Duplicates→AC-11 · Two people→AC-6 · Retry→AC-7 · Permissions→AC-8 · Lifecycle→AC-3/10 · Data→AC-4)
- [x] first BUILD card (C-02-001) updates OpenAPI (501 stubs) + schema before any handler · no product code written in this step

## 6. PROOF log (step 5)
- Checks: [pending]
- Human checklist: [pending]
- Attack (access / injection): [pending]
- Result: [pending]
