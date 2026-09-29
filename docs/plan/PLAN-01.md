# PLAN-01: Nền — vai trò, người dùng (mời vào), nhật ký, khách hàng, bảng giá

Status: Approved 2026-09-29
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
- Checks: [command] → [real output]
- Human checklist: [do → must see]
- Attack (personal data / access): [what was tried → result]
- Result: [ ]
