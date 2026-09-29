# PLAN-02: Mẫu hợp đồng có phiên bản (templates + seed "Hợp đồng cung cấp dịch vụ phần mềm")

Status: Done 2026-09-29
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
Checks: [pending — driver: `pnpm lint && pnpm typecheck && pnpm build && CI=true pnpm test` output goes here; NOT run by this pass]
Run 2026-09-29 on the real app (dev server already up on :8787, local D1 at 0014, template seeded). curl + one cookie jar per user, write headers `Origin: http://localhost:8787` + `X-Requested-With: fetch` + `Content-Type: application/json`. Users made by the admin through `POST /admin/users` + `POST /auth/activate` (p2-giam_doc / p2-quan_ly / p2-nhan_vien @example.vn). No vitest, no D1 reset/migrate, no source edits. Direct sqlite access was refused by the permission classifier, so DB-level checks (grep of stored bodies, raw UPDATE/DELETE against the trigger) were NOT done here; stored bodies were read back through `GET ?version_no=N` instead. `Idempotency-Key` must be a ULID or UUID (`x` → 422).
- `GET /openapi.json | jq '.paths|to_entries[]|select(.key|startswith("/templates"))'` → `/templates: [get,post]` · `/templates/{id}: [get]` · `/templates/{id}/versions: [post]`.
- `curl -sI :8787/docs` → `200`, `content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://cdn.jsdelivr.net; ...`; page references `cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css` + `swagger-ui-bundle.js`; the CDN asset itself → 200 (FIX-01 ✓).

### AC-1 list, per role
- gd / ql / nv `GET /templates` → 200 each, same one item `{id:"01K6C0NTRACT000000000TP001", name:"Hợp đồng cung cấp dịch vụ phần mềm", active:true, current_version:{version_no:1, created_by_name:null}, required_fields:[ngay_hop_dong, ten_cua_hang, ten_khach, chuc_vu_nguoi_ky, sdt, email, ten_goi, so_cua_hang, ngay_bat_dau, ngay_ket_thuc, giam_gia, tong_tien, tong_tien_bang_chu, ma_goi], steps_summary:["Quản lý duyệt","Giám đốc duyệt"]}` — `chuc_vu_nguoi_ky` is in required_fields ✓
- technical admin `GET /templates` → 403 `Missing required permission`; `GET /templates/{id}` → 403 ✓
- `GET /templates/{id}` as gd / ql / nv → 200 each.

### AC-2 seed v1 content
- fields (17): `so_hop_dong` issue:number · `so_bao_gia` manual (not required) · `ngay_bao_gia` manual (not required) · `ngay_hop_dong` derived:doc_date req · `ten_cua_hang` subject:name · `ten_khach` subject:contact_person · `chuc_vu_nguoi_ky` **manual, required** · `sdt` subject:phone · `email` subject:email · `ten_goi` price_list:name · `so_cua_hang` manual number · `ngay_bat_dau` manual, default derived:doc_date · `ngay_ket_thuc` derived:contract_end · `giam_gia` percent, manual, default 0 · `tong_tien` derived:total · `tong_tien_bang_chu` derived:total_in_words · `ma_goi` choice `[G3,G6,G12]` manual — all match SPEC §3.4 ✓
- `field_rules` → `[{"all_or_none":["so_bao_gia","ngay_bao_gia"]}]` ✓ · `default_line_items` `[]` · `default_clauses` `[]`.
- `approval_policy` → `{mode:combined, steps:[{1,"Quản lý duyệt",contract:approve}], rules:[{when:{discount_bps gt 1000}, add_steps:[{"Giám đốc duyệt", role:giam_doc}]}]}` ✓
- body: `grep -c "Ghi chú nội bộ\|xóa trước khi gửi"` → 0 ✓; contains `Bên A (bên cung cấp)` ×1, `CÔNG TY TNHH PHẦN MỀM NHẬT MINH` ×2, `25 Nguyễn Văn Trỗi` ×1, `0071 0004 58213` ×1, `{{#if so_bao_gia}}` ×1 + `{{/if}}` ×1 ✓
- distinct `{{key}}` in body = 16; `comm` against fields: placeholders without a field → none; fields not in body → only `ma_goi` (allowed, §3.3) ✓

### AC-3 Giám đốc posts a new version, v1 unchanged
- Saved `GET /templates/{id}` (v1 detail) before any post → `v1_before.json`.
- gd `POST /templates/{id}/versions` `{expected_version_no:3, body:<v1 with "trong 7 ngày"→"trong 10 ngày">, …}` + `Idempotency-Key: <uuid>` → **201** `version.version_no:4`, `created_by_name:"P2 giam_doc"`, body has "trong 10 ngày"; `GET /templates/{id}` → `version.version_no:4`, `versions:[4,3,2,1]`; list `current_version.version_no:4` ✓
- `GET ?version_no=1` after: `jq -cS .version` equals the saved v1 `.version` (4732 bytes, `shasum` 5258b7ab…d768) and `.version.body` identical to the v1 body file → **v1 unchanged** ✓ (the outer `versions[]` list of course grows.)
- Surprise, my own slip: my first attempt used a header value that is not a ULID/UUID → 422, and the follow-up "stale" probe then really created **v2** (no change to the sentence), a later probe **v3** (same); so the local template went 1 → 2 → 3 before the real change (v4) above. Body v2 = v3 = v1 (1932 chars); harmless.
- `GET ?version_no=2` → 200 (old versions readable by `contract:read`, DEC-9).

### AC-4 / AC-5 template-check failures (all → 422 `template-check-failed`, nothing stored: `versions` list unchanged after each)
- body + `{{ten_cong_ty}}`, extra field `nomap` required `source:""`, `z1 source:"deal:ten_khach"`, `z2 source:"subject:zalo"` → ONE response with 4 errors: `placeholder_without_field ten_cong_ty` · `required_field_without_source nomap` · `unresolvable_source z1 (deal:ten_khach)` · `unresolvable_source z2 (subject:zalo)` ✓ (full list, not first-only)
- everything at once (`<script>`, "Ghi chú nội bộ", `{{zzz}}`, `{{#if a}}` unclosed, required field without source, `subject:zalo`, permission `nuke:all`) → 8 errors: `html_not_allowed · internal_note · placeholder_without_field zzz · placeholder_without_field a · unbalanced_if · required_field_without_source n1 · unresolvable_source z2 · policy_invalid` ✓
- internal note alone → `internal_note` ("Chữ mẫu còn ghi chú nội bộ …") ✓
- `<script>alert(1)</script>` → `html_not_allowed` "Thẻ <script> không được phép"; mixed case `<ScRiPt>` → same ✓; `<p onclick="x()">` → `html_not_allowed` ✓; `<a href="javascript:alert(1)">` → 3× `html_not_allowed` ✓
- policy: permission `nuke:all` → `policy_invalid` `steps[0]: quyền "nuke:all" không tồn tại`; `{mode:"steps",steps:[]}` → `policy_invalid` "phải có ít nhất một bước"; rule var `hax` → `policy_invalid` "biến "hax" không hợp lệ (discount_bps, total)" ✓
- `{{#if so_bao_gia}}x` → `unbalanced_if` "Có 1 khối {{#if}} chưa đóng"; `{{ Ten }}` → `placeholder_without_field` "sai cú pháp" ✓
- body 66 000 × `a` → `too_large` "Chữ mẫu 68366 byte, vượt giới hạn 65536 byte"; 77 fields → `too_large` "Mẫu có 77 trường, tối đa 60" ✓
- Zod-level (422 `validation`): unknown top-level key, unknown key inside `fields[0]`, duplicate field key ("duplicate field key 'so_hop_dong'"), `choice` without options, empty body, `expected_version_no:"x"`, 11 steps ("too big: expected at most 10 items") ✓ (but see deviations).
- **entity-encoded** body suffix `&lt;script&gt;alert(1)&lt;/script&gt; &#60;script&#62;` → **201, stored as v5** (see Result D1).
- Failed-attempt bookkeeping: `template.version_created` audit rows = 4 (v2, v3, v4, v5); none for any 422/409 attempt ✓

### AC-6 two at once
- two curls in parallel, same `expected_version_no:5` → `race2 201` (version_no 6) + `race1 409 "Template changed"` (stale); `versions:[6,5,4,3,2,1]` — no gap, no duplicate ✓
- sequential stale: `expected_version_no:1` (current 4) → 409 `type …/errors/stale`, `detail:"expected_version_no is not the current version; reload and retry."`; `expected_version_no:99` → 409 stale ✓

### AC-7 idempotency
- replay of the v4 request with the same `Idempotency-Key` → 201, `jq -S` of the response identical to the first (same version id `01M3PX7A9PHXR85F9EDHG0VHJX`); `versions` still `[4,3,2,1]` ✓
- key `x` → 422 "Invalid Idempotency-Key header"; anonymous + valid key → 401 ✓

### AC-8 access
- ql and nv `POST /templates/{id}/versions` → 403 Problem+JSON `Missing required permission`; `POST /templates` → 403 (4 calls); `GET /audit?action=permission.denied` (gd) 9 → **13** rows; new rows e.g. `{action:permission.denied, actor_name:"P2 nhan_vien", target:"/templates/01K6C0NTRACT000000000TP001/versions", metadata:{permission:"template:write", method:"POST", path:"…/versions"}, ip:"::1"}` ×4 (ql + nv × two routes) ✓
- versions list after the 4 refused writes unchanged (`[5,4,3,2,1]`) ✓ · technical admin `POST …/versions` → 403 ✓ · no cookie → see Attack.

### AC-9 audit
- `GET /audit?action=template.version_created` (gd) → 4 rows (versions 2,3,4,5; later v6 is a 5th) `{actor_name:"P2 giam_doc", target:"template:01K6C0NTRACT000000000TP001", metadata:{version_no:5, fields:17}, ip:"::1"}`; `?action=template.created` → seed row `{actor_name:null, target:"template:01K6…TP001", metadata:{version_no:1, fields:17}, ip:null}` + my new template `{actor_name:"P2 giam_doc", metadata:{version_no:1, fields:1}}` ✓ — exactly one row per successful post
- full `/audit` dump (all pages, 13 017 bytes) grep `Điều 5|CÔNG TY TNHH|0071 0004|Nhật Minh|Nguyễn Văn Trỗi|<p>|Xin chào` → **0** hits (no body in audit) ✓

### AC-10 no update / delete
- `jq '.paths'` → `/templates` get+post, `/templates/{id}` get, `/templates/{id}/versions` post — no PATCH/PUT/DELETE ✓
- `PATCH|PUT|DELETE` on `/templates`, `/templates/{id}`, `/templates/{id}/versions` as gd (9 calls) → all **404**; nv `PATCH` → 404 ✓
- raw UPDATE/DELETE on `template_versions` vs the trigger: NOT run here (direct DB access refused); owned by the AC-10 integration test.

### AC-11 new template + duplicate
- gd `POST /templates` `{type:"contract", name:"P2 mẫu thử 224001", subject_type:"customer", version:{…1 field, approval_policy:{mode:"none"}}}` → 201 `{id:"01M3PX8DQGX9QSPQ7XVEY6VXM6", version_no:1}` ✓
- same name → 409 `Template name already exists`, `existing_id` = that id; `"  P2 MẪU THỬ 224001  "` (upper case, spaces) → 409 same `existing_id`; `"hợp đồng cung cấp dịch vụ phần mềm"` → 409, `existing_id:"01K6C0NTRACT000000000TP001"` (seed) ✓
- `type:"invoice"` → 422; unknown key `is_admin` → 422 "unrecognized key(s) in object" ✓
- nv `GET /templates` now lists 2 names (my test template stays in local D1).

### Attack pass
- no cookie: `GET /templates`, `GET /templates/{id}`, `POST /templates`, `POST /templates/{id}/versions` → all **401**, body `{title:"Request failed", detail:""}`, no template data (grep `CÔNG TY|fields` → 0) ✓; anonymous + `Idempotency-Key` → 401 ✓
- CSRF: gd `POST` without `Origin`/`X-Requested-With` → 403; `Origin: https://evil.example` → 403; anonymous without headers → 403 ✓
- ids: `/templates/nope` → 422; `/templates/' OR 1=1--` → 422; unknown ULID → 404 `Template or version not found`; `POST /templates/nope/versions` → 422; unknown ULID POST → 404 `Template not found` ✓
- `version_no` `abc` / `0` / `-1` / `1.5` / `99999999999999999999` → 422; `99` → 404 ✓ · `limit=51|0|abc` → 422, `cursor=garbage` → 422, `q=' OR 1=1--` → 200 (ignored) ✓
- malformed JSON → 400 ✓ · unknown keys at root / in `fields[]` → 422 ✓
- session note: gd's access cookie expired mid-run (a `GET` → 401 `detail:""`), a fresh `POST /auth/login` fixed it — expected token TTL, not a template bug.

### Human checklist (open http://localhost:8787/docs; Swagger loads from cdn.jsdelivr.net — page must render with no CSP error in the console. Swagger cannot easily set the two write headers; use curl for POSTs)
- Login `POST /auth/login` as gd / ql / nv → `GET /templates` → ONE row "Hợp đồng cung cấp dịch vụ phần mềm", version 1, `required_fields` has `chuc_vu_nguoi_ky` (local D1 now also has "P2 mẫu thử …" and template versions 2–6 from this run).
- `GET /templates/{id}` → fields with `required`, `source` (`subject:*` / `price_list:*` / `derived:*` / `manual`), `approval_policy` with "Quản lý duyệt" + "Giám đốc duyệt" (discount > 10%), body has Bên A + `{{#if so_bao_gia}}`, no "Ghi chú nội bộ".
- as Giám đốc: post a new version with `expected_version_no` = current → 201, `GET` shows it as current, `?version_no=1` still shows the original text.
- post again with the old `expected_version_no` → 409 stale; post a body with `<script>` → 422 `html_not_allowed`; a `{{ten_cong_ty}}` with no field → 422 `placeholder_without_field` (list of all errors).
- as Quản lý / Nhân viên: POST → 403; then as Giám đốc `GET /audit?action=permission.denied` → the row with `template:write`.
- `GET /audit?action=template.version_created` → your post, `version_no` only, no contract text.
- as admin `GET /templates` → 403; log out → `GET /templates` → 401; Swagger lists no PATCH/PUT/DELETE under `/templates`.

### Result
- AC-1, AC-2, AC-3, AC-4 (with `source:""`), AC-5 (script/onclick/javascript:/mixed-case/policy/oversize/internal note), AC-6, AC-7, AC-8, AC-9, AC-11 → PASS on the running app. AC-10 → PASS at API level (OpenAPI + 404s); trigger part NOT exercised here. FIX-01 CSP allows cdn.jsdelivr.net ✓.
- FAIL / deviations (not fixed here; go back to the plan):
  - D1 (AC-5 / card attack list): entity-encoded markup (`&lt;script&gt;…`, `&#60;script&#62;`) is accepted and stored (v5); the card expects 422. It renders as inert visible text if body is HTML, so no script runs, but the text lands in the contract. Decide: reject entities in body or accept and document.
  - D2 (AC-4): a field with `required:true` and the `source` key omitted or `null` → 422 `validation` "fields.N.source expected string", not `template-check-failed` / `required_field_without_source`; only `source:""` yields the check code.
  - D3 (SPEC §4 Input): 11 approval steps → 422 `validation` ("too big: expected at most 10 items"), not `too_large`; 77 fields does give `too_large`. Same status, different code.
  - D4 (card): DB-level checks (grep stored bodies, raw UPDATE/DELETE vs trigger) not run here — direct sqlite access denied by the permission classifier.
- Observations (not failures): list `created_by_name:null` for the seed (actor NULL) ✓ as designed; 401 body has empty `detail`; PROOF left local D1 at template v6 + a second template.
- Driver decisions on D1–D4 (2026-09-29):
  - D1 accepted: entities render as visible text, never markup (merge escapes + render sanitizes); no script can run. Not a 422 — logged as a known behaviour.
  - D2, D3 accepted: same 422, shape layer answers first; `template-check-failed` stays for everything the shape allows.
  - D4 covered by the automated AC-10 test (trigger refuses UPDATE/DELETE on seeded rows) — green in `templates-acceptance` 12/12.
- Checks (driver, commit 8713f7d/8ba72b7): `templates-acceptance` 12/12 · `template-seed-check` 2/2 · `template-check` 15/15 · `pnpm typecheck` 7/7 · api lint clean. Full API suite: 207 pass; failures only in rows not built yet (contracts-acceptance, web-shell AC-1).
- Human approval: [x] 2026-09-29 (D1–D3 accepted)
