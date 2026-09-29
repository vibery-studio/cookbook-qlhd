# PLAN-01: Nền — vai trò, người dùng (mời vào), nhật ký, khách hàng, bảng giá

Status: Done 2026-09-29
Spec: docs/spec/SPEC-01.md

## 1. Acceptance tests — written first, seen failing
File: `apps/api/test/integration/foundation-acceptance.test.ts` (10 tests). Red run 2026-09-29:
`CI=true pnpm --filter @runway/api exec vitest run test/integration/foundation-acceptance.test.ts` → `Failed Tests 10`.
| AC | How it's proven | Fails now? (real output) |
|---|---|---|
| AC-1 | `AC-1: admin invites the 3 roles…` · `AC-1: duplicate email → 409; unknown role → 422` | `expected 404 to be 201` (no `POST /admin/users`) |
| AC-2 | `AC-2: public signup is off by default…` | `expected undefined to be +0` (signup still on, no marker) |
| AC-3 | `AC-3: a role change and a disable take effect…` | `expected 404 to be 201` |
| AC-4 | `AC-4: the last active admin cannot…` | `expected 404 to be 409` (no `PATCH /admin/users/{id}`) |
| AC-5 | `AC-5: a refused call is written to the audit log…` | `expected 404 to be 201` |
| AC-6 | `AC-6: customers — duplicate phone…` · `AC-6: search by name / phone; no DELETE route` | `expected 404 to be 201` |
| AC-7 | `AC-7: the price list answers by date…` | `expected 404 to be 201` |
| AC-8 | `AC-8: not logged in → 401…` | `/customers: expected 404 to be 401` |

## 2. Files that change
| File | New / Modify | Why (FR) |
|---|---|---|
| `packages/rbac/src/catalog.ts` · `ROLE_NAMES` | M | 7 permissions, 3 roles (FR-1) |
| `apps/api/src/db/schema.ts` + `migrations/0009_*.sql` (generated) + `0010_seed_foundation.sql` | M / N | `users.display_name`, `audit_events`, `customers`, `price_list`; seed roles/grants/prices, `signup.enabled`=0 (FR-1,3,4,5,6) |
| `apps/api/src/flags/registry.ts` | M | `signup.enabled` default false (FR-3) |
| `apps/api/test/apply-migrations.ts` | M | record migrated signup default → `globalThis.__SIGNUP_DEFAULT__`, then re-enable for RUNWAY fixtures (risk 1) |
| `apps/api/src/dto/{users,audit,customers,price-list}.ts` | N | OpenAPI schemas (contract-first) |
| `apps/api/src/routes/{admin-users,audit,customers,price-list,roles}.routes.ts` · `routes/index.ts` | N / M | the 11 endpoints of SPEC §3 |
| `apps/api/src/routes/admin.routes.ts` · `auth.routes.ts` | M | list + `display_name`; `/auth/activate`; `auth.login` audit (FR-3,4) |
| `apps/api/src/observability/logger.ts` · `middleware/require-permission.ts` | M | dual-write to `audit_events`; `permission.denied` on deny (FR-4) |
| `apps/api/src/dao/{audit,customer,price-list}-dao.ts` · `dao/user-dao.ts` · `dao/verification-token-dao.ts` | N / M | pure queries; CAS; `invite` purpose |
| `apps/api/src/services/{user-admin,customer}-service.ts` · `services/admin-service.ts` | N / M | invite, role swap, disable + revoke, last_admin; dedupe + CAS (FR-2,3,5) |
| `apps/api/src/utils/{phone,vn-date}.ts` | N | `normalizePhone`, `todayInVN` (FR-5,6) |
| `scripts/dev-seed-admin.ts` | M | `--name` → `display_name` (FR-3) |
| `packages/client/src/generated/*` | M | `pnpm client:generate` |

## 3. Cards — one small job each, in order (docs/plan/cards/C-01-NNN.md)
- [C-01-001] Schema + migrations + catalog + signup-off → unblocks AC-1…AC-8
- [C-01-002] OpenAPI contract for the 11 endpoints (501 stubs) + client:generate → unblocks AC-1…AC-8 · depends on C-01-001
- [C-01-003] Audit store: logger dual-write, `permission.denied`, `auth.login`, `GET /audit` → AC-5, AC-8 · depends on C-01-002
- [C-01-004] Users: invite, activate, role/disable with last_admin, `GET /roles`, list `display_name` → AC-1, AC-2, AC-3, AC-4 · depends on C-01-003
- [C-01-005] Customers: create / edit (CAS) / get / search, dedupe by phone + tax code, audit in batch → AC-6 · depends on C-01-003
- [C-01-006] Price list by date (VN zone) → AC-7 · depends on C-01-002
- [C-01-007] PROOF: full suite, Swagger walkthrough, attack pass, PROOF log → AC-1…AC-8 · depends on all

## 4. Risks
- (1) Signup off breaks RUNWAY's own suites (`createMember`/`createAdmin` sign up): test setup re-enables it after recording
  the migrated value; AC-2 asserts the recorded value is 0. Production/dev keep it off.
- (2) Existing audit calls are fire-and-forget (Logpush); the D1 write goes through `ctx.waitUntil` and swallows errors — right for
  login/denied noise. Customer rows + their audit row go in ONE `db.batch` (workbook §9 "fire-and-forget audit").
- (3) `admin` bypasses ownership checks (`policy.ts:28`): harmless here because `admin` gets no `contract:*`; row 3's SoD check stays explicit.
- (4) Disable must bite on the next request even with a valid 120 s access JWT: `auth.ts:102` already returns null for disabled
  users once the principal cache is invalidated → invalidate + revoke refresh tokens in the same service call.
- (5) Seeded roles use fixed ULID literals (house convention, `0001_seed_rbac.sql`).
- ENGINEERING.md conflicts: none — schema is expand-only; no destructive SQL.

## 5. Trace check (before the STOP)
- [x] every FR has at least one AC · every AC has a row in §1 · every AC is served by a card · every "now" edge case has an AC

## 6. PROOF log (step 5)
Checks (2026-09-29, after merge, commit 6e45268): `pnpm typecheck` → `Tasks: 6 successful, 6 total` · `pnpm lint` → green ·
`pnpm build` → green · `CI=true pnpm test` → client 10 · rbac 17 · config 3 · email-templates 27 · auth 37 ·
api `158 passed | 2 skipped (160)` (foundation-acceptance 10/10) → `Tasks: 7 successful, 7 total`.
Run 2026-09-29 on the real app: fresh local D1 (`apps/api/.wrangler/state` moved to /tmp), `pnpm db:migrate:local` (0001..0010 ✅), `pnpm dev` (:8787), `RUNWAY_LOCAL=1 pnpm dev:seed-admin` → `login: 200 ✓`. curl + cookie jar per user, headers `Origin: http://localhost:8787` + `X-Requested-With: fetch`. No vitest run here; lint/typecheck/build/test (C-01-007 step 1) NOT run by this pass.
- `GET /openapi.json | jq '.paths|keys'` → lists `/admin/users`, `/admin/users/{id}`, `/admin/users/{id}/invite`, `/audit`, `/auth/activate`, `/customers`, `/customers/{id}`, `/price-list`, `/roles` (+ existing) → visible in /docs.

### AC-1 roles + invite + activate
- admin `POST /auth/login` → 200; `GET /me` → roles `[admin]`, perms flags/audit:read/notes/users:read+write/settings — no `contract:*`, no `template:write` ✓
- admin `POST /admin/users` gd / ql / nv (names "Nguyễn Văn Giám Đốc" · "Trần Thị Quản Lý" · "Lê Văn Nhân Viên") → 201 `{user{status:pending,roles:[..]}, activation_url:".../activate?token=<43 chars>", expires_at}`; expires_at − now = 259193 s ≈ 72 h ✓
- email `" GD@Example.vn "` → stored `gd@example.vn` (trim+lowercase) ✓; same email again → 409 `Email already registered`; role `boss` → 422 (expected one of giam_doc, quan_ly, nhan_vien)
- `PATCH /admin/users/{gd} {display_name}` → 200 renamed ✓
- `POST /admin/users/{gd}/invite` twice → 200 new url each; first link and 1st re-issued link → 400 invalid_or_expired_token (old link dies) ✓
- `POST /auth/activate` weak password `short` → 422; valid → 204 ×3; each `POST /auth/login` → 200
- `GET /me` giam_doc → contract:read/issue/write/submit/approve, template:write, audit:read, users:read/write; quan_ly → contract:read/issue/write/submit/approve, audit:read; nhan_vien → contract:read/write/submit ✓ (matches workbook matrix: QL all but template:write/users)
- `GET /roles` (admin) → 200, 5 roles (admin, giam_doc, member, nhan_vien, quan_ly) with permission lists ✓ (matrix equals the /me results above)
- `POST /admin/users/{active user}/invite` → 409 `already-active`; unknown id → 404

### AC-2 signup off / token reuse
- `POST /auth/signup` → 503 `Signups are temporarily disabled` ✓
- reuse of used activation link → 400 `invalid-or-expired-token` ✓ (expired path: not waited 72 h; covered by superseded-link 400 + unit tests)

### AC-3 demote / disable take effect next request
- ql `GET /audit` → 200; gd `PATCH {role:nhan_vien}` → 200; ql next `GET /audit` → **403**; ql `/me` → roles `[nhan_vien]` ✓
- gd `PATCH {status:disabled}` → 200; ql next `GET /me` → **401**; `POST /auth/refresh` → 401 `session revoked`; re-login → 403 `Account disabled` ✓ (re-enabled after: 200)

### AC-4 last admin
- admin `PATCH self {status:disabled}` → 409 `last-admin`; `{role:giam_doc}` → 409 `last-admin`; giam_doc `PATCH admin {status:disabled}` → 409 `last-admin`; admin still `GET /me` → 200 ✓

### AC-5 audit
- nv `GET /audit` → 403 Problem+JSON `Missing required permission`
- gd `GET /audit?action=permission.denied` → 4 rows, newest first, e.g. `{action:permission.denied, actor_name:"Lê Văn Nhân Viên", target:"/audit", metadata:{permission:"audit:read",method:"GET",path:"/audit"}, ip:"::1"}` ✓ (also users:read/users:write rows for the nv attack calls)
- `GET /audit?limit=50` → 21 rows incl. `auth.login`, `user.invited`, `user.activated`, `user.renamed`, `customer.*`; `limit=5` → 5 items + `next_cursor` ✓

### AC-6 customers
- nv `POST /customers` `{name:"Cửa hàng Hoa Mai", phone:"0901 234 567", tax_code:"0312345678", ...}` → 201 version 1
- phone `+84901234567` / `0901.234.567` / `0901234567` → 409 `duplicate` + `existing_id` = the first customer ✓; same tax_code → 409 + existing_id ✓; same name, other phone → 201 (allowed) ✓; tax_code `abc` → 422
- 2× `PATCH` with `expected_version:1` (nv then ql) → 200 version 2, then **409 stale** ✓
- search `q=Hoa` → 2 names; `q=0901234567` / `q=+84901234567` / `q=0312345678` → the customer ✓; `limit=51` → 422; no DELETE route (`DELETE /customers/{id}` → 404) ✓
- audit `customer.created` metadata `{fields:[name,tax_code,email,address,phone]}`, `customer.updated` metadata `{fields:[contact_person]}` — one row per change, names only, no values ✓; grep of full audit dump for `0901|hoamai|Lê Lợi|0312345678|0987654321` → 0 hits

### AC-7 price list
- `GET /price-list?date=2026-06-30` → G6 unit_price **2400000** (effective_to 2026-06-30), DT14 0, G3 1500000, G12 4800000
- `?date=2026-07-01` → G6 **2700000** (effective_from 2026-07-01, note "tăng giá từ 01/07/2026")
- no date → `date:"2026-09-29"`, G6 2700000 ✓; `date=2026-13-45` → 422 `not a real calendar date`; `date=abc` → 422 ✓
- (00:30 VN boundary needs a clock trick; not exercisable by curl — covered by the unit test of `todayInVN`)

### AC-8 not logged in / wrong role
- no cookie: `GET /customers`, `GET /customers/{id}`, `POST /customers`, `PATCH /customers/{id}`, `GET /price-list`, `GET /roles`, `GET /audit`, `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/{id}`, `POST /admin/users/{id}/invite` → all **401**, body has no data ✓
- nv `POST /admin/users` → 403 + `permission.denied` row (users:write, ip ::1) ✓

### Attack pass
- nv `PATCH /admin/users/{ql} {role}` → 403; nv `PATCH self {role:giam_doc}` (self-escalation) → 403; nv `GET /admin/users` → 403; all logged as permission.denied ✓
- admin (technical account) `GET /customers` → 403 (no contract perms, DEC-1) ✓
- non-existent customer id: `GET` → 404 `Customer not found`, `PATCH` → 404 (no data leak, same body for both) ✓
- activation token: `""`/`x`/`' OR 1=1 --` → 422; 43-char tampered (last char changed) → 400; 43×`A` → 400; malformed JSON → 400 ✓
- unknown extra field on `POST /customers` (`is_admin`, `created_by`) → 422 `unrecognized key(s)` ✓
- CSRF: write without Origin/X-Requested-With → 403; `Origin: https://evil.example` → 403 ✓
- `q=' OR 1=1 --` → 200 `items:[]` (parametrized) ✓; garbage `cursor` → 422 on /customers and /audit ✓
- full audit dump grep `password|correct-horse|activation|token=` → 0 hits (no token/secret in audit) ✓
- customer phone/email/address/tax_code in audit metadata → none (see AC-6) ✓

### Human checklist (open http://localhost:8787/docs; Authorize is cookie based, so login via `POST /auth/login` in Swagger first; write calls in Swagger may need the two headers — curl is easier)
- AC-1: login admin@runway.local → `GET /me` no `contract:*` · `POST /admin/users` (giam_doc, quan_ly, nhan_vien) → copy `activation_url` token → `POST /auth/activate` → 204 → login each → `/me` shows the role matrix, `GET /roles` same.
- AC-2: `POST /auth/signup` → 503; activate the same token again → 400.
- AC-3: as Giám đốc `PATCH /admin/users/{ql} {"role":"nhan_vien"}` → Quản lý's next `GET /audit` → 403; `{"status":"disabled"}` → their next call 401.
- AC-4: as admin `PATCH /admin/users/{admin id} {"status":"disabled"}` → 409 last-admin.
- AC-5: Nhân viên `GET /audit` → 403; Giám đốc `GET /audit?action=permission.denied` → the row with actor, `audit:read`, ip.
- AC-6: `POST /customers` phone `0901 234 567` then `+84901234567` → 409 with `existing_id`; two `PATCH` with the same `expected_version` → 200 then 409; `GET /audit?action=customer.updated` → field names only.
- AC-7: `GET /price-list?date=2026-06-30` → G6 2.400.000; `2026-07-01` → 2.700.000; no date → today's.
- AC-8: logout / no cookie → `/customers`, `/audit`, `/price-list`, `/admin/users` → 401; Nhân viên `POST /admin/users` → 403.

### Result
- AC-1..AC-8 PASS against the running app; no deviation from SPEC-01 found.
- Not done here: lint/typecheck/build/full test suite (C-01-007 step 1); expired-link (72 h) and 00:30-VN-boundary cases not reproducible from curl.
- Observations (not failures): (a) `updated_at` after a PATCH equalled `created_at` in the response (same second, cannot tell; check if it is bumped); (b) `giam_doc` (not only admin) is also refused by last-admin when disabling the admin — consistent with the SPEC rule; (c) `GET /price-list` returns 6 active rows on any date (7 seed rows, G6 has two versions); (d) 401 body has empty `detail`.
- Human approval: [ ]
