# PLAN-04a: Giao diện nền `apps/web` (khung, đăng nhập/kích hoạt, Khách hàng, Phân quyền, Nhật ký, Người dùng)

Status: Done 2026-09-30
Spec: docs/spec/SPEC-04a.md

## 1. Acceptance tests — written first, seen failing
Files: `apps/api/test/integration/web-shell-acceptance.test.ts` (3 tests, API half, compiles now: `tsc --noEmit` on apps/api → 0 errors) ·
`apps/api/test/raw-imports.d.ts` (types for `?raw`) · `apps/web/e2e/shell.smoke.spec.ts` (the ONE UI spec; **cannot compile or run until
C-04a-001 (package.json, tsconfig, @playwright/test) and C-04a-006 (fixtures/global-setup/playwright.config copied from the e2e-kit) land** — written now so the
UI contract (labels, testids) is fixed before cards 002-005) · 1 unit test for `problem-messages` (card 001) · human checklist (§6).
Red run 2026-09-29 (driver): `CI=true pnpm --filter @runway/api exec vitest run test/integration/web-shell-acceptance.test.ts` → `Tests 3 failed (3)`. Expected: `/me` test fails (`display_name` missing); AC-1 tests fail (no `[assets]` block in wrangler.toml).
| AC | How it's proven | Fails now? |
|---|---|---|
| AC-1 | API: `AC-1: every OpenAPI path matches run_worker_first…` + `AC-1: SPA screen URLs are NOT swallowed…` (all 3 env blocks). Human: curl 5 SPA URLs → 200 HTML, `/customers` → 401 Problem+JSON, `/docs` opens | `[assets] run_worker_first missing in wrangler.toml` · `expected null not to be null` |
| AC-2 | Smoke spec (login via saved state) is NOT this AC; human checklist (login redirect `next`, wrong password, `//evil.com`). Unit-test candidate for `safeNext()` lives in card 002 | n/a (UI) |
| AC-3 | Human checklist (activation link, address bar has no token, reuse → expired message) | n/a (UI) |
| AC-4 | Smoke spec asserts console + web storage carry no token/customer data; human: DevTools cookies HttpOnly | pending (spec cannot run yet) |
| AC-5 | Human checklist (delete `runway_at` → 1 `POST /auth/refresh`; delete both → `/login`) | n/a (UI) |
| AC-6 | Smoke spec: Nhân viên has no Nhật ký/Người dùng link, `/nhat-ky` → 🔒 + "Bạn không có quyền", zero `GET /audit`; Giám đốc sees `customer.created` row. Human: `permission.denied` row is danger-coloured | pending |
| AC-7 | Smoke spec: duplicate phone `0901 234 567` vs `+84901234567` → Vietnamese warning + "Xem khách đó", modal keeps typed content, Nhật ký row. Human: two-tab stale edit | pending |
| AC-8 | Human checklist (matrix equals `GET /roles`, 3 roles + admin) | n/a (UI) |
| AC-9 | `problem-messages.test.ts` (every `ProblemType` slug → non-empty Vietnamese, no raw `detail`); human: DevTools offline + Thử lại | pending |
| AC-10 | Human checklist (throttled skeleton · empty with one action · error with Thử lại, per screen) | n/a (UI) |
| AC-11 | Human checklist at 390px + eye check on 3 screenshots (`PROOF_SHOTS=1` inside the one smoke run) | n/a (visual) |
| AC-12 | Human checklist (keyboard only, Esc returns focus, reduce-motion) | n/a (UI) |
| AC-13 | Command: `grep -rEn "#[0-9a-fA-F]{3,8}" apps/web/src` hits only `theme.css`; `grep -rEn "\[#|-\[[0-9]+px\]" apps/web/src` → none | n/a (command) |
| AC-14 | Human checklist (invite → link once → "Tạo lại link"; last-admin lock; demote QL → loses Nhật ký after reload) | n/a (UI) |
| DEC-6 | API: `DEC-6: GET /me returns display_name…` | `expected { …(4) } to have property "display_name"` |
Browser ACs stay human/eye-checked by design (UI proof budget: ONE smoke spec, run once at PROOF, after the API suite; no repeat runs).

## 2. Files that change
| File | New / Modify | Why (FR) |
|---|---|---|
| `apps/api/src/routes/me.routes.ts` (+ DTO in it) | M | `display_name` in `GET /me` (DEC-6) |
| `packages/client/src/generated/*` | M | `pnpm client:generate` (shared) |
| `apps/api/wrangler.toml` | M | `assets` in default + `[env.preview.assets]` + `[env.production.assets]`, `run_worker_first` list (FR-1) — shared |
| `scripts/validate-wrangler.ts` | M | `assets` parity across 3 env blocks |
| `docs/cookbook/design/FEEL.md` | M | breakpoint token 768px (FR-3) |
| `turbo.json` · root `package.json` · `pnpm-lock.yaml` · `pnpm-workspace.yaml` (if needed) | M | web builds before api; workspace (shared, serialized) |
| `apps/web/{package.json,vite.config.ts,index.html,tsconfig*.json,eslint config,public/_headers,dist/.gitkeep}` | N | scaffold (FR-1,2) |
| `apps/web/src/{main.tsx,styles/theme.css,app/**,ui/**,lib/**}` | N | tokens, shell, guard, registry, shared UI, problem-messages (FR-2,3,6,7,12,13) |
| `apps/web/src/features/{auth,customers,roles,audit,users}/**` | N | stubs at 001, real at 002-005 (FR-4,5,8,9,10,11) |
| `apps/web/{playwright.config.ts,e2e/global-setup.ts,e2e/fixtures.ts}` | N | copied from e2e-kit (card 006) |
| `apps/web/e2e/shell.smoke.spec.ts` | N (written now) | the one smoke |
| `apps/api/test/integration/web-shell-acceptance.test.ts` · `apps/api/test/raw-imports.d.ts` | N (written now) | AC-1, DEC-6 |
| `docs/cookbook/design/DESIGN.md` | M (PROOF) | 7th screen Người dùng (DEC-2) |

## 3. Cards
- [C-04a-000] `display_name` in `GET /me` + `pnpm client:generate` → DEC-6 · no dependency
- [C-04a-001] scaffold + tokens + shell + guard + registry + problem-messages + wrangler assets + FEEL breakpoint → AC-1, AC-13 (+ unblocks all) · no dependency (disjoint from 000)
- [C-04a-002] auth pages (`/login`, `/activate`) → AC-2, AC-3, AC-4, AC-5 · depends on 001
- [C-04a-003] Khách hàng → AC-7, AC-9, AC-10 · depends on 001
- [C-04a-004] Phân quyền + Nhật ký → AC-6, AC-8 · depends on 001
- [C-04a-005] Người dùng → AC-14 · depends on 001
- [C-04a-006] smoke e2e wiring + PROOF → AC-1…AC-14 · depends on 002, 003, 004, 005 (and 000)

Parallel groups (driver dispatches): **A** = 000 ‖ 001 (disjoint files; 000 owns `apps/api/src` + `packages/client/src/generated`, 001 owns web root, wrangler, scripts, turbo, lockfile).
**B** = 002 ‖ 003 ‖ 004 ‖ 005, each owning ONLY `apps/web/src/features/<x>/**` (nobody edits `app/ ui/ lib/ package.json`; need a shared component → keep it in the feature folder, ask 001's owner to lift it). **C** = 006 alone.
Shared, serialized by the driver: `packages/client/src/generated/*`, `apps/api/src/routes/index.ts`, `apps/api/src/db/schema.ts` + `migrations/meta`, `packages/rbac/src/catalog.ts`, root `package.json`, `pnpm-lock.yaml`, `apps/api/wrangler.toml` (001 now; rows 02-04b append their route paths to `run_worker_first` in the card that creates the route — a later card must not run in parallel with another that edits this file).
Cross-row: 04a adds no migration and no schema; 04a owns `apps/web/**`, wrangler `assets`, `/me` display_name.

## 4. Risks
- (1) API vitest/`wrangler dev` read `assets.directory = ../web/dist`; missing dir may fail every API test → `dist/.gitkeep` committed and confirmed by running one existing API test + `wrangler dev` in 001 (fallback: test config overrides assets). The new AC-1 test reads `wrangler.toml` via `?raw` — if the workers pool cannot resolve it, switch to a pre-generated JSON (decide in 001, report).
- (2) Unverified facts to research BEFORE writing config (001): `run_worker_first` array with `/customers` vs `/customers/*` overlap; `directory` relative to the wrangler file; `_headers` syntax for `index.html`; `RouterProvider` import path (`react-router/dom`?); `QueryClientProvider` setup; Vite proxy `Origin` override; Tailwind v4 `--color-*: initial`; font self-hosting; `assetsInlineLimit: 0`.
- (3) Route added by rows 02-04b but missing from `run_worker_first` → AC-1 test red (intended); an SPA URL accidentally matching a pattern (e.g. a future `/contracts`) → the second AC-1 test guards SPA URLs, but 4b must choose Vietnamese SPA URLs.
- (4) `_headers` CSP/`assets` not applied by `wrangler dev` exactly like prod; verify locally, note in PROOF (deploy is the human's).
- (5) `client:generate` drift (CI) — 000 must commit generated files in the same commit as the route.
- (6) Guard is UX only; API still decides (`permission.denied` audited on direct calls).
- (7) One smoke spec on a real build is the only browser proof; smoke needs `apps/api/.dev.vars` and a free port 8791 (`free-ports.sh` once, no polling).
- ENGINEERING.md conflicts: none. (Wrangler `assets` mirrored in all 3 env blocks satisfies "bindings mirrored".)

## 5. Trace check (before the STOP)
- [x] every FR has at least one AC (FR-1→AC-1 · FR-2→AC-13 · FR-3→AC-11 · FR-4→AC-2,5 · FR-5→AC-3 · FR-6→AC-6,14 · FR-7→AC-9 · FR-8→AC-7 · FR-9→AC-8 · FR-10→AC-6 · FR-11→AC-14 · FR-12→AC-9,10 · FR-13→AC-11,12)
- [x] every AC has a row in §1 · every AC is served by a card (§3) · every "now" edge case has an AC (SPEC §9)
- [ ] driver red run recorded in §1

## 6. PROOF log (step 5)
Checks (fill at PROOF, real output): `pnpm lint && pnpm typecheck && pnpm build` · `CI=true pnpm test` (API + web unit) · THEN (serial) `bash docs/cookbook/e2e-kit/free-ports.sh 8791` and `PROOF_SHOTS=1 CI=true pnpm --filter @runway/web e2e` (once).
Human checklist (dev :5173 or real :8787; do → must see):
- AC-1: `curl -i localhost:8787/khach-hang` (also /phan-quyen /nhat-ky /nguoi-dung /activate) → 200 HTML · `curl -i localhost:8787/customers` → 401 Problem+JSON · `/docs` shows Swagger.
- AC-2: logged out, open `/khach-hang` → `/login?next=/khach-hang` · right password → back on `/khach-hang` · wrong password → "Email hoặc mật khẩu không đúng" · `/login?next=//evil.com` then login → lands on an internal screen.
- AC-3: Người dùng → invite → open the link: address bar has no `token` · set password → "Đã kích hoạt" → log in works · open the same link again → "hết hạn hoặc đã dùng".
- AC-4: DevTools → Application: no token in localStorage/sessionStorage · `runway_at`/`runway_rt` HttpOnly · Console empty of customer/token data.
- AC-5: delete cookie `runway_at`, click another screen → stay in app, Network shows exactly one `POST /auth/refresh` · delete `runway_rt` too → `/login`.
- AC-6: Nhân viên: no Nhật ký/Người dùng in sidebar; `/nhat-ky` → 🔒 + reason, no `GET /audit` · Giám đốc: Nhật ký shows the Nhân viên's `permission.denied` row in danger colour.
- AC-7: add `0901 234 567`, then `+84901234567` → Vietnamese duplicate warning + "Xem khách đó" · two tabs edit one customer, save tab 1 then tab 2 → "Người khác vừa sửa" + "Tải bản mới" · each action has a Nhật ký row.
- AC-8: Phân quyền matches `GET /roles` for 3 roles + admin ("Quản trị hệ thống"), readable by every role.
- AC-9: DevTools offline → click Thử lại / Lưu → "Hệ thống đang bận…", modal content kept, no English/raw code anywhere.
- AC-10: per screen: throttle → skeleton; empty state has one action; error has Thử lại.
- AC-11: 390px window: top bar + menu, tables become cards, modal full-screen, no horizontal page scroll, touch targets ≥ 44px (eye-check 3 screenshots: Khách hàng · Phân quyền · Nhật ký).
- AC-12: keyboard only: Tab reaches everything, focus visible, Esc closes modal and returns focus · OS "reduce motion" → no movement.
- AC-13: `grep -rEn "#[0-9a-fA-F]{3,8}" apps/web/src` → only `theme.css` · `grep -rEn "\[#|-\[[0-9]+px\]" apps/web/src` → nothing.
- AC-14: admin invites Nhân viên → link once; close, "Tạo lại link" → new link · last admin self-lock → Vietnamese last-admin message · Giám đốc demotes Quản lý → after reload they lose Nhật ký.
Attack (access/personal data): call each screen's URL logged out → `/login`; Nhân viên direct `/nguoi-dung` + direct API `GET /admin/users` → 403 + audit row; `next=//evil.com`, `next=https://evil.com`, `next=javascript:…` → ignored; token not in URL/Referer/console after activate.
Result: [pass | what failed] · visual nits → list for next row, no polish loop · human approval: [ ]

### PROOF log (C-04a-006, run 2026-09-29)
Driver checks at a4f4ac6 (not re-run by 006): typecheck 7/7 · lint 2/2 · web build ok · `CI=true pnpm test` -> api 247 passed | 2 skipped, web 35 passed.
e2e wiring: `@playwright/test` 1.63.0 (npm view = 1.63.0) devDependency of apps/web, script `e2e`; `playwright.config.ts` (port 8791, own D1 at `apps/api/.wrangler/e2e`), `e2e/global-setup.ts` (admin inserted into the e2e D1 like `dev:seed-admin`; Giám đốc/Quản lý/Nhân viên via real API `POST /admin/users` -> `POST /auth/activate`; one saved login each), `e2e/fixtures.ts` (sidebar labels Khách hàng/Phân quyền/Nhật ký/Người dùng).
Runs (budget exceeded with the human's OK each time; every red was a real bug or an ambiguous locator, fixed at the cause):
- Run 1 (006) RED: `strict mode violation: getByRole('button', { name: '+ Thêm khách' }) resolved to 2 elements` → customers-screen: toolbar CTA hidden while the list is empty (EmptyState keeps the one action).
- Run 2 (driver) RED: `locator.click … element is outside of the viewport` (Lưu) → theme.css `--spacing-*: initial` dropped the numeric scale, so `inset-0`/`top-0`/`translate-*-0` were never generated (modal overlay, sticky header, mobile drawer broken) → `--spacing-0: 0px`; `size-7` → `size-s6`.
- Run 3 RED: modal showed "Hệ thống đang bận", NO POST in the trace → `@runway/client` passed `request.body` (ReadableStream) to fetch; browsers reject it without `duplex` → EVERY SPA write was broken. Fix: buffer to ArrayBuffer (also makes the post-refresh retry re-sendable). Test `packages/client/test/typed-body.test.ts` red first (`RequestInit: duplex option is required when sending a body`) → green.
- Run 4 RED: `getByRole('dialog').getByText('Cửa hàng Hoa Mai') resolved to 2 elements` (alert text + loaded card) — app correct (201, then 409 → Vietnamese duplicate alert → "Xem khách đó" loads the card) → spec L48 asserts the card heading.
- Run 5 (PROOF, `PROOF_SHOTS=1`): `✓ 1 [desktop] › e2e/shell.smoke.spec.ts:18:1 › 4a smoke … (1.6s)` · `1 passed (13.8s)` · shots `khach-hang.png` `phan-quyen.png` `nhat-ky.png`.
Attack pass (driver, one-off Playwright probe on :8787 after run 5) found a 4th bug the smoke spec cannot see (it uses saved logins): a logged-out visitor stayed on "Đang kiểm tra phiên" forever — `onUnauthorized` did `removeQueries(["me"])` INSIDE the in-flight /me fetch, so the guard never got its 401. Fix: `onSessionLost` = `invalidateQueries(["me"], {cancelRefetch:false})`; test `apps/web/src/lib/session-lost.test.ts` red first (`Expected "error", Received "pending"`) → green. After the fix:
`logged-out /khach-hang|/phan-quyen|/nhat-ky|/nguoi-dung -> /login?next=%2F…` · `next=//evil.com`, `next=https://evil.com`, `next=javascript:alert(1)` → login lands on `/phan-quyen` (internal) · storage after login `{}{}`. Nhân viên `/nhat-ky` → 🔒 + reason, zero `GET /audit` (spec); `GET /admin/users` 403 + audit row owned by foundation-acceptance (row 01).
Checks after all fixes: typecheck 7/7 · lint 2/2 · web build ok · `CI=true pnpm test` → api 247 passed | 2 skipped, client 11, web 36.
Result: pass (smoke + attack pass). Visual nits (next row, no polish loop): top bar repeats the brand next to the sidebar brand and repeats the screen title (h1 in top bar + h1 in page) · role badge overflows the sidebar at long names (now truncated name, badge fits) · Phân quyền lists RUNWAY base perms (flags/notes/settings) without Vietnamese labels + base role "Thành viên" · Khách hàng nav item keeps a light highlight after leaving it · IP "—" on events written without a request IP.
Gap noted: the smoke spec never visits the app logged out — 4b's e2e should include one logged-out → /login step.
Human approval: [x] 2026-09-30
