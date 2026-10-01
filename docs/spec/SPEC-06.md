# SPEC-06: Quản lý vai trò — sửa quyền, thêm vai trò, clone vai trò

Status: Approved 2026-10-01 (DEC-1/3/4/5 bạn chốt; DEC-2/6/7 + edge "now/later" theo đề xuất — driver chốt, bạn ủy quyền)
Intent: docs/intent/INTENT-06.md (Approved 2026-10-01; Q-1..Q-4 ràng buộc) · Roadmap: ROADMAP-02 row 2

## 0. Bổ sung 2026-10-01 — đối chiếu bộ quy tắc RBAC bạn gửi (bạn chọn cả 4 nhóm; driver tách 2a/2b)
- Dòng 2 tách: **2a = SPEC-06 này** (+ FR-12, FR-13 dưới) · **2b = SPEC-07** (Static SoD, four-eyes cho đổi quyền, rà soát định kỳ, JIT admin — mỗi cái cần thiết kế riêng, không chặn 2a).
- [FR-12] Gán/gỡ vai trò R cho người khác (mời, đổi vai trò) chỉ khi quyền người gọi ⊇ quyền của R (cả vai trò cũ khi gỡ); `admin` được miễn (để mời Giám đốc — admin không có `contract:*`). Thiếu → 403 `forbidden` `rule: grant_not_held` + `permissions` thiếu + 1 dòng `permission.denied`. Kiểm từ D1 trong cùng request. → OUT-4, quy tắc "giới hạn ủy quyền" + "thu hồi tương ứng"
- [FR-13] Nhật ký bất biến: trigger D1 từ chối `UPDATE`/`DELETE` trên `audit_events` (như `template_versions`). Không code sản phẩm nào sửa/xóa nhật ký (đã kiểm). Test dọn bảng qua một helper chung (tạm `DROP TRIGGER` → xóa → tạo lại) chỉ trong vitest. → quy tắc "ghi vết bất biến"
- `member`: API từ chối gán (422 `unknown-role`), khớp DEC-7 ẩn ở UI (PLAN R-9, driver chốt).
- AC-9: Giám đốc gán vai trò có `settings:write` (admin tạo) cho người khác → 403 `grant_not_held`; admin gán được · AC-10: `UPDATE`/`DELETE audit_events` qua D1 → lỗi trigger, số dòng không đổi.

## 1. Research (2026-10-01)
Code (đã kiểm):
- `roles` chỉ có `id, name UNIQUE, description` (`apps/api/src/db/schema.ts:98-102`) — không cờ hệ thống, không version, không nhãn riêng. Seed: `admin`, `member` (`0001_seed_rbac.sql:9-11`) + `giam_doc`/`quan_ly`/`nhan_vien` (`0010_seed_foundation.sql:7-10`). **Có 5 vai trò seed, không phải 4** (`member` = vai trò nền RUNWAY, không ai mang).
- Catalog đóng `PERMISSIONS` 15 mã, chưa có `roles:write` (`packages/rbac/src/catalog.ts:15-31`); `ROLE_NAMES` cố định nhưng role lạ "flow through harmlessly" (`docs/rbac.md` §Adding a role).
- `admin` KHÔNG có `contract:*`/`template:write` (SPEC-01 DEC-1; `0001:24-30`, `0006:15-17`, `0010:42`). `can()` bỏ qua kiểm chủ sở hữu theo **tên** `admin` (`packages/rbac/src/policy.ts:28`).
- Bước duyệt khớp vai trò theo **tên**: `isEligible` so `c.roles.includes(step.required_role)` (`domain/contract/assignment.ts:6`); mẫu seed ghi `"role":"giam_doc"` (`0013:32`), `approval_steps.required_role` lưu chuỗi (`0014:7`). Ứng viên đọc từ D1 mỗi lần gửi/duyệt (`dao/approval-dao.ts:46` `listCandidates`) → đổi quyền có hiệu lực ngay với luật duyệt.
- Cache principal: KV `session:<userId>`, TTL 300s (`dao/session-cache.ts:20,34`); middleware đọc KV, miss → join D1 rồi ghi lại (`middleware/auth.ts` `loadPrincipal`). Xóa cache hiện chỉ theo **từng user** khi đổi vai trò/khóa (`services/user-admin-service.ts` cuối `updateUser`; `admin-service.ts` `assignRoleByName`). Không có cơ chế xóa theo vai trò. JWT không mang quyền (chỉ `jti`/sub).
- `GET /roles`: chỉ `requireAuth`, mọi người đăng nhập đọc được (`routes/roles.routes.ts:29`; SPEC-04a FR-9). Trả `name, description, permissions` (`dao/role-dao.ts:79-99`). Web chỉ hiện mã quyền mà ít nhất 1 vai trò có (`features/roles/roles-screen.tsx:30`) → không có catalog đầy đủ để bật quyền mới.
- Người dùng: vai trò là **enum cứng** — `BusinessRole` mời (`dto/users.ts:14`), PATCH `["giam_doc","quan_ly","nhan_vien","admin"]` (`dto/users.ts:45`); web `inviteRoles`/`assignRoles` (`features/users/users-screen.tsx:11-12`, `api.ts:7-8`); nhãn vai trò cứng `roleLabels` (`app/me.tsx:13-19`), `ROLE_ORDER` (`features/roles/permission-labels.ts:36`).
- **Lỗ tự nâng quyền hiện có**: `updateUser` không so `actorId` với `userId` và cho gán `admin` cho bất kỳ ai có `users:write` (`user-admin-service.ts:236-…`) → Giám đốc (`users:write`, `0010:32`) tự đổi mình thành `admin` được (lấy `settings:*`, `flags:*`).
- Mời người: `grantRoleByNameStmt` = `INSERT…SELECT FROM roles WHERE name=?` (`role-dao.ts:105-113`) — vai trò bị xóa giữa chừng → batch vẫn chạy, **user không vai trò** (cần chặn khi vai trò xóa được).
- Mẫu CAS sẵn có: `expected_version` + 409 `stale` (`dto/customers.ts:53`, `routes/customers.routes.ts:202`); audit trong cùng `db.batch` (`auditInsert`/`auditInsertWhen`); 403 ghi `permission.denied` (`middleware/require-permission.ts:43`).
Docs chính thức:
- KV: "Changes may take up to 60 seconds or more to be visible in other global network locations"; xóa cũng vậy ("Negative lookups … are also cached") — developers.cloudflare.com/kv/concepts/how-kv-works (2026-10-01).
- KV limits: ≤1.000 thao tác dịch vụ ngoài / invocation; ghi cùng key 1/giây — developers.cloudflare.com/kv/platform/limits (2026-10-01).
- D1 `batch()`: "Batched statements are SQL transactions", tuần tự, lỗi → rollback cả chuỗi — developers.cloudflare.com/d1/worker-api/d1-database (2026-10-01).
Miền: lỗi kinh điển của RBAC tự quản = tự nâng quyền (sửa vai trò mình / gán quyền mình không có / gán vai trò mạnh hơn cho mình), khóa hệ thống khỏi quản trị, quyền thu hồi còn sống trong cache.

## 2. Requirements
- [FR-1] Quyền mới `roles:write` ("Quản lý vai trò") trong catalog; migration cấp cho `admin` + `giam_doc` → OUT-1, Q-1
- [FR-2] Người có `roles:write` đổi tập quyền + tên hiển thị + mô tả của một vai trò (một lần Lưu = một PATCH tập đầy đủ, CAS) → OUT-1
- [FR-3] Tạo vai trò mới (tên hiển thị, mô tả, tập quyền); clone = tạo với tập quyền chép từ vai trò nguồn → OUT-2
- [FR-4] Xóa vai trò khi không ai mang; đang có người → 409 kèm số người → OUT-2, OUT-4, Q-4
- [FR-5] Guard (Q-3): không sửa/xóa vai trò mình đang mang · không thêm quyền mình không có · vai trò hệ thống (`admin`, `member`, `giam_doc`, `quan_ly`, `nhan_vien`) không xóa, không đổi mã · `admin` khóa hoàn toàn (DEC-2) → OUT-4
- [FR-6] Catalog đóng: mã quyền lạ → 422; `GET /roles` trả cả catalog để màn hình bật được quyền chưa ai có → OUT-1, PRB-3
- [FR-7] Đổi quyền tới người mang vai trò không cần đăng xuất: sau commit xóa cache principal của mọi người mang vai trò (DEC-4) → OUT-1
- [FR-8] Nhật ký: `role.created` · `role.updated` · `role.permissions_changed` (`added[]`, `removed[]`) · `role.deleted` (giữ `name`+`label`), cùng batch với thay đổi; không PII → OUT-3, Q-4
- [FR-9] Người dùng: chọn mọi vai trò (cả vai trò tự tạo) khi mời/đổi vai trò; API nhận tên vai trò có thật thay enum; nhãn vai trò lấy từ `GET /roles` → OUT-2
- [FR-10] Chặn tự nâng qua màn Người dùng (DEC-5) → OUT-4, Q-3
- [FR-11] Màn Phân quyền sửa được cho người có `roles:write` (DEC-3); người khác vẫn chỉ xem → OUT-1, OUT-2

## 3. Design
### 3.1 Data (migration `0016_*`, chỉ thêm — expand)
- `roles` + `label TEXT` (tên hiển thị) · `label_key TEXT UNIQUE` (NFC, trim, gộp khoảng trắng, `toLocaleLowerCase('vi')` — tính ở app, chống "Kế toán"/"kế  toán" trùng) · `is_system INTEGER NOT NULL DEFAULT 0` · `version INTEGER NOT NULL DEFAULT 1` · `created_at`, `updated_at INTEGER`.
- Backfill: 5 vai trò seed `is_system=1`, `label` = "Quản trị hệ thống" / "Thành viên (nền)" / "Giám đốc" / "Quản lý" / "Nhân viên" (khớp `app/me.tsx:13-19`).
- `permissions` + `('01PERM0000000ROLESWRITE00','roles:write')`; `role_permissions` cấp `admin`, `giam_doc` (`INSERT OR IGNORE`).
- `name` = khóa định danh, **không bao giờ đổi** (bước duyệt + `can()` khớp theo tên). Vai trò tự tạo: server sinh `name = "r_" + ulid thường` (không cho người dùng đặt → không thể giả `admin`/`giam_doc`). Giới hạn: `label` 1–60 ký tự, `description` ≤ 200, ≤ 50 vai trò tự tạo.
- Không bảng mới. Xóa vai trò = hard delete `roles` + `role_permissions` của nó (không ai mang); nhật ký giữ tên.

### 3.2 API (contract-first; ghi cần `Origin`=`APP_ORIGIN` + `X-Requested-With: fetch`; lỗi Problem+JSON)
| Method + path | Quyền | Request → Response | Lỗi |
|---|---|---|---|
| `GET /roles` (đổi, additive) | đăng nhập | → `{items: Role[], catalog: string[]}`; `Role = {id, name, label, description, is_system, version, holders, permissions[], can: {edit, delete}, locked_reason: null\|"system"\|"own_role"\|"admin"}` (`can`/`locked_reason` tính cho người gọi; không `roles:write` → mọi `can=false`) | 401 |
| `POST /roles` (+`Idempotency-Key`) | `roles:write` | `{label, description?, permissions[]}` → 201 `Role` | 403 · 409 `duplicate` (label) · 409 `role-limit` · 422 |
| `PATCH /roles/{id}` | `roles:write` | `{expected_version, label?, description?, permissions?}` (`permissions` = tập đầy đủ mới) → 200 `Role` | 403 · 404 · 409 `stale` · 409 `duplicate` · 422 |
| `DELETE /roles/{id}?expected_version=N` | `roles:write` | → 204 | 403 · 404 · 409 `stale` · 409 `role-in-use` (`holders: n`) |
| `POST /admin/users`, `PATCH /admin/users/{id}` (đổi) | `users:write` | `role: string` (tên vai trò có thật) thay enum | + 422 `unknown-role` · 403 `rule` DEC-5 |
- 403 nghiệp vụ: `forbidden` + `rule` ∈ `system_role` · `admin_role` · `own_role` · `grant_not_held` (+ `permissions: string[]` = mã thêm mà người gọi không có) · DEC-5 `self_role` · `admin_only`; mỗi 403 ghi 1 dòng `permission.denied`. Slug mới: `role-in-use`, `role-limit`, `unknown-role`.
- 422: mã ngoài catalog, mã trùng trong mảng, `label` rỗng/quá dài, body thừa khóa (`.strict()`).
- Quyền người gọi (`grant_not_held`, `own_role`) đọc **từ D1** trong service, không từ principal cache (cache có thể cũ ≤ 60s).

### 3.3 Ghi (service `role-admin-service.ts`, DAO thuần, một `db.batch`)
- PATCH: stmt 1 = CAS `UPDATE roles SET … version=version+1 WHERE id=? AND version=? AND is_system_guard AND NOT EXISTS(user_roles của actor với role này) RETURNING`; các stmt sau (`DELETE role_permissions` mã bỏ, `INSERT…SELECT` mã thêm, audit) điều kiện `EXISTS(roles WHERE id=? AND version=?+1)`. 0 dòng → đọc lại phân loại 404/`stale`/403.
- `grant_not_held`: `added = new − old`; `added ⊄ quyền actor (D1)` → 403 trước batch, và lặp lại trong WHERE của INSERT (`EXISTS` quyền đó qua `user_roles` của actor) để race không lọt. **Bỏ** quyền mình không có thì được (không phải nâng quyền).
- DELETE: `DELETE FROM roles WHERE id=? AND version=? AND is_system=0 AND NOT EXISTS(user_roles WHERE role_id=?)` → `role_permissions` + audit điều kiện "role không còn". 0 dòng → đếm `holders` → `role-in-use` hoặc `stale`/404.
- Mời/đổi vai trò: stmt đầu `INSERT…SELECT FROM roles WHERE name=?` phải trả 1 dòng; mời: chèn user **sau** grant hoặc `insertInvitedUser` điều kiện `EXISTS(roles WHERE name=?)` → vai trò bị xóa song song → 422 `unknown-role`, không user mồ côi.
- Sau commit (FR-7): `SELECT user_id FROM user_roles WHERE role_id=?` → `invalidatePrincipalCache` song song mỗi người (đội nhỏ; ≤ 1.000 thao tác KV/invocation — vượt 900 người thì cắt lô qua `waitUntil`, ghi rủi ro).

### 3.4 Màn hình
- Phân quyền `/phan-quyen` (DEC-3): ma trận giữ nguyên làm tổng quan, hàng = **cả catalog** (nhóm Hợp đồng · Quản trị (`users:*`, `roles:write`, `audit:read`) · Hạ tầng), cột = mọi vai trò (hệ thống trước theo `ROLE_ORDER`, tự tạo sau theo tên). Có `roles:write`: nút "+ Thêm vai trò" ở đầu trang; bấm tiêu đề cột → ngăn 560px "Vai trò": tên hiển thị, mô tả, danh sách quyền có ô chọn theo nhóm, số người đang mang, footer **Lưu** · **Clone** · **Xóa**. Ô không được đổi = 🔒 + lý do (DESIGN law, không nút chết): "Vai trò hệ thống — không xóa/đổi tên", "Bạn đang mang vai trò này", "Bạn không có quyền này nên không cấp được", "Quản trị hệ thống luôn đủ quyền". Clone mở modal Thêm với tên "Bản sao của …" + tập quyền nguồn (bỏ sẵn và báo các mã người gọi không có).
- Lưu: tóm tắt "+2 quyền · −1 quyền" trong nút; 409 `stale` → "Người khác vừa sửa vai trò này" + "Tải bản mới" (giữ lựa chọn của mình để so). Xóa: xác nhận; 409 `role-in-use` → "Còn n người mang vai trò này — đổi vai trò họ ở màn Người dùng trước" + link `/nguoi-dung`.
- Không `roles:write`: như hôm nay, câu mở đầu "Bảng chỉ để xem." giữ; có quyền: "Bấm tên vai trò để sửa."
- Người dùng `/nguoi-dung`: select vai trò từ `GET /roles` (mời: trừ `admin`, `member`; đổi vai trò: trừ `member`; `admin` chỉ hiện khi người gọi là admin — DEC-5); nhãn vai trò trong bảng, chip người dùng (`app/me.tsx`) lấy `label` từ `GET /roles`, fallback `name`.
- `/me` đã `refetchOnWindowFocus`, `staleTime: 0` (`app/me.tsx:42-43`) → người bị đổi quyền thấy menu mới khi tải lại/quay lại tab, không đăng xuất.
- Nhật ký: câu cho `role.*` ("tạo vai trò «Kế toán»", "bật 1 · tắt 2 quyền của «Quản lý»", "xóa vai trò «Kế toán»").

## 4. Edge cases — đề xuất; bạn chốt now · later · n/a
| Category | Case here | Decision (đề xuất) |
|---|---|---|
| Input | tên rỗng/khoảng trắng/>60, tên trùng khác hoa thường/dấu cách (`label_key`), mã quyền lạ/trùng, body thừa khóa | now → 422 / 409 `duplicate` |
| Duplicates & identity | bấm Tạo 2 lần (Idempotency-Key) · clone 2 lần cùng tên → lần 2 409 `duplicate` · `name` sinh bởi server, không đặt được `admin` | now |
| Two people at once | 2 người sửa cùng vai trò → 1 thắng, kia 409 `stale` · xóa vs gán vai trò cho người (batch tuần tự: hoặc 409 `role-in-use`, hoặc 422 `unknown-role`) · gỡ quyền của actor giữa lúc actor đang cấp (WHERE kiểm lại) | now |
| Failure & retry | batch D1 lỗi → không đổi gì, không audit · KV delete lỗi/chậm → cũ tối đa TTL cache (DEC-4) | now |
| Permissions / not logged in | không đăng nhập 401 · thiếu `roles:write` 403 · sửa vai trò mình mang · cấp quyền mình không có · sửa/xóa `admin` · xóa/đổi mã vai trò hệ thống · Giám đốc tự gán `admin` (DEC-5) | now |
| Lockout (OUT-4) | `admin` khóa đủ quyền + guard `last-admin` sẵn có → luôn còn ≥1 người có `roles:write`/`users:write` · admin gỡ `roles:write` khỏi `giam_doc` được (admin không mang `giam_doc`) | now |
| Lifecycle | xóa vai trò còn người → 409 + số người · xóa xong nhật ký cũ vẫn đọc được tên (metadata giữ `label`) · không "ngừng dùng"/khôi phục | now · khôi phục: n/a (Q-4) |
| Luật duyệt | gỡ `contract:approve` khỏi vai trò khi có hợp đồng `pending` → bước có thể hết người duyệt; không viết lại bước đã tạo; người tạo dùng "Rút về nháp" (SPEC-04b) | now: chấp nhận, ghi cảnh báo trong ngăn "Đang có n hợp đồng chờ duyệt cần quyền này" → later |
| Vai trò tự tạo trong bước duyệt | Q-2: không; mẫu vẫn khớp `giam_doc` theo tên | n/a |
| Money / Time | không tiền; `updated_at` unix giây | n/a |
| Lan truyền quyền | người đang mở app: menu đổi khi focus/tải lại; API áp quyền mới ≤ ~60s (KV) | now |

## 5. Security
- Ai làm gì: đọc ma trận = mọi người đăng nhập (giữ SPEC-04a; `holders` chỉ là số đếm) · ghi = `roles:write` (admin, Giám đốc). API quyết định; `can`/🔒 ở UI chỉ là gợi ý.
- Chống nâng quyền: (1) không đụng vai trò mình mang, (2) chỉ cấp mã mình có (kiểm D1 + WHERE), (3) `admin` bất biến qua API, (4) mã vai trò do server sinh — không ai tạo được vai trò tên `admin` để ăn bypass `can()` (`policy.ts:28`), (5) DEC-5 đóng đường tự đổi vai trò qua Người dùng.
- Thông đồng 2 người cùng vai trò: không ai sửa được vai trò chung; người A chỉ tạo được vai trò ⊆ quyền A → không vượt quyền A.
- Thu hồi: thu hồi phải tới nhanh (rbac.md "NOT acceptable for revoke") → DEC-4.
- Dữ liệu cá nhân: không có mới; audit metadata chỉ id/name/label/mã quyền.
- Abuse: đoán `id` (ULID, 404) · gửi `name`/`is_system` trong body (422 `.strict()`) · spam tạo vai trò (≤ 50) · mã quyền tương lai chưa có trong catalog (422).

## 6. Decisions (bạn chốt)
- [DEC-1] Định danh + tên hiển thị · options: **A** thêm `label` (+`label_key`), `name` bất biến, vai trò tự tạo `name` server sinh · **B** dùng `description` làm tên hiển thị, `name` do người nhập (slug) · **C** cho đổi `name` và cập nhật `approval_steps`/mẫu theo · recommended: **A** (bước duyệt + `can()` khớp theo `name`; đổi tên không bao giờ làm gãy luật; tên Việt có dấu tự do) · decided: **A** (bạn chốt 2026-10-01)
- [DEC-2] "admin khóa đủ quyền quản trị" nghĩa là gì · options: **A** vai trò `admin` hoàn toàn bất biến qua API (quyền chỉ đổi bằng migration) · **B** sửa được nhưng luôn giữ `roles:write`+`users:*` · recommended: **A** (đơn giản, không có lối tắt nào làm mất quản trị; admin là tài khoản kỹ thuật, ít đổi) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-3] Cách sửa trên màn Phân quyền · options: **A** ma trận xem + ngăn 560px theo vai trò, Lưu một lần · **B** bấm thẳng ô ma trận, lưu từng ô · recommended: **A** (một Lưu = một CAS + một dòng nhật ký có diff; tránh bấm nhầm thu hồi quyền ngay; ngăn 560px đã là mẫu DESIGN) · decided: **A** (bạn chốt 2026-10-01)
- [DEC-4] Lan truyền quyền tới phiên đang mở · options: **A** sau commit xóa KV của mọi người mang vai trò (giữ TTL 300s) · **B** A + giảm TTL cache principal 300s → 60s · **C** "epoch" quyền đọc từ D1 mỗi request (mạnh nhất, +1 lần đọc D1 mỗi request) · recommended: **B** (A có kẽ đua: request đang miss đọc D1 cũ rồi ghi lại cache sau khi ta xóa → cũ tới 300s; TTL 60s chặn kẽ đó ≈ trễ KV; đội nhỏ, thêm đọc D1 không đáng kể) · decided: **B** (bạn chốt 2026-10-01)
- [DEC-5] Màn Người dùng là đường vòng tự nâng quyền (Giám đốc tự gán `admin` hôm nay được) · options: **A** cấm đổi vai trò của chính mình (403 `self_role`) + chỉ `admin` gán được vai trò `admin` (403 `admin_only`) · **B** chỉ gán vai trò có quyền ⊆ quyền người gán (admin sẽ không mời được Giám đốc vì không có `contract:*` — phá luồng SPEC-01) · **C** giữ nguyên · recommended: **A** (đóng lỗ, admin vẫn khởi tạo được đội). Hệ quả: test SPEC-01 AC-4 "admin cuối tự đổi vai trò → 409 `last-admin`" thành 403 `self_role` (tự khóa mình vẫn 409) · decided: **A** — làm trước dưới dạng **FIX-03** (bạn chốt 2026-10-01: lỗ hổng có sẵn, tách khỏi SPEC-06); SPEC-06 chỉ dựa vào nó
- [DEC-6] Clone · options: **A** ở client: mở modal Thêm điền sẵn, gọi `POST /roles` · **B** `POST /roles/{id}/clone` · recommended: **A** (không thêm endpoint; cùng guard `grant_not_held`) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-7] `member` (vai trò nền, không ai mang) · options: **A** coi là hệ thống, ẩn khỏi select Người dùng, vẫn hiện cột ma trận "Thành viên (nền)" · **B** ẩn hẳn · recommended: **A** (giữ SPEC-04b DEC-2: không che thông tin thật) · decided: **A** (driver chốt — bạn ủy quyền)

## 7. Acceptance
- [AC-1] Sau migrate: `GET /me` admin + Giám đốc có `roles:write`; Quản lý/Nhân viên không; `GET /roles` có `catalog` (16 mã), 5 vai trò `is_system=true` với `label` Việt — proves FR-1, FR-6
- [AC-2] Giám đốc `PATCH /roles/{quan_ly}` bỏ `contract:issue` → 200, `version`+1; Quản lý đang đăng nhập gọi `POST /contracts/{id}/issue` không đăng nhập lại → 403 trong ≤ 60s (test API: ngay lần gọi kế, cùng KV); `audit_events` 1 dòng `role.permissions_changed` `{added:[],removed:["contract:issue"]}` — proves FR-2, FR-7, FR-8
- [AC-3] Hai `PATCH` cùng `expected_version` → một 200, một 409 `stale`; quyền đúng bản thắng; 1 dòng audit — proves §4 Two people
- [AC-4] Clone/tạo: Giám đốc `POST /roles {label:"Kế toán", permissions:["contract:read"]}` → 201, `name` dạng `r_…`; lặp `label:" kế  toán "` → 409 `duplicate`; mã `"contract:delete"` → 422; gửi `name:"admin"` → 422 — proves FR-3, FR-6, §4 Input, DEC-1
- [AC-5] Guard: Giám đốc `PATCH /roles/{giam_doc}` → 403 `own_role`; admin `PATCH` thêm `contract:approve` vào "Kế toán" → 403 `grant_not_held` `permissions:["contract:approve"]`; admin bỏ `users:write` khỏi `giam_doc` → 200; ai `PATCH`/`DELETE` `admin` → 403 `admin_role`; `DELETE /roles/{nhan_vien}` → 403 `system_role`; Nhân viên `POST /roles` → 403; mỗi 403 có 1 `permission.denied`; không đăng nhập → 401 — proves FR-5, §5
- [AC-6] Xóa: "Kế toán" có 2 người → `DELETE` 409 `role-in-use` `holders:2`, vẫn còn; đổi 2 người sang vai trò khác rồi `DELETE` → 204, `GET /roles` không còn, nhật ký `role.deleted` hiện «Kế toán»; xóa song song với mời người vào "Kế toán" (test API) → không bao giờ có user không vai trò — proves FR-4, §4 Lifecycle, Two people
- [AC-7] Người dùng: Giám đốc mời với `role:"r_…"` → 201; `role:"khong_co"` → 422 `unknown-role`; Giám đốc `PATCH /admin/users/{mình} {role:"admin"}` → 403 `self_role`; Giám đốc gán `admin` cho người khác → 403 `admin_only`; admin gán được — proves FR-9, FR-10, DEC-5
- [AC-8] Màn: Giám đốc mở `/phan-quyen` → bấm cột Quản lý → ngăn; bỏ 1 quyền → nút "Lưu (−1 quyền)" → lưu; cột Giám đốc → 🔒 "Bạn đang mang vai trò này"; Nhân viên vào `/phan-quyen` → chỉ xem, không có nút sửa; 390px ngăn toàn màn — proves FR-11, DEC-3
Ngân sách e2e (`e2e-kit/README.md`): **1 spec desktop**, chạy một lần ở PROOF sau suite API: Giám đốc clone Nhân viên → "Kế toán" chỉ `contract:read` → Người dùng gán cho 1 Nhân viên → context Nhân viên đó (đang đăng nhập) tải lại: thấy Hợp đồng, không có nút Tạo, không đăng xuất → Giám đốc thử xóa "Kế toán" (thấy "Còn 1 người…") → Nhật ký có `role.created` + `role.permissions_changed` + `user.role_changed`. Đua (AC-3, AC-6) chỉ ở suite API.

## 8. Rủi ro (đưa vào PLAN)
- [R-1] `invalidatePrincipalCache` theo số người mang: >~900 người chạm trần 1.000 thao tác KV/invocation → cắt lô; nay đội nhỏ, test 1 vai trò 3 người.
- [R-2] Đổi enum → `string` ở `dto/users.ts` đổi kiểu client sinh ra (`packages/client` dòng 3481/3485) → web `features/users/api.ts` phải theo trong cùng đợt.
- [R-3] DEC-5 đổi hành vi SPEC-01 AC-4 → sửa test hiện có, ghi trong PLAN (không phải bug-fix test mới — là guard mới, test đỏ trước).
- [R-4] Mẫu tương lai gắn `role` cho bước duyệt phải dùng `name` vai trò hệ thống; vai trò tự tạo không dùng trong bước (Q-2).

## 9. Tách card gợi ý (file scope rời nhau)
| Card | Phạm vi file | Phụ thuộc | Xong khi |
|---|---|---|---|
| **C-06-001** dữ liệu + catalog | `db/schema.ts` (roles cột mới), `pnpm db:generate` → `0016_*.sql` + seed `roles:write`/backfill, `packages/rbac/src/catalog.ts`, `docs/rbac.md` (mục xóa cache theo vai trò) | — | AC-1 (migrate local) |
| **C-06-002** API vai trò | `dto/roles.ts` (mới), `dto/users.ts` (chỉ `RoleItem`/`RolesResponse` chuyển sang `dto/roles.ts`), `dto/error.ts` (slug), `routes/roles.routes.ts`, `services/role-admin-service.ts` (mới), `dao/role-dao.ts` + `dao/role-write-dao.ts` (mới), `dao/session-cache.ts` (TTL DEC-4), test integration `roles-write.test.ts`, OpenAPI + `packages/client` | 001 | AC-2..AC-6 xanh; `openapi:export && client:generate` sạch |
| **C-06-003** API người dùng | `dto/users.ts` (`role: string`), `services/user-admin-service.ts`, `routes/admin-users.routes.ts`, test `admin-users*.test.ts` (sửa AC-4 SPEC-01), OpenAPI + client | 002 (tuần tự: cùng `dto/*`, client) | AC-7 |
| **C-06-004** web Phân quyền + nhật ký | `apps/web/src/features/roles/**`, `features/audit/audit-sentence.ts` (+test) | 002 | AC-8 |
| **C-06-005** web Người dùng + nhãn vai trò | `apps/web/src/features/users/**`, `apps/web/src/app/me.tsx` | 003 | select đủ vai trò, nhãn tự tạo hiện đúng |
| **C-06-006** e2e + PROOF | `apps/web/e2e/**`, `global-setup.ts` | 004, 005 | spec desktop xanh, PROOF log |
Thứ tự: 001 → 002 → 003 (API tuần tự) → 004 ∥ 005 → 006.

## 10. Trace check (trước STOP)
- [x] FR → OUT: FR-1 → OUT-1/Q-1 · FR-2 → OUT-1 · FR-3 → OUT-2 · FR-4 → OUT-2/4 · FR-5 → OUT-4 · FR-6 → OUT-1/PRB-3 · FR-7 → OUT-1 · FR-8 → OUT-3 · FR-9 → OUT-2 · FR-10 → OUT-4 · FR-11 → OUT-1/2
- [x] AC → FR/edge/DEC: AC-1 FR-1,6 · AC-2 FR-2,7,8 · AC-3 Two people · AC-4 FR-3,6, DEC-1, Input · AC-5 FR-5, Permissions, DEC-2 · AC-6 FR-4, Lifecycle · AC-7 FR-9,10, DEC-5 · AC-8 FR-11, DEC-3 · DEC-4 → AC-2 · DEC-6 → e2e clone · DEC-7 → AC-1
- [x] edge "now" có AC: Input AC-4 · Duplicates AC-4 · Two people AC-3 AC-6 · Failure AC-3 (không audit khi thua) · Permissions AC-5 AC-7 · Lockout AC-5 · Lifecycle AC-6 · Lan truyền AC-2 + e2e
- [x] DEC-1..7 chốt · [x] edge cases theo đề xuất · [x] SPEC duyệt
