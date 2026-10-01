# SPEC-07: Kiểm soát RBAC nâng cao — cặp xung đột (SoD) · four-eyes đổi quyền · admin tạm thời (JIT) · rà soát quý

Status: Approved 2026-10-01 (DEC-1/2/5/6/9/14 bạn chốt; DEC-3/4/7/8/10/11/12/13 + edge "now/later" theo đề xuất — driver chốt, bạn ủy quyền)
Intent: docs/intent/INTENT-07.md (Approved 2026-10-01; Q-1..Q-4 ràng buộc) · Roadmap: ROADMAP-02 row 2b
**Ghi chú ánh xạ INTENT:** Q-4 ("cặp vai trò xung đột") **được bạn diễn giải lại 2026-10-01** thành cặp **quyền** xung đột (DEC-9 B): một vai trò không được chứa cả hai mã của một cặp. Lý do: mỗi người chỉ mang 1 vai trò (§1) nên cặp vai trò không bao giờ chặn. PRB-1/OUT-1 đọc theo nghĩa này.
Phụ thuộc: **SPEC-06 (row 2a) đã BUILD xong** — API cuối của 2a là nền; SPEC-07 chỉ ghi phần đổi thêm (delta). `TODO(2a)` = chi tiết có thể đổi khi 2a build xong, PLAN-07 đối chiếu lại.

## 1. Research (2026-10-01)
Code (đã kiểm):
- **Mỗi người đúng 1 vai trò**: `updateUser` gán vai trò mới rồi `dropOtherRolesStmt` xóa mọi vai trò khác (`user-admin-service.ts:308-309`, `role-dao.ts:119`); mời = 1 vai trò (`:142`). `assignRoleByName` (thêm, không xóa) không có route nào gọi (`admin.routes.ts` chỉ `GET`). ⇒ hôm nay **không ai mang được 2 vai trò** — cặp **vai trò** xung đột không bao giờ chặn ⇒ DEC-9 B: SoD = cặp **quyền** trong một vai trò.
- FIX-03: `self_role` + `admin_only`; `actorIsAdmin` đọc `user_roles` từ **D1** (`user-admin-service.ts:114`), không từ principal. `last-admin`: `notLastActiveAdmin` đếm `user_roles` × `admin` × `active` (`user-dao.ts:267`).
- Principal: `loadPrincipal` đọc KV `session:<id>`, miss → `listRoleNamesForUser` + `listPermissionKeysForUser` từ `user_roles` (`middleware/auth.ts:85-114`); `CachedPrincipal = {id, roles, permissions}` (`session-cache.ts:13`). TTL hiện 300s; SPEC-06 DEC-4 → 60s (`TODO(2a)`: C-06-003).
- `can()` bỏ qua kiểm chủ sở hữu theo **tên** `admin` (`packages/rbac/src/policy.ts:28`) ⇒ ai có tên `admin` trong `roles` + `contract:write` sửa được hợp đồng người khác.
- Ứng viên duyệt đọc `user_roles` từ D1 (`dao/approval-dao.ts:46`). Catalog 16 mã, `resource:verb` một cấp (`catalog.ts`). `audit_events` append-only (trigger, 0018).
- Cron: `[triggers] crons = ["*/5 * * * *", "0 3 * * *"]` cả 3 block env (`wrangler.toml:89,186,278`); `scheduled()` dispatch theo chuỗi cron, lịch lạ → warn (`index.ts:94-118`). Không thêm lịch mới.
- Web: `/phan-quyen` (`features/roles`), `/nguoi-dung` (`features/users`), Nhật ký (`features/audit`); số đếm nav theo mẫu SPEC-04b FR-16.
Docs chính thức (TODO PLAN: đọc lại trước code):
- KV `expirationTtl` tối thiểu 60s — developers.cloudflare.com/kv/api/write-key-value-pairs → không đặt TTL < 60 cho cache principal; hạn JIT phải kiểm trong code (DEC-8).
- Cron Triggers chạy theo giờ **UTC** — developers.cloudflare.com/workers/configuration/cron-triggers → `0 3 * * *` = 10:00 giờ VN; ranh giới quý tính theo `Asia/Ho_Chi_Minh` trong code.
- D1 `batch()` = một transaction, lỗi → rollback cả chuỗi (đã dẫn ở SPEC-06).
Miền: four-eyes hỏng khi người duyệt là "bù nhìn" của người gửi (vd. tài khoản được chính người gửi cấp quyền tạm); JIT hỏng khi quyền tạm sống tiếp trong cache/token, hoặc được dùng để tự biến thành vĩnh viễn; rà soát hỏng khi người rà tự xác nhận chính mình.

## 2. Requirements
- [FR-1] Khai báo/xóa cặp **quyền** xung đột trên Phân quyền (`roles:write`); khai báo khi đã có vai trò chứa cả hai mã → 409 + danh sách vai trò → OUT-1, Q-4 (diễn giải lại, DEC-9)
- [FR-2] Không vai trò nào chứa cả hai mã của một cặp: kiểm khi tạo vai trò (2a `POST /roles`, cả clone), khi **tạo** yêu cầu đổi quyền và **lại khi áp** (duyệt); kiểm trong WHERE (đua với khai báo cặp không lọt). Gán vai trò cho người và JIT không cần kiểm (vai trò đã sạch; `admin` khóa và không thể vi phạm vì cặp `admin` vi phạm bị từ chối khi khai báo) → OUT-1
- [FR-3] Đổi tập quyền của vai trò = tạo **yêu cầu đổi quyền** (diff, ghim `version`); không đổi gì tới khi duyệt; mỗi vai trò tối đa 1 yêu cầu chờ → OUT-2
- [FR-4] Duyệt/từ chối bởi người khác có `roles:write` **thường trực**; không tự duyệt; hết hạn sau 7 ngày; người gửi rút được; duyệt = áp diff bằng CAS + xóa cache người mang (như SPEC-06 FR-7) → OUT-2, Q-1
- [FR-5] Giám đốc cấp quyền quản trị tạm cho **người khác**: lý do + thời hạn ≤ 8 giờ; thu hồi sớm được; hết hạn là mất quyền ngay ở request kế tiếp (không chờ cron) → OUT-4, Q-3
- [FR-6] Trong thời hạn JIT, người nhận dùng **chỉ** quyền `admin`; quyền tạm không tính cho guard đọc từ D1 (`admin_only`, `last-admin`, FR-12 2a, người duyệt FR-4, cấp JIT, rà soát) → OUT-4
- [FR-7] Mỗi quý tự mở một đợt rà soát: chụp danh sách người × vai trò (người đang hoạt động); Giám đốc chọn **Giữ** hoặc **Gỡ** từng dòng → OUT-3, Q-2
- [FR-8] Dòng của người đã đổi vai trò/bị khóa/xóa giữa đợt tự đóng ("đã thay đổi"); đợt quá 15 ngày chưa xong → nhắc trên app (banner + số trên nav) → OUT-3
- [FR-9] Nhật ký (cùng batch, không PII ngoài id/tên vai trò/lý do do người dùng gõ): `sod.pair_added|removed` · `role.change_requested|approved|rejected|withdrawn|expired` · `jit.granted|revoked|expired` · `review.opened|item_decided|closed` → OUT-1..4
- [FR-10] Quyền mới (catalog 16 → 18): `jit:grant` ("Cấp quản trị tạm thời") → `giam_doc`; `reviews:write` ("Rà soát quyền") → `giam_doc` (DEC-13) → OUT-3, OUT-4
- [FR-11] Tạo yêu cầu khi không còn ai đủ điều kiện duyệt → 409 `no-eligible-approver` + cảnh báo trên UI (DEC-14) → OUT-2

## 3. Design
### 3.1 Data (migration `0019_*`+ — `TODO(2a)`: số tiếp theo sau migration cuối của 2a; chỉ thêm bảng/cột/index, không sửa bảng cũ)
- `sod_pairs(id, perm_a, perm_b, reason ≤200, created_by, created_at)` — mã quyền trong catalog (không FK; catalog đóng); lưu `perm_a < perm_b`; `UNIQUE(perm_a, perm_b)`; `CHECK(perm_a <> perm_b)`. Không liên quan vai trò → xóa vai trò không đụng cặp.
- `role_change_requests(id, role_id, base_version, added TEXT json[], removed TEXT json[], note ≤500, status pending|approved|rejected|withdrawn|expired|cancelled, requested_by, requested_at, expires_at = +7 ngày, decided_by, decided_at, decision_note)`; partial `UNIQUE(role_id) WHERE status='pending'`. `expired` tính lúc đọc (`pending AND expires_at <= now`); cron đêm ghi `status='expired'` + audit.
- `jit_grants(id, user_id, role_name='admin', reason 10–500, granted_by, created_at, expires_at, revoked_at, revoked_by, expiry_logged_at)`; "đang hiệu lực" = `revoked_at IS NULL AND expires_at > now`; tối đa 1 hiệu lực/người (CAS `INSERT … WHERE NOT EXISTS`). **Không** ghi vào `user_roles` (DEC-6) → `last-admin`, `actorIsAdmin`, ứng viên duyệt không đổi.
- `access_reviews(id, period 'YYYY-Qn' UNIQUE, status open|closed, opened_by ('system:cron'|userId), opened_at, due_at = +15 ngày, closed_by, closed_at)`; `access_review_items(review_id, user_id, role_name, role_label, decision NULL|keep|remove, decided_by, decided_at, PK(review_id,user_id))` — chụp `user_roles` của user `active`, chưa xóa, lúc mở. Dòng "đã thay đổi" tính lúc đọc (vai trò hiện ≠ `role_name`, hoặc user không còn `active`).
- Catalog + `role_permissions`: `jit:grant`, `reviews:write` → `giam_doc` (`INSERT OR IGNORE`, id literal như 0017).

### 3.2 API (contract-first; ghi cần `Origin` + `X-Requested-With: fetch`; Problem+JSON; 403 nghiệp vụ ghi 1 `permission.denied`)
| Method + path | Quyền | Request → Response | Lỗi |
|---|---|---|---|
| `PATCH /roles/{id}` (đổi, 2a) | `roles:write` | bỏ khóa `permissions` (`.strict()` → 422); chỉ `label`/`description` (DEC-1) | + 409 `request-pending` |
| `DELETE /roles/{id}` (đổi, 2a) | `roles:write` | như 2a | + 409 `request-pending` |
| `GET /roles` (additive) | đăng nhập | `Role` + `pending_request: {id, added, removed, requested_by_name, expires_at} \| null` | 401 |
| `POST /roles/{id}/change-requests` | `roles:write` | `{expected_version, permissions[], note?}` (tập đầy đủ mới) → 201 `ChangeRequest` | 403 `own_role`/`admin_role`/`grant_not_held` · 404 · 409 `stale` · 409 `request-pending` · 409 `sod-conflict` + `pairs` · 409 `no-eligible-approver` · 422 (không đổi gì, mã lạ) |
| `GET /role-change-requests?status=` | `roles:write` | → `{items: ChangeRequest[]}` (+ `can: {approve, reject, withdraw}`, `locked_reason`) | 401/403 |
| `POST /role-change-requests/{id}/approve` | `roles:write` | `{note?}` → 200 `{request, role}` | 403 `self_approve`/`jit_actor`/`own_role` · 404 · 409 `not-pending`/`expired`/`stale`/`sod-conflict` (cặp khai báo sau khi gửi) · 403 `grant_not_held` (người gửi đã mất quyền) |
| `POST /role-change-requests/{id}/reject` | `roles:write` | `{note}` (1–500) → 200 | 403 `self_approve`/`jit_actor` · 409 `not-pending`/`expired` |
| `POST /role-change-requests/{id}/withdraw` | người gửi | → 200 | 403 · 409 `not-pending` |
| `GET /sod-pairs` | đăng nhập | → `{items: [{id, perm_a, perm_b, reason, created_by_name, created_at}]}` | 401 |
| `POST /sod-pairs` | `roles:write` | `{perm_a, perm_b, reason?}` (mã catalog) → 201 | 409 `sod-conflict` + `roles:[{id, name, label}]` · 409 `duplicate` · 422 (mã lạ, cùng mã) |
| `DELETE /sod-pairs/{id}` | `roles:write` | → 204 | 404 |
| `POST /roles` (đổi, 2a) | `roles:write` | như 2a | + 409 `sod-conflict` + `pairs:[[a,b]]` |
| `GET /admin/jit-grants?active=` | `users:read` | → `{items: JitGrant[]}` (`user_name, reason, granted_by_name, expires_at, revoked_at, state`) | 401/403 |
| `POST /admin/jit-grants` (+`Idempotency-Key`) | `jit:grant` | `{user_id, reason, minutes 15..480}` → 201 `JitGrant` | 403 `self_grant`/`jit_actor` · 404 · 409 `jit-active`/`already-admin` · 422 (user không `active`, lý do < 10 ký tự) |
| `POST /admin/jit-grants/{id}/revoke` | `jit:grant` hoặc chính người nhận | → 200 | 404 · 409 `not-active` |
| `GET /me` (additive) | đăng nhập | + `jit: {expires_at} \| null` | — |
| `GET /access-reviews/current` | `reviews:write` hoặc `roles:write` | → `{review \| null, items[{user, role, decision, state: open\|decided\|changed}], progress, overdue}` | 401/403 |
| `POST /access-reviews` | `reviews:write` | → 201 (mở đợt quý hiện tại nếu chưa có) | 409 `duplicate` |
| `POST /access-reviews/{id}/items/{userId}` | `reviews:write` (dòng của mình: DEC-11) | `{decision: keep\|remove}` → 200 | 403 `self_review`/`admin_only` · 409 `item-changed`/`review-closed`/`last-admin` |
| `POST /access-reviews/{id}/close` | `reviews:write` | → 200 | 409 `review-incomplete` |
- Slug mới: `request-pending`, `not-pending`, `expired`, `sod-conflict`, `no-eligible-approver`, `jit-active`, `already-admin`, `not-active`, `item-changed`, `review-closed`, `review-incomplete`; `rule` mới: `self_approve`, `jit_actor`, `self_grant`, `self_review`.
- Mọi guard về **người gọi** đọc D1 `user_roles` (thường trực), không principal (DEC-7). `jit_actor` = người gọi đang có JIT hiệu lực.

### 3.3 Ghi (service mới `role-change-service.ts`, `sod-service.ts`, `jit-service.ts`, `access-review-service.ts`; DAO thuần; một `db.batch`)
- Tạo yêu cầu: guard 2a (`own_role`, `admin_role`, `grant_not_held` trên `added`) → SoD trên tập mới → có ít nhất 1 người duyệt đủ điều kiện DEC-3 (DEC-14) → `INSERT … WHERE NOT EXISTS(pending role_id) AND EXISTS(roles WHERE id=? AND version=?)` + audit có điều kiện.
- Duyệt: stmt 1 CAS `UPDATE role_change_requests SET status='approved' … WHERE id=? AND status='pending' AND expires_at>now AND requested_by<>actor RETURNING`; stmt 2 = CAS `roles.version = base_version` → `+1` (điều kiện stmt 1); rồi `DELETE`/`INSERT…SELECT role_permissions` (INSERT điều kiện người gửi **vẫn** có mã đó qua `user_roles` — 2a FR-12 lặp ở thời điểm áp — và `NOT EXISTS` cặp có mã kia trong tập sau áp — SoD lặp ở thời điểm áp; thiếu dòng → rollback qua CAS phân loại `sod-conflict`); audit `role.change_approved` + `role.permissions_changed` (2a). 0 dòng → đọc lại phân loại. Sau commit: xóa cache mọi người mang vai trò (2a).
- Người duyệt (DEC-3): có `roles:write` thường trực, ≠ người gửi, không JIT hiệu lực; nếu yêu cầu **thêm** quyền mà người duyệt mang vai trò đó → 403 `own_role` (bớt quyền thì được). Không bắt người duyệt có mã được thêm.
- SoD (FR-2): hàm thuần `sodViolations(perms[], pairs[])` (trước batch, cho lỗi rõ) + fragment SQL `sodClear(roleId)` trong WHERE của INSERT `role_permissions` (2a tạo vai trò, áp yêu cầu). Thêm cặp: `INSERT … WHERE NOT EXISTS(vai trò có cả hai mã)`; 0 dòng → liệt kê vai trò → 409. D1 batch tuần tự ⇒ khai báo cặp ∥ duyệt yêu cầu: chỉ một bên thắng.
- Người duyệt đủ điều kiện (DEC-14): `EXISTS` user `active` ≠ người gửi, có `roles:write` qua `user_roles`, không JIT hiệu lực, (nếu yêu cầu thêm quyền) không mang vai trò đó.
- JIT: INSERT CAS (không tự cấp, user `active`, không mang `admin` thường trực, không JIT hiệu lực; SoD n/a — FR-2) + audit `jit.granted {user, reason, expires_at}` → xóa cache người nhận. Thu hồi: `UPDATE … SET revoked_at WHERE id=? AND revoked_at IS NULL AND expires_at>now RETURNING` + audit + xóa cache.
- Principal (FR-5/6): loader đọc thêm JIT hiệu lực → có thì `roles=["admin"]`, `permissions` = quyền của `admin` (DEC-6); `CachedPrincipal` + `valid_until = min(now+TTL, jit.expires_at)`; middleware coi cache có `now ≥ valid_until` là miss (DEC-8). `listRoleNamesForUser` **giữ nguyên** (để `actorIsAdmin`/guard không thấy JIT).
- Cron (không lịch mới): `*/5` → `jit-expiry`: `UPDATE jit_grants SET expiry_logged_at=now WHERE expires_at<=now AND revoked_at IS NULL AND expiry_logged_at IS NULL RETURNING` → audit `jit.expired` + xóa cache (≤100/tick). `0 3` → `rbac-daily`: mở đợt quý hiện tại nếu chưa có (UNIQUE `period`, ngày theo `Asia/Ho_Chi_Minh`) + đổi yêu cầu quá hạn → `expired` + audit.
- Rà soát "Gỡ" (DEC-10) = gọi `updateUser({status:"disabled"})` có sẵn (FIX-03 `admin_only`, `last-admin`, thu hồi refresh token, xóa cache) rồi ghi `decision` có điều kiện "user đã `disabled`". "Giữ" = chỉ ghi `decision`. `item-changed` khi trạng thái/vai trò hiện ≠ ảnh chụp.

### 3.4 Màn hình (DESIGN.md: ngăn 560px, 🔒 + lý do, rỗng = 1 câu + 1 việc, 390px toàn màn)
- **Phân quyền** `/phan-quyen`: 3 tab — "Ma trận" (như 2a) · "Yêu cầu đổi quyền" (số chờ trên tab) · "Cặp xung đột". Ngăn vai trò: nút Lưu quyền đổi thành **"Gửi yêu cầu (+2 · −1)"**; nhãn/mô tả vẫn "Lưu". Vai trò có yêu cầu chờ → dải trên ngăn "Đang chờ duyệt: +2 · −1 — do «An» gửi, hết hạn 08/10" + ô quyền khóa 🔒 "Đang có yêu cầu chờ duyệt"; người khác: **Duyệt** · **Từ chối** (hỏi lý do); người gửi: 🔒 "Bạn gửi yêu cầu này — cần người khác duyệt" + **Rút yêu cầu**. Không còn ai duyệt được (DEC-14): nút Gửi 🔒 + cảnh báo "Không còn người nào khác có quyền Quản lý vai trò để duyệt — đổi quyền phải qua người quản trị kỹ thuật (migration)" (hiện trước khi bấm, từ `GET /roles` `can.request=false` + `locked_reason:"no_approver"`). Tập mới vi phạm cặp → dưới ô quyền: "«Tạo & sửa hợp đồng» xung đột với «Duyệt / từ chối» — bỏ một trong hai". Tab yêu cầu: bảng (Vai trò · Thay đổi · Người gửi · Gửi lúc · Hết hạn · Trạng thái pill); rỗng "Không có yêu cầu nào đang chờ."
- Tab "Cặp xung đột": danh sách "«Phát hành & hủy» ⟷ «Duyệt / từ chối» — lý do" (nhãn quyền từ `permission-labels`); "+ Thêm cặp" (modal 2 select quyền theo nhóm + lý do); 409 → "Đang có vai trò chứa cả hai quyền: «Quản lý», «Giám đốc» — bỏ một quyền khỏi các vai trò đó trước" + bấm tên mở ngăn vai trò. Nav "Phân quyền" có số yêu cầu chờ **người gọi duyệt được** (mẫu FR-16 4b).
- **Người dùng** `/nguoi-dung`: Giám đốc thấy hành động dòng "Cấp quản trị tạm thời" (modal: lý do, thời hạn 15 phút…8 giờ, câu "Tự thu hồi lúc 15:30"); dòng đang có JIT: chip "Quản trị tạm · còn 2 giờ 10 phút" + "Thu hồi ngay". Dòng của mình: 🔒 "Không tự cấp cho mình".
- Người nhận JIT: banner đầu app "Bạn đang có quyền quản trị tạm thời — hết hạn lúc 15:30 · Kết thúc sớm"; menu theo quyền admin.
- **Rà soát quyền** `/ra-soat-quyen` (nav HỆ THỐNG, cần `reviews:write`|`roles:write`): đầu trang "Đợt Q4/2026 · hạn 15/10 · 12/20 dòng"; bảng Người · Vai trò · Quyết định (Giữ / Gỡ (khóa tài khoản, xác nhận)); dòng "đã thay đổi" pill xám, không nút; dòng của mình 🔒 "Không tự rà soát chính mình — người quản trị xác nhận"; dòng admin "Gỡ" 🔒 "Chỉ quản trị khóa được tài khoản quản trị"; "Kết thúc đợt" khi đủ. Quá hạn: banner trang chủ cho GĐ "Đợt rà soát Q4/2026 quá hạn 3 ngày — Rà soát ngay" + số trên nav. Không có đợt: "Chưa có đợt rà soát quý này — Bắt đầu rà soát".
- Nhật ký: câu cho mọi action FR-9 ("«An» gửi yêu cầu bật 2 · tắt 1 quyền của «Quản lý»", "cấp quản trị tạm thời cho «Bình» tới 15:30 — lý do: …").

## 4. Edge cases — đề xuất; bạn chốt now · later · n/a
| Category | Case here | Decision (đề xuất) |
|---|---|---|
| Input | lý do JIT < 10 / > 500 ký tự; `minutes` ngoài 15..480; cặp cùng mã / mã lạ; yêu cầu không đổi gì; mã lạ | now → 422 |
| Duplicates & identity | cặp trùng (A,B)=(B,A) · 2 yêu cầu chờ cho 1 vai trò · 2 JIT hiệu lực cho 1 người · 2 đợt cùng quý (cron + bấm tay) · bấm Cấp JIT 2 lần (Idempotency-Key) | now |
| Two people at once | duyệt ∥ rút · duyệt ∥ duyệt · thêm cặp ∥ duyệt yêu cầu thêm mã của cặp · rà "Gỡ" ∥ đổi vai trò người đó | now (CAS, 1 thắng) |
| Yêu cầu cũ | vai trò bị sửa/xóa khi có yêu cầu chờ → bị chặn 409 `request-pending` (DEC-4); `version` lệch vẫn → 409 `stale` (phòng thủ); người gửi mất `roles:write`/mã được thêm trước lúc duyệt → 403, yêu cầu giữ chờ tới hết hạn | now |
| Failure & retry | batch lỗi → không đổi gì; cron lỡ tick → tick sau làm bù (điều kiện `IS NULL`); xóa KV lỗi → `valid_until` vẫn cắt JIT đúng giờ | now |
| Permissions | không đăng nhập 401 · tự duyệt · tự cấp JIT · người có JIT duyệt/cấp JIT/rà soát · GĐ cấp `admin` thường trực (vẫn `admin_only`) · tự rà dòng mình | now |
| Lockout | chỉ còn 1 người có `roles:write` thường trực (GĐ nghỉ) → tạo yêu cầu 409 `no-eligible-approver` + cảnh báo UI; đổi quyền qua migration; ghi `docs/rbac.md` | now (DEC-14) |
| SoD × vai trò hệ thống | khai báo cặp mà `giam_doc`/`quan_ly` đang vi phạm (vd. `contract:write`+`contract:approve`) → 409 liệt kê; cặp `admin` vi phạm → 409 (admin chỉ đổi bằng migration) | now |
| Lifecycle | người bị rà giữa đợt bị khóa/xóa/đổi vai trò → dòng tự đóng · người mới giữa đợt → đợt sau · người nhận JIT bị khóa → JIT vô hiệu (principal null) · xóa cặp → không đổi vai trò nào | now |
| JIT × duyệt hợp đồng | người nhận JIT (vd. Quản lý) là người duyệt bước đang chờ nhưng ≤ 8h mất `contract:approve` | later (chấp nhận; banner nói rõ) |
| Lách four-eyes | tạo vai trò mới (⊆ quyền mình) rồi chuyển người mang sang | later (DEC-2: FR-12 + nhật ký + rà soát quý bắt được) |
| Money | — | n/a |
| Time | hạn tính giây unix UTC; hiển thị giờ VN; quý theo `Asia/Ho_Chi_Minh`; 7 ngày/15 ngày/8 giờ so ở server | now |

## 5. Security
- SoD: cặp quyền kiểm ở mọi đường làm đổi tập quyền của vai trò (tạo, áp yêu cầu) — trong WHERE, không chỉ trước batch.
- Ai làm gì: cặp + yêu cầu = `roles:write`; duyệt = `roles:write` thường trực ≠ người gửi, không JIT; JIT = `jit:grant` (GĐ) cho người khác; rà soát = `reviews:write` (GĐ), dòng của GĐ do người `roles:write` thường trực khác. API quyết định; 🔒 ở UI chỉ là gợi ý.
- Chống bù nhìn: người có JIT không duyệt yêu cầu, không cấp JIT, không rà soát, không qua `admin_only` (FR-6) → GĐ không cấp admin tạm cho X rồi để X duyệt yêu cầu của chính GĐ.
- Chống biến tạm thành vĩnh viễn: JIT không nằm trong `user_roles` → `admin_only` (D1) chặn người nhận gán `admin` cho ai; `self_role` chặn tự đổi.
- Hết hạn: cắt ở request kế tiếp nhờ `valid_until` (không phụ thuộc cron/KV); token truy cập không mang quyền (JWT chỉ `sub`/`jti`).
- Ownership bypass: DEC-6 tránh tổ hợp `admin` + `contract:*` trên một principal.
- Dữ liệu cá nhân: lý do JIT/ghi chú là văn bản tự do → hướng dẫn trong modal "Không ghi thông tin cá nhân"; audit giữ id + tên hiển thị như 2a.
- Abuse: đoán id (ULID → 404) · gửi `permissions` qua PATCH (422) · spam yêu cầu (1 chờ/vai trò) · JIT nối tiếp liên tục (mỗi lần đều có lý do + nhật ký; rà soát thấy) → later: giới hạn số lần/tuần.

## 6. Decisions (bạn chốt)
- [DEC-1] Hình dạng API four-eyes · options: **A** tài nguyên mới `POST /roles/{id}/change-requests` + duyệt/từ chối/rút; `PATCH /roles` bỏ `permissions` · **B** `PATCH` có `permissions` trả 202 + yêu cầu · **C** `PATCH ?mode=request` · recommended: **A** (rõ ràng, mỗi bước 1 quyền + 1 dòng nhật ký; 2a đổi hợp đồng cùng commit với client) · decided: **A** (bạn chốt 2026-10-01)
- [DEC-2] Four-eyes phủ tới đâu · options: **A** chỉ đổi tập quyền vai trò đã có; tạo (⊆ quyền mình, 0 người mang) và xóa (0 người) đi thẳng · **B** cả tạo/xóa · **C** cả gán vai trò cho người · recommended: **A** (đúng PRB-2; lối lách "tạo vai trò mới rồi chuyển người" vẫn bị FR-12 giới hạn ⊆ quyền người làm + nhật ký + rà soát quý) · decided: **A** (bạn chốt 2026-10-01)
- [DEC-3] Ai duyệt · options: **A** người có `roles:write` thường trực khác người gửi, không JIT; mang vai trò đó chỉ bị chặn khi yêu cầu **thêm** quyền; không cần có mã được thêm; FR-12 kiểm lại người gửi lúc áp · **B** người duyệt phải có mọi mã được thêm · recommended: **A** (B làm admin — không có `contract:*` — không bao giờ duyệt được đổi quyền hợp đồng ⇒ GĐ kẹt; Q-1) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-4] Yêu cầu cũ khi vai trò đổi/xóa · options: **A** có yêu cầu chờ → khóa vai trò (`PATCH`/`DELETE`/yêu cầu mới → 409 `request-pending`), rút hoặc hết hạn mới mở; CAS `base_version` phòng thủ · **B** cho sửa, yêu cầu thành `stale` · **C** lúc duyệt áp lại diff lên tập hiện tại · recommended: **A** (người duyệt thấy đúng cái sẽ đổi; không có yêu cầu "chết" ngầm) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-5] JIT vs FIX-03 `admin_only` ("chỉ admin gán admin") · options: **A** JIT là đường riêng (`jit_grants` + `jit:grant`), không phải gán vai trò: `admin_only` giữ nguyên cho gán thường trực; GĐ được cấp tạm dù không ⊇ quyền admin (ngoại lệ có chủ đích của 2a FR-12, kèm lý do + ≤ 8h + nhật ký) · **B** JIT cần admin đồng ý (four-eyes) · **C** chỉ admin cấp JIT · recommended: **A** (Q-3 ràng buộc: GĐ cấp; admin kỹ thuật thường trực giữ nguyên) · decided: **A** (bạn chốt 2026-10-01)
- [DEC-6] Quyền hiệu lực khi có JIT · options: **A** thay thế: trong thời hạn principal = chỉ `admin` · **B** cộng: vai trò cũ + `admin` · recommended: **A** (B + `can()` bỏ qua chủ sở hữu theo tên `admin` ⇒ người nhận có `contract:write` sửa được hợp đồng người khác; A không đụng `policy.ts`) · decided: **A** (bạn chốt 2026-10-01)
- [DEC-7] Guard đọc D1 có tính JIT không · options: **A** không: mọi guard về người gọi (`admin_only`, `last-admin`, FR-12, người duyệt, cấp JIT, rà soát) chỉ đọc `user_roles`; JIT chỉ mở cổng `requirePerm` · **B** tính · recommended: **A** (đóng đường biến tạm thành vĩnh viễn và đường bù nhìn) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-8] Thu hồi khi hết hạn · options: **A** kiểm lúc request (`valid_until` trong cache principal) + cron `*/5` chỉ ghi nhật ký `jit.expired` · **B** chỉ cron (quá hạn tới 5 phút + TTL cache) · recommended: **A** (KV không cho TTL < 60s; hết hạn phải chính xác) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-9] SoD khi mỗi người chỉ 1 vai trò · options: **A** cặp vai trò như Q-4 gốc (gần như không bao giờ chặn) · **B** cặp **quyền**: không vai trò nào chứa cả hai mã; kiểm khi tạo vai trò, khi tạo + áp yêu cầu; khai báo cặp đã bị vai trò vi phạm → 409 liệt kê vai trò; JIT n/a (admin khóa) · **C** dời · recommended: A (driver, bám Q-4) · decided: **B** (bạn chốt 2026-10-01 — diễn giải lại Q-4)
- [DEC-10] "Gỡ" trong rà soát · options: **A** khóa tài khoản (dùng `updateUser` có sẵn; đổi vai trò làm ở Người dùng → dòng tự đóng) · **B** chọn vai trò mới ngay tại dòng · **C** chỉ đánh dấu, người làm tay sau · recommended: **A** (một hành động rõ, tái dùng guard FIX-03 + `last-admin`) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-11] Dòng của chính Giám đốc · options: **A** người `roles:write` thường trực khác (admin) xác nhận dòng đó · **B** bỏ dòng GĐ khỏi đợt · **C** GĐ tự xác nhận · recommended: **A** (không tự rà; admin chỉ thấy/quyết dòng GĐ) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-12] Mở đợt · options: **A** cron `0 3` tự mở khi quý hiện tại chưa có đợt + nút "Bắt đầu rà soát" dự phòng · **B** chỉ bấm tay · recommended: **A** (không quên; UNIQUE `period` chống trùng) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-14] Lockout four-eyes (không còn ai duyệt được) · options: **A** chặn tạo yêu cầu 409 `no-eligible-approver` + cảnh báo UI trước khi bấm; đường thoát = migration · **B** cho tạo, yêu cầu chờ tới hết hạn · **C** cho người gửi tự duyệt khi không còn ai · recommended: **A** · decided: **A** (bạn chốt 2026-10-01)
- [DEC-13] Quyền cho JIT/rà soát · options: **A** mã mới `jit:grant`, `reviews:write` → `giam_doc` · **B** dùng `users:write`/`roles:write` · recommended: **A** (ít quyền nhất; hiện trên ma trận; admin không tự cấp JIT) · decided: **A** (driver chốt — bạn ủy quyền)

## 7. Acceptance
- [AC-1] GĐ thêm cặp (`contract:issue`, `template:write`) khi `giam_doc` có cả hai → 409 `sod-conflict` `roles:[giam_doc]`; cặp (`contract:issue`, `users:read`) → 201 (không vai trò nào có cả hai), `sod.pair_added`; thêm đảo thứ tự → 409 `duplicate`; mã lạ → 422 — proves FR-1, DEC-9
- [AC-2] Có cặp (`contract:issue`, `users:read`): GĐ `POST /roles` có cả hai → 409 `sod-conflict`; yêu cầu thêm `users:read` cho `quan_ly` (có `contract:issue`) → 409 lúc tạo; yêu cầu hợp lệ rồi khai báo cặp, duyệt → 409 `sod-conflict`, quyền không đổi; khai báo cặp ∥ duyệt (test API) → không bao giờ có vai trò chứa cả hai — proves FR-2, §4 Two people
- [AC-13] Admin bị khóa (chỉ còn GĐ có `roles:write` thường trực): GĐ tạo yêu cầu → 409 `no-eligible-approver`; ngăn hiện 🔒 + câu cảnh báo trước khi bấm — proves FR-11, DEC-14
- [AC-3] GĐ `PATCH /roles/{quan_ly}` có `permissions` → 422; `POST …/change-requests` bỏ `contract:issue` → 201, quyền Quản lý **chưa** đổi, `role.change_requested`; tạo yêu cầu thứ hai → 409 `request-pending`; `PATCH` nhãn → 409 `request-pending` — proves FR-3, DEC-1, DEC-4
- [AC-4] GĐ duyệt yêu cầu của mình → 403 `self_approve`; admin duyệt → 200, `version`+1, Quản lý đang đăng nhập gọi phát hành → 403 ngay lần kế; nhật ký `role.change_approved` + `role.permissions_changed`; duyệt lần 2 → 409 `not-pending`; 2 duyệt song song → 1 thắng — proves FR-4, Q-1
- [AC-5] Yêu cầu gửi lúc T, đồng hồ T+7 ngày → duyệt 409 `expired`, `GET` hiện hết hạn, vai trò mở khóa; cron đêm ghi `role.change_expired` 1 lần — proves FR-4, §4 Time
- [AC-6] GĐ cấp JIT 60 phút cho Nhân viên → 201; người đó `GET /me` có `settings:write`, không `contract:write`, `jit.expires_at`; đồng hồ +61 phút → request kế 403 `settings:write` dù cache KV còn; cron `*/5` → 1 dòng `jit.expired` — proves FR-5, DEC-6, DEC-8
- [AC-7] GĐ tự cấp JIT → 403 `self_grant`; cấp 9 giờ → 422; Nhân viên có JIT: `PATCH /admin/users/{x} {role:"admin"}` → 403 `admin_only`; duyệt yêu cầu → 403 `jit_actor`; `POST /admin/jit-grants` → 403; admin thường trực duy nhất bị khóa khi đang có JIT → 409 `last-admin` — proves FR-6, DEC-5, DEC-7, §5
- [AC-8] Thu hồi sớm → request kế mất quyền admin, `jit.revoked`; người nhận tự "Kết thúc sớm" được — proves FR-5
- [AC-9] Cron `0 3` ngày 01/10 (giờ VN) → 1 đợt `2026-Q4`, mỗi user active 1 dòng; chạy lại/bấm "Bắt đầu" → không đợt thứ hai — proves FR-7, DEC-12
- [AC-10] GĐ "Giữ" dòng A → `review.item_decided`; "Gỡ" dòng B → B `disabled`, phiên B 401; dòng của GĐ → 403 `self_review`, admin quyết được; dòng admin "Gỡ" → 403 `admin_only`; C bị đổi vai trò giữa đợt → `state:changed`, quyết → 409 `item-changed`; "Kết thúc" khi còn dòng mở → 409 — proves FR-7, FR-8, DEC-10, DEC-11
- [AC-11] Đồng hồ +16 ngày, đợt chưa đóng → `overdue:true`; GĐ thấy banner + số trên nav — proves FR-8
- [AC-12] Màn: GĐ bỏ 1 quyền Quản lý → "Gửi yêu cầu (−1)" → dải "Đang chờ duyệt"; admin mở tab Yêu cầu → Duyệt; GĐ ở Người dùng cấp JIT → chip "Quản trị tạm"; người nhận thấy banner; 390px ngăn/modal toàn màn — proves FR-3..5 UI, §3.4
- Không đăng nhập mọi endpoint mới → 401; Nhân viên gọi → 403 + `permission.denied`.
Ngân sách e2e: **1 spec desktop** ở PROOF (AC-12); đua, hết hạn, cron chỉ ở suite API (đồng hồ giả qua `deps.now` — `TODO(PLAN)`: cách gọi `scheduled()` trong vitest).

## 8. Rủi ro (đưa vào PLAN)
- R-1 2a đang build: `PATCH /roles` bỏ `permissions` phá test AC-2/AC-3/AC-5 của SPEC-06 (`roles-acceptance.test.ts`) → PLAN-07 chuyển các test đó sang luồng yêu cầu + duyệt (guard mới, đỏ trước), không sửa cho xanh.
- R-2 `loadPrincipal` là đường nóng mọi request: thêm 1 truy vấn JIT chỉ khi cache miss; `valid_until` thiếu ở cache cũ → coi như không JIT (an toàn vì JIT luôn xóa cache khi cấp).
- R-3 Lockout four-eyes (DEC-14): đường thoát duy nhất là migration; ghi `docs/rbac.md`. `can.request`/`locked_reason:"no_approver"` trên `GET /roles` là additive (`TODO(2a)`: khớp `locked_reason` cuối của 2a).
- R-7 Khai báo cặp mà vai trò seed vi phạm bị chặn — muốn dùng cặp đó phải gửi yêu cầu bỏ quyền trước (đúng ý đồ, nhưng giải thích trong UI).
- R-4 Partial unique index (`WHERE status='pending'`) qua drizzle-kit: đọc SQL sinh ra; không được thì viết tay.
- R-5 `run_worker_first` phải có `/role-change-requests*`, `/sod-pairs*`, `/access-reviews*` (cả 3 block) — bài học PLAN-06 R-2.
- R-6 Cron đêm làm nhiều việc: mỗi nhánh try/catch riêng như `pruneExpiredRows`.

## 9. Tách card gợi ý (file scope rời nhau)
| Card | Phạm vi file | Phụ thuộc | Xong khi |
|---|---|---|---|
| **C-07-001** dữ liệu + catalog | `db/schema.ts`, `migrations/0019_*`+, `catalog.ts`, `dao/sod-dao.ts` (`sodClear`, `listPairs`), `domain/sod.ts` (`sodViolations` + unit test), `docs/rbac.md` | 2a xong | migrate local; `/me` GĐ có 2 mã mới |
| **C-07-002** hợp đồng OpenAPI | `dto/roles.ts` (bỏ `permissions` PATCH), `dto/{role-change,sod,jit,access-review}.ts`, `dto/error.ts`, `routes/*` mới (501), `wrangler.toml`, `index.ts` dispatch + `crons/{jit-expiry,rbac-daily}.ts` (stub), OpenAPI + client | 001 | client sạch |
| **C-07-003** SoD + four-eyes API | `services/{sod,role-change}-service.ts`, `role-admin-service.ts` (delta: SoD khi tạo, `request-pending`, `can.request`), `dao/role-change-dao.ts`, routes tương ứng, test | 002 | AC-1..AC-5, AC-13 |
| **C-07-004** JIT API | `services/jit-service.ts`, `dao/jit-dao.ts`, `middleware/auth.ts`, `session-cache.ts`, `routes/me.routes.ts`, routes JIT, `crons/jit-expiry.ts`, `docs/auth.md`, test | 002 (∥ 003) | AC-6..AC-8 |
| **C-07-005** rà soát API | `services/access-review-service.ts`, `dao/access-review-dao.ts`, routes, `crons/rbac-daily.ts`, test | 002 (∥ 003, 004; chỉ import `updateUser`) | AC-9..AC-11 |
| **C-07-006** web Phân quyền | `features/roles/**`, `audit-sentence.ts`, `problem-messages.ts` (mọi slug/rule 2b) | 003 | ngăn + 2 tab |
| **C-07-007** web JIT + rà soát | `features/users/**`, `features/access-review/**` (mới), `app/layout.tsx` (banner), nav | 004, 005, 006 | AC-12 phần JIT/rà soát |
| **C-07-008** e2e + PROOF | `apps/web/e2e/**`, PLAN PROOF log | 001–007 | AC-12 xanh |
Thứ tự: 001 → 002 → (003 ∥ 004 ∥ 005) → 006 → 007 → 008. Chỉ 002 sinh `packages/client`; `rbac-daily.ts` (005) gọi cả đổi yêu cầu quá hạn — hàm DAO do 003 xuất (005 chờ 003 ở bước đó hoặc 003 viết luôn nhánh đó: PLAN chốt).

## 10. Trace check (trước STOP)
- [x] FR → OUT: FR-1,2 → OUT-1 (Q-4 diễn giải lại) · FR-3,4,11 → OUT-2 · FR-5,6 → OUT-4 · FR-7,8 → OUT-3 · FR-9 → OUT-1..4 · FR-10 → OUT-3,4
- [x] AC → FR/edge/DEC: AC-1 FR-1 · AC-2 FR-2, Two people · AC-3 FR-3, DEC-1,4 · AC-4 FR-4, DEC-3 · AC-5 FR-4, Time · AC-6 FR-5, DEC-6,8 · AC-7 FR-6, DEC-5,7 · AC-8 FR-5 · AC-9 FR-7, DEC-12 · AC-10 FR-7,8, DEC-10,11 · AC-11 FR-8 · AC-12 UI · AC-13 FR-11, DEC-14 · DEC-2 → AC-3 (tạo vai trò đi thẳng, có SoD) · FR-9 trong AC-1,3,4,5,6,8,10 · FR-10 AC-6,7 (DEC-13)
- [x] edge "now" có AC: Input AC-1,7 · Duplicates AC-1,3,9 · Two people AC-2,4 · Yêu cầu cũ AC-3 · Failure AC-6 (cache còn vẫn cắt) · Permissions AC-7,10 · Lockout AC-13 · SoD × hệ thống AC-1 · Lifecycle AC-10 · Time AC-5,6,11
- [x] DEC-1..14 chốt · [x] edge theo đề xuất · [x] SPEC duyệt 2026-10-01
