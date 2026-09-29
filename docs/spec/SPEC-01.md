# SPEC-01: Nền — vai trò, người dùng (mời vào), nhật ký, khách hàng, bảng giá

Status: Approved 2026-09-29
Intent: docs/intent/INTENT-01.md

## 1. Research (sources + date)
- Domain: `documents.workbook.md` §6 + §9 (2026-09-29) — nếu chặn quyền mà không ghi nhật ký thì không ai thấy lần bị chặn; cache quyền cũ khiến
  người đã nghỉ việc vẫn duyệt được thêm tới 300 giây; bẫy "sao chép ví dụ list" trả về toàn bộ bản ghi.
- D1 `batch()` (developers.cloudflare.com/d1/worker-api/d1-database, 2026-09-29): "Batched statements are SQL transactions…
  aborts or rolls back the entire sequence" · chạy tuần tự, không song song → một thao tác và dòng nhật ký của nó đi chung một batch.
- RUNWAY: `docs/recipes/add-audit-store.md` (bảng `audit_events`, logger ghi cả hai nơi) · `docs/rbac.md` (hợp đồng xóa cache:
  gọi `invalidatePrincipalCache` khi đổi vai trò) · `admin-service.ts` đã có `assignRoleByName`/`revokeRoleByName`, chưa có route ·
  `users` chưa có tên hiển thị · flag `signup.enabled` (false → 503) · email: `noop` khi chạy local (không gửi thật).

## 2. Requirements
- [FR-1] 3 vai trò `giam_doc` · `quan_ly` · `nhan_vien`, quyền đúng theo ma trận mockup; `giam_doc` có thêm `users:read/write`;
  mỗi người dùng nghiệp vụ có đúng 1 vai trò → OUT-1
- [FR-2] Đổi vai trò / khóa người dùng có hiệu lực ngay từ request kế tiếp (xóa cache quyền; khi khóa thì thu hồi phiên) → OUT-1
- [FR-3] Tự đăng ký bị tắt; tài khoản đầu tiên (`admin`) được tạo bằng script seed; `admin` (hoặc Giám đốc) thêm người (email, tên, vai trò)
  → nhận link kích hoạt dùng 1 lần; người được mời mở link, đặt mật khẩu → đăng nhập được → OUT-5
- [FR-4] Bảng `audit_events`: mọi sự kiện audit hiện có + `auth.login` (mới) + `permission.denied` (người, quyền, đường dẫn, IP) được ghi vào; người có
  `audit:read` đọc, mới nhất trước, phân trang, lọc theo action / actor / target → OUT-2
- [FR-5] Khách hàng: thêm / sửa / xem / tìm (tên, SĐT, MST); không xóa; mỗi lần thêm/sửa có dòng nhật ký trong cùng batch → OUT-3
- [FR-6] Bảng giá seed từ `09_Bang_Gia.xlsx`; tra theo ngày (múi giờ Asia/Ho_Chi_Minh) trả về giá đang áp dụng → OUT-4

## 3. Design
- Data (migration mới, chỉ thêm, không xóa):
  - `roles` + `permissions` + `role_permissions`: seed 3 vai trò; `admin` = tài khoản kỹ thuật (DEC-1): `users:*` `settings:*`
    `audit:read`, KHÔNG có `contract:*`/`template:write`; mỗi người đúng 1 vai trò trong 4 (`admin` không kiêm vai trò nghiệp vụ); quyền mới `contract:read` `contract:write` `contract:submit`
    `contract:approve` `contract:issue` `template:write` `audit:read` (thêm vào `packages/rbac/src/catalog.ts`). Giữ nguyên
    `admin`/`member`; `users:*` giữ tên cũ (mockup ghi `user:write` = `users:write`).
  - `users` + cột `display_name TEXT` (nullable ở DB, bắt buộc với người được mời).
  - `verification_tokens.purpose` thêm giá trị `invite` (hạn 72h, dùng 1 lần, lưu hash).
  - `audit_events(id, ts, actor, action, target, metadata, ip)` + index như recipe.
  - `customers(id ULID, name, contact_person, tax_code, phone, phone_norm, email, address, created_by, created_at,
    updated_at, version INTEGER)`; UNIQUE `phone_norm` (khi có giá trị), UNIQUE `tax_code` (khi có giá trị); không có cột xóa.
  - `price_list(id, code, name, duration_value, duration_unit (day|month), unit_price INTEGER đồng, effective_from DATE,
    effective_to DATE NULL, note)`; seed 7 dòng của file xlsx.
- Screens / flow: row này không có giao diện (row 4); kiểm tra qua `/docs` (Swagger). Luồng mời người: admin/Giám đốc `POST /admin/users` → nhận
  `activation_url` (hiển thị đúng 1 lần; kèm email nếu bật email thật) → gửi cho người mới qua Zalo → người mới gọi
  `POST /auth/activate {token, password}` → đăng nhập.
- API (contract-first; mọi request ghi đều cần Origin + `X-Requested-With: fetch`; tạo mới thì có thể gửi `Idempotency-Key`):
  | Method + path | Quyền | Request → Response | Lỗi |
  |---|---|---|---|
  | `GET /admin/users` (có sẵn) | `users:read` | + `display_name`, `roles`, `status` | 401 403 |
  | `POST /admin/users` | `users:write` | `{email, display_name, role}` → 201 `{user, activation_url, expires_at}` | 409 email trùng · 422 |
  | `PATCH /admin/users/{id}` | `users:write` | `{role?, status?: active\|disabled, display_name?}` → 200 user | 404 · 409 last-admin · 422 |
  | `POST /admin/users/{id}/invite` | `users:write` | tạo lại link cho người chưa kích hoạt (link cũ hết hiệu lực) → 200 `{activation_url, expires_at}` | 404 · 409 already_active |
  | `POST /auth/activate` | công khai (có token) | `{token, password}` → 204 | 400 invalid_or_expired_token · 422 password yếu |
  | `GET /roles` | đã đăng nhập | ma trận vai trò × quyền (trang Phân quyền) | 401 |
  | `GET /audit?action&actor&target&cursor&limit≤50` | `audit:read` | `{items:[{…, actor_name}], next_cursor}` | 401 403 |
  | `GET /customers?q&cursor&limit≤50` | `contract:read` | `{items, next_cursor}` | 401 403 |
  | `GET /customers/{id}` | `contract:read` | customer | 404 |
  | `POST /customers` | `contract:write` | `{name, contact_person?, tax_code?, phone?, email?, address?}` → 201 | 409 duplicate (kèm `existing_id`) · 422 |
  | `PATCH /customers/{id}` | `contract:write` | các trường trên + `expected_version` → 200 (version +1) | 404 · 409 stale · 409 duplicate · 422 |
  | `GET /price-list?date=YYYY-MM-DD` | `contract:read` | các gói đang áp dụng ngày đó (mặc định: hôm nay theo giờ VN) | 422 ngày sai |

## 4. Edge cases — the human marks each: now · later (why) · n/a
| Category | Case here | Decision |
|---|---|---|
| Input | email hoa/thường, khoảng trắng → chuẩn hóa · tên có dấu giữ nguyên · SĐT `0901 234 567` / `+84901234567` / `0901.234.567` → cùng `phone_norm` · MST chỉ chữ số và `-` | now |
| Duplicates & identity | mời email đã có → 409 · khách trùng SĐT hoặc MST → 409 kèm `existing_id` · trùng tên thì không chặn (nhiều cửa hàng trùng tên) | now |
| Two people at once | 2 người cùng sửa 1 khách → người sau nhận 409 stale (CAS theo `version`) · 2 lần bấm tạo → `Idempotency-Key` | now |
| Failure & retry | email lỗi không làm hỏng việc mời (vẫn trả link) · ghi nhật ký cho `permission.denied` / đăng nhập mà lỗi thì không làm hỏng request · thay đổi khách + dòng nhật ký: chung 1 batch | now |
| Permissions / not logged in | chưa đăng nhập → 401 · Nhân viên đọc nhật ký → 403 + `permission.denied` · `member`/tài khoản chưa có vai trò → không có quyền nghiệp vụ | now |
| Lifecycle | khóa người dùng thay cho xóa · không được khóa / đổi vai trò `admin` đang hoạt động cuối cùng → 409 `last-admin` · link mời hết hạn / đã dùng → 400 · khách không xóa được | now |
| Money | giá là số nguyên đồng, đã gồm VAT · DT14 = 0đ | now |
| Time / dates | tra giá theo ngày ở múi giờ VN (00:30 ngày 01/07 VN vẫn ra giá mới) · 30/06/2026 → G6 2.400.000, 01/07/2026 → 2.700.000 · `ts` nhật ký lưu unix giây | now |
| Retention | nhật ký lưu mãi, không có job xóa | later — xem lại khi dữ liệu lớn |

## 5. Security
- Who may do what: bảng API §3. `admin` là tài khoản kỹ thuật: quản lý người dùng + đọc nhật ký, không tạo/duyệt/phát hành hợp đồng.
- Personal data: SĐT, email, MST, địa chỉ của khách chỉ có trong `customers` và response gửi người có quyền `contract:read`; metadata nhật ký
  chỉ ghi id + tên các trường đã đổi, không ghi giá trị; không ghi link kích hoạt/token vào log (deepScrub + chỉ lưu hash).
- Abuse: đoán token kích hoạt (dài 32 byte ngẫu nhiên, chỉ lưu hash, rate-limit như `/auth/verify`) · người bị khóa dùng lại
  access token cũ (thu hồi jti + refresh token) · tự nâng vai trò của mình (cần `users:write`; admin cuối cùng không tự khóa/đổi vai trò được) · liệt kê toàn bộ khách (`limit` tối đa 50).

## 6. Decisions (the human decides)
- [DEC-1] Tài khoản seed đầu tiên mang vai trò nào · options: `giam_doc` / `admin` / cả hai · recommended: **`giam_doc`**
  (đủ quyền mời người vì có `users:write`; `admin` bỏ qua kiểm tra chủ sở hữu nên sửa được nháp người khác — trái với PRB-1) · decided: **`admin`** (bạn chốt 2026-09-29) — là tài khoản kỹ thuật, chỉ mời người + đọc nhật ký; không có quyền hợp đồng nên việc bỏ qua kiểm tra chủ sở hữu không đụng tới hợp đồng
- [DEC-2] Cách người mới vào app · options: link kích hoạt 72h, Giám đốc gửi qua Zalo (+ email nếu bật email thật) / Giám đốc đặt mật khẩu tạm,
  người mới phải đổi · recommended: **link kích hoạt** (Giám đốc không bao giờ biết mật khẩu; chạy local không có email thật) · decided: **link kích hoạt**
- [DEC-3] Nhật ký ghi những gì · options: mọi sự kiện audit (kể cả đăng nhập) / chỉ sự kiện nghiệp vụ + `permission.denied` ·
  recommended: **mọi sự kiện** (mockup Nhật ký có `auth.login`) · decided: **mọi sự kiện**
- [DEC-4] Trùng khách · options: chặn khi trùng SĐT/MST / chỉ cảnh báo · recommended: **chặn + trả id khách đã có** (PRB-3: một khách nằm 2–3 dòng) · decided: **chặn**

## 7. Acceptance — checkable from outside, few, about outcomes
- [AC-1] Seed → đăng nhập admin → `POST /admin/users` 1 Giám đốc + 1 Quản lý + 1 Nhân viên → mỗi người kích hoạt bằng link → `GET /me` của mỗi người
  trả đúng vai trò + quyền như ma trận; admin không có quyền `contract:*`; `GET /roles` khớp mockup — proves FR-1, FR-3, DEC-1, DEC-2
- [AC-2] `POST /auth/signup` → 503; kích hoạt lại bằng link đã dùng / hết hạn → 400 — proves FR-3, §4 Lifecycle
- [AC-3] Giám đốc hạ Quản lý xuống Nhân viên → request kế tiếp của người đó tới `GET /audit` → 403; khóa người đó → request kế tiếp 401 —
  proves FR-2
- [AC-4] admin cuối cùng tự khóa / tự đổi vai trò → 409 `last-admin` — proves §4 Lifecycle
- [AC-5] Nhân viên gọi `GET /audit` → 403 Problem+JSON; Giám đốc gọi `GET /audit?action=permission.denied` → thấy đúng dòng đó (actor, quyền
  `audit:read`, IP), mới nhất trước — proves FR-4, DEC-3
- [AC-6] Tạo khách với SĐT `0901 234 567` rồi `+84901234567` → 409 kèm `existing_id`; 2 PATCH cùng `expected_version` → 1 thành công,
  1 bị 409 stale; mỗi lần thêm/sửa có đúng 1 dòng `customer.created/updated`, trong đó không có SĐT/email — proves FR-5, DEC-4, §4 Duplicates, Two people
- [AC-7] `GET /price-list?date=2026-06-30` → G6 2.400.000; `date=2026-07-01` → G6 2.700.000; không truyền ngày → giá theo ngày hiện tại
  ở giờ VN — proves FR-6, §4 Time
- [AC-8] Chưa đăng nhập gọi `/customers`, `/audit`, `/price-list`, `/admin/users` → 401, không lộ dữ liệu; Nhân viên gọi `POST /admin/users` → 403 +
  `permission.denied` — proves §5

## 8. Trace check (before the STOP)
- [x] every FR points to an OUT · every AC proves an FR, a "now" edge case, or a DEC · every "now" edge case has an AC
  (Input → AC-6 phone; Money → AC-7)
