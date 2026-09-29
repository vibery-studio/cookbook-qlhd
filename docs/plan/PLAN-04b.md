# PLAN-04b: Giao diện hợp đồng — Hợp đồng · Mẫu hợp đồng · Chờ tôi duyệt · bản in (+ API additive: khách issued_*, template_name/template_id, withdraw, delete, render SAMEORIGIN)

Status: Done 2026-09-30 (driver chốt — bạn ủy quyền "you decide … just finish it")
Spec: docs/spec/SPEC-04b.md (Approved 2026-09-30)
Roadmap row: 4b. Không migration, không schema; `run_worker_first` không đổi. Mọi card = subagent Claude (Codex đã nghỉ).

## 1. Acceptance tests — written first, seen failing
Files (viết trước, đã chạy đỏ 2026-09-30):
- `apps/api/test/integration/contracts-4b-acceptance.test.ts` — 11 test API, compile sạch (`tsc --noEmit` apps/api → 0 lỗi). Helper copy từ `contracts-acceptance.test.ts` (file đó không sửa). Mọi test đua có timeout 60_000.
- `apps/web/e2e/contracts.spec.ts` (desktop) + `apps/web/e2e/contracts.mobile.spec.ts` (390px) — KHÔNG chạy được đến khi card 002–006 + 007 (seed) xong; viết trước để khóa hợp đồng UI (nhãn tiếng Việt chính xác + testid, ghi ở đầu file). Không chạy ở PLAN (ngân sách e2e: 1 lần ở PROOF).
- Test đơn vị web: chỉ định trong card (module đích cố định) — `problem-messages.test.ts` (card 002, mở rộng file có sẵn), `percent-bps.test.ts` (card 002, module `apps/web/src/lib/percent-bps.ts`, hàm `parsePercentToBps(input: string): number | null`), `vn-date` ISO (card 002), `audit-sentence.test.ts` (card 002). Không viết đỏ trước vì module đích chưa có (sẽ làm hỏng `pnpm typecheck`); mỗi card ghi test phải đỏ trước khi code (theo CLAUDE.md).

Red run 2026-09-30: `CI=true pnpm --filter @runway/api exec vitest run test/integration/contracts-4b-acceptance.test.ts` → `Test Files 1 failed (1)` · `Tests 11 failed (11)`. Lý do đỏ (đúng chủ đích, không do lỗi test):
`issued_count` thiếu (`expected {…(11)} to match object {issued_count: 0…}`) · `template_name` thiếu (`expected false to be true`) · `can.withdraw/delete` thiếu · withdraw/DELETE chưa có route (`expected 404 to be 200/204/403/409`) · race: `expected [200, 404] to deeply equal [200, 409]` · render: `expected 'DENY' to be 'SAMEORIGIN'`.

| AC | Chứng minh bằng | Đỏ bây giờ? |
|---|---|---|
| AC-1 | Test 4a `web-shell-acceptance` (mọi path OpenAPI khớp `run_worker_first`, URL SPA không khớp) chạy lại sau 001c (route mới) + human `curl -i` 5 URL SPA | có sẵn (xanh); bảo vệ chiều ngược |
| AC-2 | e2e desktop bước "chưa đăng nhập" → `/login?next=` cho 5 URL | đỏ (UI chưa có) |
| AC-3 | e2e desktop: thiếu "Chức vụ người ký" → alert nêu tên → điền → tạo → drawer "Nháp · chưa có số" + bản in NHÁP trong iframe | đỏ (UI) |
| AC-4 | e2e (2.565.000 ₫ trong drawer) + human (bằng chữ, ngày, Network `giam_gia: 750` khi gõ 7,5, không ô tổng) + unit `parsePercentToBps` (card 002) | đỏ (UI) |
| AC-5 | e2e: gửi duyệt → Duyệt 🔒 + câu lý do; POST tay → 403; Giám đốc thấy `permission.denied` trong Nhật ký | đỏ (UI); API 403 đã có SPEC-03 |
| AC-6 | e2e: Quản lý pill "1" → Chờ tôi duyệt → Duyệt → phát hành → `HD-YYYY-001` | đỏ (UI) |
| AC-7 | Human (cần 2 Giám đốc, 1 người ở e2e) + API SPEC-03 đã phủ luật; câu tiếng Việt: unit `problem-messages` (card 002) | unit đỏ khi card 002 viết trước code |
| AC-8 | Human 2 tab (stale, phát hành đồng thời) + API SPEC-03 đua issue đã có | human |
| AC-9 | Human (DevTools offline, cùng `Idempotency-Key`); logic key: unit ở card 003 (`idempotency-key.test.ts`) | human + unit |
| AC-10 | e2e: hủy có lý do → "Đã hủy" + dải ĐÃ HỦY trong iframe; human: đổi tên khách rồi mở lại bản in, "Đã có bản thay thế" | đỏ (UI) |
| AC-11 | e2e: iframe `sandbox="allow-same-origin allow-modals"`; human: nút In mở hộp thoại (một lần, R-1), khách `<img onerror>` không alert | đỏ (UI) |
| AC-12 | Human checklist (chip trường, chuỗi bước, luật giảm >10%, không nút sửa) + e2e mở mẫu → nút tạo, không có "Sửa mẫu" | đỏ (UI) |
| AC-13 | API: test `AC-13` (issued only; voided/draft/pending loại; POST/PATCH/list/detail; hủy → giảm) + card 001a test số câu SQL (không N+1) + e2e thẻ khách "Chưa có hợp đồng đã phát hành" | API đỏ (`issued_count` thiếu) |
| AC-14 | Human (đếm `h1`, không mã quyền tiếng Anh, highlight sidebar) + e2e `h1` count = 1; unit nhãn quyền (card 002) | đỏ |
| AC-15 | e2e Nhân viên không thấy "Chờ tôi duyệt", zero `GET /approvals/mine`; human admin không có mục hợp đồng, `/hop-dong` → 403 không gọi API | đỏ (UI) |
| AC-16 | e2e mobile (thẻ, không `<table>`, drawer 390px, không cuộn ngang, chạm ≥ 44px) + human skeleton/rỗng/lỗi/Esc | đỏ (UI) |
| AC-17 | Unit web: `problem-messages.test.ts` (mọi slug `KNOWN_PROBLEM_SLUGS` + mọi `rule` + `already-decided`; không chứa `detail`/mã), `percent-bps.test.ts` (`7,5`→750, `7.5`→750, `100`→10000, `100,01`→null, `abc`→null), `vn-date` ISO tách chuỗi | thiết kế trong card 002 (red-first) |
| AC-18 | e2e: pill "1" → biến mất sau duyệt không F5 · Nhân viên không có `GET /approvals/mine`; human 2 tab + 1 request chung ở `/cho-toi-duyet` | đỏ (UI) |
| AC-19 | e2e: "+ Thêm khách mới" trong modal, modal hợp đồng giữ nguyên, khách được chọn; human: trùng SĐT → "Dùng khách này" | đỏ (UI) |
| AC-20 | API: test `AC-20 / DEC-6` (template_name, `template_id` lọc items + counts, kết hợp customer/created_by/status, lạ → rỗng, không ULID → 422) + human (chip lọc, F5 giữ bộ lọc, URL chỉ ULID) | API đỏ (`template_name` thiếu) |
| AC-21 | API: 3 test (`can.withdraw/delete` · withdraw thành công: draft, steps [], version+1, `submitted_at` NULL, 1 dòng `contract.withdrawn`, gửi lại được, lặp → 409 · từ chối: `already-decided` / `creator_only`+denied / issued 409 / 404 / 401) + e2e rút rồi gửi lại | API đỏ (route 404) |
| AC-22 | API: `AC-22` withdraw vs approve — đúng một thắng, không step mồ côi | đỏ (`[200,404]` ≠ `[200,409]`) |
| AC-23 | API: 3 test (204 + xóa hàng/steps + audit `{id}` không PII + dãy số liền + 404 lần 2 · 409 cho pending/approved/issued/rejected/voided, 403 creator_only + denied · nháp thay thế → `replaced_by_id` NULL) + e2e xóa nháp | API đỏ |
| AC-24 | API: `AC-24` delete vs submit — đúng một thắng, không step mồ côi | đỏ |
| AC-25 | API: `AC-25` `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'` ở `/render`, mọi route khác `DENY` + human: iframe hiển thị + nút In (kiểm trình duyệt thật) | đỏ (`'DENY'` ≠ `'SAMEORIGIN'`) |
Ngân sách UI: 1 desktop + 1 mobile e2e, chạy **một lần** ở PROOF sau suite API (`PROOF_SHOTS=1`, ảnh Hợp đồng · ngăn · bản in + mobile). AC-22/24 chỉ ở API.

## 2. Files that change
| File | New / Modify | Why (FR) | Card |
|---|---|---|---|
| `apps/api/src/dao/customer-dao.ts`, `dto/customers.ts` | M | `issued_*` (FR-12) | 001a |
| `apps/api/src/dao/contract-read-dao.ts`, `dto/contracts.ts`, `routes/contracts.routes.ts` | M | `template_name`, `template_id` (FR-2, FR-18) | 001a |
| `apps/api/src/middleware/security-headers.ts` | M | SAMEORIGIN cho `/render` (R-1) | 001a |
| `apps/api/src/services/contract/read-service.ts`, `domain/contract/types.ts` | M | `can.withdraw/delete` (FR-19, FR-20) | 001b |
| `apps/api/src/services/contract/withdraw-service.ts`, `dao/contract-withdraw-dao.ts` | N | FR-19 | 001b |
| `apps/api/src/dto/error.ts`, `routes/contracts.routes.ts`, `domain` hằng action `CONTRACT_ACTIONS` | M | slug `already-decided`, route withdraw, action `contract.withdrawn` | 001b |
| `apps/api/src/services/contract/delete-service.ts`, `dao/contract-delete-dao.ts` | N | FR-20 | 001c |
| `apps/api/src/routes/contracts.routes.ts`, `CONTRACT_ACTIONS` | M | route DELETE, `contract.deleted` | 001c |
| `docs/privacy.md` | M | kiểm kê: snapshot hợp đồng chứa PII khách; xóa nháp = hard delete (SPEC §3.2 E) | 001c |
| `apps/api/test/integration/contracts-withdraw.test.ts`, `contracts-delete.test.ts`, `customers-issued-sql.test.ts` | N | R-6(c): 1 test integration mỗi nhóm + số câu SQL | 001a/b/c |
| `apps/api/test/openapi/*` snapshot (nếu có) · `apps/api/dist/openapi.json` · `packages/client/src/generated/*` | M | `pnpm openapi:export && pnpm client:generate`, cùng commit mỗi card API | 001a/b/c |
| `apps/web/src/app/**` (nav có `badge`, layout, route guard, registry đọc `features/*/nav.ts`+`routes.tsx`), `src/lib/{problem-messages,percent-bps,idempotency-key,vn-date}.ts` (+ test) | M/N | FR-1, FR-6, FR-8, FR-13, FR-16 khung | 002 |
| `apps/web/src/features/roles/**`, `features/audit/audit-sentence.ts` (+ test) | M | nhãn quyền nền (DEC-2), câu withdrawn/deleted | 002 |
| `apps/web/src/features/{contracts,templates,approvals}/{nav.ts,routes.tsx}` stub | N | FR-1 | 002 |
| `apps/web/src/features/customers/**` (`index.ts` xuất `CustomerFormModal` + hook) | M | FR-12 UI, FR-17 | 006 |
| `apps/web/src/features/contracts/**` | N | FR-2..9, FR-14, FR-17..20 | 003 |
| `apps/web/src/features/templates/**` | N | FR-10 | 004 |
| `apps/web/src/features/approvals/**` | N | FR-11, FR-16 | 005 |
| `apps/web/e2e/global-setup.ts`, `e2e/fixtures.ts` (nếu cần), `e2e/shots/` | M | seed cho spec (card 007) | 007 |
| `apps/web/e2e/contracts.spec.ts`, `contracts.mobile.spec.ts`, `apps/api/test/integration/contracts-4b-acceptance.test.ts` | N (viết ở PLAN) | AC-2..AC-25 | — |
| `docs/cookbook/design/DESIGN.md`, `docs/roadmap/ROADMAP-01.md`, `CLAUDE.md` (nếu lệnh/quy tắc đổi) | M (PROOF) | ghi nhận | 007 |

## 3. Cards — một việc nhỏ mỗi card (docs/plan/cards/C-04b-NNN.md)
Thứ tự (khớp SPEC §9):
1. **[C-04b-001a]** API: khách `issued_*` + list `template_name`/`template_id` + `X-Frame-Options: SAMEORIGIN` trên `/render` → AC-13, AC-20, AC-25 · không phụ thuộc
2. **[C-04b-001b]** API: `can.withdraw/delete` + `POST /contracts/{id}/withdraw` + slug `already-decided` + `contract.withdrawn` → AC-21, AC-22 · sau 001a (cùng `contracts.routes.ts`, `dto/*`, `security-headers` xong)
3. **[C-04b-001c]** API: `DELETE /contracts/{id}` + `contract.deleted` + kiểm kê privacy → AC-23, AC-24 · sau 001b (cùng `contracts.routes.ts`, `dto/*`, `read-service.ts`). Sau 001c: `pnpm openapi:export && pnpm client:generate` sạch, suite API xanh → **review của driver trước mọi card UI**
4. **[C-04b-002]** khung + registry + nit + nav badge + problem-messages + lib (percent-bps, idempotency-key, vn-date) + nhãn quyền + audit-sentence → AC-14, AC-15, AC-17 (+ AC-1, AC-18 phần khung) · sau 001c
5. **[C-04b-006]** khách: thẻ số + tổng, xuất `CustomerFormModal` → AC-13 (UI), nền cho AC-19 · sau 002
6. **[C-04b-003 ‖ 004 ‖ 005]** song song (thư mục rời nhau, sau 002; 003 còn sau 006):
   - **[C-04b-003]** Hợp đồng: danh sách + bộ lọc + ngăn + hành động (gồm rút/xóa) + bản in + thêm khách trong modal → AC-3..AC-11, AC-16, AC-19..AC-21, AC-23 (UI) · sau 002, 006
   - **[C-04b-004]** Mẫu hợp đồng → AC-12 · sau 002
   - **[C-04b-005]** Chờ tôi duyệt + hook đếm nav → AC-6 (hàng đợi), AC-18 · sau 002
7. **[C-04b-007]** seed e2e + chạy e2e một lần + PROOF → AC-1..AC-25 · sau 001c, 002, 003, 004, 005, 006

Điều phối (driver): 001a→001b→001c tuần tự (cùng `routes/contracts.routes.ts`, `dto/contracts.ts`, `dto/error.ts`, `read-service.ts`, `packages/client/src/generated/*`, `dist/openapi.json`); một mình 001a–c sở hữu `apps/api/src` + `packages/client` + `docs/privacy.md`. 002 sở hữu `apps/web/src/{app,ui,lib}` + `features/{roles,audit}` + stub 3 feature + `package.json`. Các card feature chỉ ghi trong thư mục của mình; cần đổi `app/ ui/ lib/ package.json` → dừng, báo driver (nhờ 002 lift). Modal Tạo nằm ở `features/contracts/create-modal.tsx`; 004 chỉ điều hướng `/hop-dong?tao=<template_id>` (không import chéo). Driver chạy toàn bộ vitest tập trung (không hai vitest song song).

## 4. Risks
- R-1 render iframe: SAMEORIGIN thêm ở 001a (test AC-25). Kiểm `print()` + hiển thị iframe ở trình duyệt thật ngay khi card 003 dựng xong (một lần); hỏng → DEC-4 rơi về B (`sandbox=""`, chỉ "Mở ở tab mới"), sửa ở card 003.
- R-2 luồng duyệt: `timeline[]` không nhãn bước, `steps[].decided_by` là id → 003 ghép theo thứ tự thời gian (cùng giây → `step_no`). Nếu mơ hồ khi dựng → dừng và đề nghị thêm `decided_by_name` vào `ContractStep` (additive, mở lại card API — chưa làm, tránh đoán).
- R-3 lý do 🔒 dựng ở client (§3.4): chỉ dùng status/người tạo/quyền/người đã quyết; API vẫn quyết định.
- R-4 form dựng từ `fields[]` nhưng API `.strict()` chỉ 7 khóa `values` → khóa lạ bỏ; nguồn `options` của `ma_goi` (options / `options_from` / `GET /price-list`): 003 xác nhận bằng `GET /templates/{id}` thật và ghi kết quả vào card.
- R-5 `run_worker_first` không đổi (`/contracts/*` bao route mới); test 4a chặn hai chiều — chạy lại ở 001c và ở PROOF.
- R-6 withdraw/delete đổi lõi vòng đời: (a) schema chỉ `approval_steps` tham chiếu `contract_id` (đã kiểm ở SPEC; 001c xác nhận lại bằng grep `contract_id` trong `schema.ts`) + `replaced_by_id`; (b) `submitted_at`/`decided_at` NULL khi rút — 001b chạy toàn bộ `contracts-acceptance.test.ts` (không giả định ngược); (c) mỗi command 1 file service + 1 file DAO + 1 test integration; (d) kiểm kê privacy ở 001c.
- R-7 race: CAS `WHERE … NOT EXISTS (SELECT … s.status<>'waiting')` + `INSERT … SELECT … WHERE changes() > 0` trong `db.batch` — 001b/001c phải chứng minh `changes()` đúng thứ tự trong D1 batch (test đua AC-22/24 là bằng chứng); nếu D1 không đảm bảo → đề nghị dùng audit trong cùng câu CAS (`RETURNING`), dừng báo driver.
- R-8 e2e: `global-setup` chỉ 1 Giám đốc / 1 Quản lý / 1 Nhân viên → AC-7 (bước 2 Giám đốc) chỉ ở API + human (SPEC §7 mong ≥2 Giám đốc; thêm 2nd Giám đốc đổi `USERS` của 4a, không cần cho e2e chính — 007 quyết, mặc định KHÔNG thêm). Spec mobile chạy trước spec desktop (thứ tự alphabet) nên dữ liệu mobile đến từ seed, không phụ thuộc desktop. Seed chỉ tạo nháp (không phát hành/không gửi duyệt) để `HD-YYYY-001` và pill "1" của spec desktop đúng.
- R-9 số ngày: e2e dùng `HD-\d{4}-001` (năm theo đồng hồ máy), không cứng 2026.
- R-10 SPEC còn mơ hồ (không chặn build): iframe không báo status HTTP khi lỗi (§4 Failure TODO) → 003 chọn `fetch` HEAD/GET trước khi gắn iframe hoặc bỏ (khung hiện JSON lỗi) — ghi quyết định vào card. `onUnauthorized`/refresh giữa modal → `/login?next=` như 4a.
- ENGINEERING.md: không xung đột (routes giữ `c`, service không thấy `c`, DAO thuần, CAS + `db.batch`, Problem+JSON, mirror bindings không đổi). Card API phải `pnpm openapi:export && pnpm client:generate` cùng commit.

## 5. Trace check (trước STOP)
- [x] mọi FR có ít nhất một AC: FR-1→AC-1,2,15 · FR-2→AC-20 · FR-3→AC-3,4 · FR-4→AC-4,6 · FR-5→AC-6,7 · FR-6→AC-5,7,9,10 · FR-7→AC-8 · FR-8→AC-5,17 · FR-9→AC-3,10,11,25 · FR-10→AC-12 · FR-11→AC-6 · FR-12→AC-13 · FR-13→AC-14 · FR-14→AC-16 · FR-15→e2e (AC-2..AC-19) · FR-16→AC-18 · FR-17→AC-19 · FR-18→AC-20 · FR-19→AC-21,22 · FR-20→AC-23,24
- [x] mọi AC có một dòng ở §1 · mọi AC được một card phục vụ (§3, `serves` trong từng card) · mọi edge case "now" có AC (SPEC §10)
- [x] test đỏ đã chạy và ghi ở §1 (API 11/11 đỏ); e2e chưa chạy theo ngân sách
- [ ] chờ bạn duyệt PLAN

## 6. PROOF log (step 5) — điền ở card 007
Checks (điền output thật): `pnpm lint && pnpm typecheck && pnpm build` · `pnpm openapi:export && pnpm client:generate && git diff --exit-code` · `CI=true pnpm test` (API + web unit) · TUẦN TỰ sau đó: `bash docs/cookbook/e2e-kit/free-ports.sh 8791` rồi `PROOF_SHOTS=1 CI=true pnpm --filter @runway/web e2e` (một lần; nếu đỏ: sửa gốc, ghi từng run như PLAN-04a, xin OK vượt ngân sách).
Human checklist (dev :5173 hoặc :8787; làm → phải thấy):
- AC-1: `curl -i localhost:8787/hop-dong` (+ `/hop-dong/01ARZ3NDEKTSV4RRFFQ69G5FAV`, `…/van-ban`, `/mau-hop-dong`, `/cho-toi-duyet`) → 200 HTML · `curl -i localhost:8787/contracts` → 401 Problem+JSON.
- AC-2: đăng xuất, mở từng URL → `/login?next=…`; đăng nhập → về đúng URL.
- AC-3: Nhân viên tạo bỏ trống "Chức vụ người ký" → câu Việt nêu tên + ô đánh dấu, `GET /contracts` không dòng mới; điền → drawer "Nháp · chưa có số", bản in NHÁP + chức vụ.
- AC-4: G6 · 1 · 5% → `2.565.000 ₫` + "Hai triệu năm trăm sáu mươi lăm nghìn đồng" + 28/09/2026 → 27/03/2027 (đúng ngày giả lập) · gõ `7,5` → Network `giam_gia: 750` · DOM không có ô tổng.
- AC-5: gửi duyệt → Duyệt 🔒 "Bạn là người tạo nên không tự duyệt được." · `POST …/approve` tay → 403 · Giám đốc: Nhật ký có `permission.denied` màu danger.
- AC-6: Quản lý: Chờ tôi duyệt có hợp đồng của Nhân viên (không có của mình) → Duyệt → bước hiện tại nổi bật → phát hành → `HD-<năm>-001`, luồng duyệt có người + giờ VN.
- AC-7: −15%: Quản lý duyệt bước 1 → vẫn Chờ duyệt, bước 2 "Giám đốc duyệt" nổi bật · Quản lý xem lại 🔒 "Bạn đã quyết một bước…" · Giám đốc duyệt → Đã duyệt · Giám đốc duy nhất tạo −15% → gửi → câu `no-eligible-approver`.
- AC-8: 2 tab cùng sửa → "Người khác vừa sửa" + Tải bản mới · 2 tab cùng Phát hành → 1 số, tab kia tự tải lại «Đã phát hành».
- AC-9: DevTools offline → Tạo/Gửi duyệt → "Hệ thống đang bận", modal còn nguyên; online, bấm lại → 1 hợp đồng, 2 request cùng `Idempotency-Key`.
- AC-10: sau phát hành đổi tên + SĐT khách → bản in không đổi; Hủy trống lý do → chặn; có lý do → Đã hủy + dải ĐÃ HỦY, số giữ; Tạo bản thay thế → nháp mới; bản đã hủy → "Đã có bản thay thế" + liên kết.
- AC-11: iframe `sandbox="allow-same-origin allow-modals"` (DevTools); nút In mở hộp thoại in (Chrome + Safari/Firefox một lần); khách `<img src=x onerror=alert(1)>` → không alert, chữ ở bảng/ngăn/thẻ khách/bản in.
- AC-12: `/mau-hop-dong` chip trường bắt buộc + chuỗi bước; `/mau-hop-dong/:id` trường (`*`), dòng hàng, điều khoản, luật giảm > 10%, không nút sửa; "Tạo hợp đồng từ mẫu này →" mở modal đã chọn mẫu.
- AC-13: khách 2 issued + 1 voided + 1 draft → "2 hợp đồng · <tổng>"; hủy thêm 1 → tải lại "1 hợp đồng"; khách 0 → "Chưa có hợp đồng đã phát hành"; `curl GET /customers` có `issued_count`, `issued_total`.
- AC-14: desktop đúng 1 `h1` mỗi màn; Phân quyền không còn mã quyền tiếng Anh thô; rời Khách hàng → hết highlight.
- AC-15: admin: sidebar không có 3 mục, `/hop-dong` → 🔒 và Network không `GET /contracts` · Nhân viên `/cho-toi-duyet` → 403, không `GET /approvals/mine`.
- AC-16: mỗi màn/ngăn/modal mới: throttle → skeleton; rỗng đúng 1 việc (trừ Chờ tôi duyệt); lỗi có Thử lại; 390px: menu, thẻ, ngăn + modal toàn màn, bản in không tràn, chạm ≥ 44px; chỉ bàn phím: Tab, Esc trả focus.
- AC-17: unit xanh (`pnpm --filter @runway/web test`).
- AC-18: Quản lý 2 hợp đồng chờ → pill "2"; duyệt 1 → "1" không F5; tab khác duyệt nốt, quay lại (focus) → pill mất; ở `/cho-toi-duyet` chỉ 1 request `GET /approvals/mine?limit=50`.
- AC-19: gõ dở form → "+ Thêm khách mới" → tạo → khách được chọn, ô còn nguyên; trùng SĐT → "Dùng khách này" → không tạo bản trùng.
- AC-20: lọc Khách A → chỉ hợp đồng A, số tab khớp; + "Của tôi" + Mẫu → kết hợp; `?mau=không-ulid` → câu Việt; không khớp → "Không có hợp đồng khớp bộ lọc — Xóa bộ lọc"; F5 giữ bộ lọc, URL không tên/SĐT; cột Hợp đồng = tên mẫu.
- AC-21: gửi −5% → Rút về nháp → Nháp, "chưa có số", luồng trống, sửa được, mất khỏi hàng đợi Quản lý; −15% đã có người duyệt → 🔒 "Đã có người duyệt…"; `curl POST …/withdraw` → 409 `already-decided` / 403 `creator_only`+denied / 409 `state-conflict`.
- AC-22, AC-24: suite API xanh (kèm output).
- AC-23: Xóa nháp → về `/hop-dong`, dòng mất, tab Nháp −1, `GET` → 404; SQL `SELECT metadata FROM audit_events WHERE action='contract.deleted'` = `{"id":…}`; phát hành kế tiếp vẫn liền số; `curl DELETE` hợp đồng khác trạng thái → 409; người khác → 403 + denied; lần 2 → 404; nháp thay thế bị xóa → nguồn `replaced_by_id` NULL, tạo bản thay thế mới được.
- AC-25: `curl -I …/contracts/{id}/render` → `x-frame-options: SAMEORIGIN` + CSP `frame-ancestors 'self'`; route khác `DENY`; iframe hiển thị bản in ở trình duyệt thật.
Attack (dữ liệu cá nhân / quyền): mọi URL 4b khi chưa đăng nhập → `/login`; Nhân viên đổi id, gọi tay `DELETE`/`withdraw` hợp đồng người khác (403 + denied, còn nguyên); Quản lý/Giám đốc xóa/rút hợp đồng người khác (403); gửi `total`/`unit_price` (422); tên/SĐT không xuất hiện ở URL, storage, console, `contract.deleted.metadata`; tên khách `<img onerror>`/`<script>` hiện thành chữ ở mọi nơi; `next=//evil.com` (4a) vẫn bị bỏ; iframe chỉ nhận `id` ULID từ `params`.
Kết quả: [pass | lỗi nào → quay lại plan] · nit thị giác → danh sách cho row sau (không vòng chỉnh ảnh) · duyệt của bạn: [ ]

### PROOF log (C-04b-007, run 2026-09-30) — DONE (run 5 by driver green)
Driver checks at 38309ba (not re-run by 007): typecheck 7/7 · lint 2/2 · web build ok · api 261 passed | 2 skipped · web 129 · client 11. After 007's fixes: web typecheck ok, lint ok, `CI=true pnpm --filter @runway/web test` → 130 passed (+1 unit).
Seed: `seedContracts()` in `e2e/global-setup.ts` (staff session, real API): customer "Cửa hàng Seed" + ONE draft (G6 · 1 · 5%, "Chủ hộ kinh doanh"); not submitted/issued. No fixtures.ts change needed.
Runs (each red = root cause, fixed at the cause):
- Run 1 (setup RED, no test executed): `POST /contracts` 422 `Invalid Idempotency-Key header` (must be ULID/UUID) → seed uses `generateUlid()`.
- Run 2 (setup RED, no test executed): my `sed` failed (BSD) so the fix was not applied and the chained e2e still ran = same 422; wasted run, counted.
- Run 3 (3 red, seed ok): (a) 4a smoke `getByRole('heading',{level:1,name:'Khách hàng'})` not found → product bug: the customers screen never had its own h1 (4a relied on the top-bar title that 4b FR-13 removed) → added `<h1>Khách hàng</h1>` in customers-screen. (b) desktop: create form blocked client-side "Thiếu: Ngày bắt đầu" → product bug: `requiredKeys` treated template fields that carry a default (`ngay_bat_dau` = Ngày lập, `giam_gia` = 0) as required although the server fills them (SPEC time row) → `SERVER_DEFAULTED` in values.ts + unit test. (c) mobile: sidebar stayed open after Escape and covered the card ("subtree intercepts pointer events") → product bug: AppShell menu had no Escape handler → keydown Escape closes the menu (layout.tsx).
- Run 4 (PROOF_SHOTS=1; 1 passed, 2 failed; shots produced: hop-dong, ngan-chi-tiet, ban-in, hop-dong-mobile, khach-hang, phan-quyen, nhat-ky .png): the 4a smoke passes; desktop got through logged-out redirects, create with missing field → filled → paper iframe (sandbox attr, NHÁP, chức vụ) → drawer → submit → self-approve 🔒 + forced 403 → withdraw → resubmit → second draft deleted, then RED at spec L149 `getByRole('link',{name:'Chờ tôi duyệt',exact:true})` timeout: the link's accessible name is "Chờ tôi duyệt 1 hợp đồng chờ bạn duyệt" (pill title) — app correct (pill "1" visible in snapshot), locator too strict → spec: `/^Chờ tôi duyệt/`. Mobile: menu, cards, drawer 390px, paper iframe NHÁP all passed; RED at L56 `drawer toBeHidden` after Escape: Escape pressed while the paper was still unmounting (topmost dialog = paper) → race in the spec → `await expect(paper).toBeHidden()` before Escape.
- Run 5: NOT DONE (budget). Needed: rebuild SPA, `PROOF_SHOTS=1 CI=true pnpm --filter @runway/web e2e` → expect `3 passed` (desktop contracts, smoke, mobile). Desktop part after L149 (approve, issue HD-YYYY-001, void, customer card, Nhật ký) is still unproven.
AC-25 (curl on the driver's :8787 dev server, unauthenticated, any id): `x-frame-options: SAMEORIGIN` + `content-security-policy: … frame-ancestors 'self'` present on `/contracts/{id}/render` (401 body, headers set); iframe renders the paper in a real browser (run 4 desktop + mobile: NHÁP visible inside iframe). `/hop-dong` → 200, `/contracts` → 401.
Attack pass so far: logged-out `/hop-dong`, `/hop-dong/<id>`, `/…/van-ban`, `/mau-hop-dong`, `/cho-toi-duyet` → `/login?next=` (run 4 spec passed this step). Still to be shown by run 5/human: NV `/cho-toi-duyet` → 403 UI with no `GET /approvals/mine` (spec asserts `approvalCalls == []` at the end), admin has no contract nav, storage/console free of customer data (spec collects console).
Visual nits (list only): customers screen h1 was missing until now (top-bar dedupe) · issue/void/paper stages unseen until run 5 · Escape did not close the mobile menu (fixed) · link accessible name includes the pill text (fine, noted for tests).
Result: NOT pass yet · human approval: [ ]


## Driver decisions at approval (2026-09-30)
- R-2 resolved up front: C-04b-001a adds `decided_by_name` (nullable, from users.display_name) to `ContractStep` — additive; card 003 need not stop.
- R-8: keep 1 GĐ/1 QL/1 NV in e2e seed; AC-7 stays owned by the API suite.

### Run 5 (driver, PROOF_SHOTS=1) — GREEN
`✓ 1 [desktop] › e2e/contracts.spec.ts:27:1 › 4b lifecycle: logged out → /login; Nhân viên creates (missing field, then fill) and submits, self-approve is 🔒; Quản lý approves + issues; void; paper (3.3s)` · `✓ 2 [desktop] › e2e/shell.smoke.spec.ts:18:1 › 4a smoke … (1.1s)` · `✓ 3 [mobile] › e2e/contracts.mobile.spec.ts:14:1 › 4b mobile … (622ms)` · `3 passed (16.4s)`. Shots: hop-dong, ngan-chi-tiet, ban-in (paper in the sandboxed iframe, NHÁP watermark, 2.565.000 đồng + bằng chữ), hop-dong-mobile, khach-hang, phan-quyen, nhat-ky.
Attack (driver probe on :8787): `logged-out /hop-dong -> /login?next=%2Fhop-dong` · admin nav `Phân quyền | Nhật ký | Người dùng` (no contract screens) · admin direct `/hop-dong` → 🔒 403 UI, zero /contracts|/approvals|/templates requests · storage `{}{}` · `curl -sI …/contracts/<id>/render` → `x-frame-options: SAMEORIGIN` + `frame-ancestors 'self'`.
Checks after run 5: typecheck 7/7 · lint 2/2 · `CI=true pnpm test` → api 261 passed | 2 skipped, web 130, client 11 (`Tasks: 9 successful`).
Result: pass. Human approval: [x] 2026-09-30 driver (bạn ủy quyền "just finish it") — bạn xem lại khi rảnh.
Visual nits (not polished): admin logging in with next=/hop-dong lands on the 403 screen instead of its first allowed screen; long creator names truncate in the table.
