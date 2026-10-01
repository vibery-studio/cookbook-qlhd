# FIX-05: Giám đốc = chủ sở hữu, admin = vận hành IT (lỗ bù nhìn admin + kẹt vai trò Giám đốc)

Status: Fixed 2026-10-01

## 1. What happens vs what should
- Steps (a) lỗ: admin → `POST /admin/users {role:"admin"}` → 201 → tài khoản bù nhìn có `roles:write` duyệt yêu cầu đổi quyền của chính admin → lách cơ chế duyệt 2 lớp.
- Steps (b) kẹt: admin gửi yêu cầu THÊM quyền cho `giam_doc` → 409 `no-eligible-approver` (người duy nhất còn lại là GĐ, mang `giam_doc` → own_role). Vai trò `admin` khóa với mọi người.
- Expected (bạn chốt mô hình "Giám đốc = chủ, admin = IT"):
  - R1. Người mang `giam_doc` duyệt được yêu cầu đổi quyền của `giam_doc` (own_role không áp; vẫn ≠ người gửi, không JIT). Vai trò khác giữ own_role.
  - R2. `admin` đổi quyền qua yêu cầu như mọi vai trò; người duyệt PHẢI mang `giam_doc` và ≠ người gửi (thêm hay bớt đều vậy) → khác: 403 `owner_only`. Admin được đề xuất. Đổi tên/xóa `admin` vẫn `admin_role`.
  - R3. Mời / gán vai trò có `roles:write` (admin, giam_doc, vai trò tự tạo) → chỉ người mang `giam_doc` (403 `owner_only` + 1 `permission.denied`). `self_role` (FIX-03) giữ nguyên. Admin vẫn mời/gán Quản lý, Nhân viên, vai trò không có `roles:write`.
- Thay đổi hành vi đã duyệt: FIX-03 "chỉ admin gán admin" → nay chỉ GĐ gán; SPEC-07 AC-13 vế "admin thêm quyền cho giam_doc → 409" → nay 201, GĐ duyệt; SPEC-06/07 "admin bất biến qua API" → chỉ còn nhãn/xóa.
- Driver tự quyết thêm (cần bạn xác nhận):
  - Khởi tạo: khi CHƯA ai mang `giam_doc` (mọi trạng thái), người có `users:write` (admin) mời/gán được GĐ đầu tiên — không có thì app không có GĐ nào.
  - Đổi vai trò của người đang mang `giam_doc` → chỉ GĐ (`owner_only`) — nếu không, admin hạ GĐ rồi dùng khe khởi tạo tạo GĐ bù nhìn.
  - GĐ gán vai trò có `roles:write` không cần ⊇ quyền vai trò đó (FR-12 miễn cho riêng lớp này; GĐ không có `settings:*`).

## 2. Failing test — before touching the code
- `apps/api/test/integration/fix-05-owner.test.ts` (6 test) → đỏ trên code cũ (test cuối là hồi quy, xanh sẵn):
  ```
  FAIL … > R3: admin cannot invite or assign a role carrying roles:write …  AssertionError: expected 201 to be 403
  FAIL … > R3: Giám đốc invites / assigns admin → 201 / 200 …            AssertionError: invite it2@nhatminh.vn as admin: expected 403 to be 201
  FAIL … > R1: admin requests +settings:read on giam_doc → 201 …          AssertionError: change request on giam_doc: expected 409 to be 201
  FAIL … > R2: admin proposes a change to the admin role → 201 …          AssertionError: invite it2@nhatminh.vn as admin: expected 403 to be 201
  FAIL … > R2: Giám đốc is the only owner → … no approver …               AssertionError: expected null to be 'no_approver'
   Tests  5 failed | 1 passed (6)
  ```

## 3. Cause
- `role-change-service` coi `admin` là bất biến (`admin_role`) và áp own_role cho mọi vai trò, kể cả vai trò của chủ → không ai duyệt được việc thêm quyền cho `giam_doc`.
- `user-admin-service` chỉ chặn "người không phải admin gán `admin`" → admin tự tạo admin thứ hai, tức người duyệt thứ hai do chính mình dựng.

## 4. Fix + proof
- API (`OWNER_ROLE`, `userIsOwnerSql`, `ownerMayAssignSql`, `ownerMayReassignSql` — `dao/role-dao.ts`; `approverScope`, `eligibleApproverSql({ownerOnly})` — `dao/role-change-dao.ts`):
  - Tạo yêu cầu: bỏ `admin_role`; own_role không áp cho `admin`; người duyệt đủ điều kiện theo `approverScope` (admin → GĐ; giam_doc → bỏ điều kiện "không mang"; khác → như cũ) — cùng predicate trong WHERE của INSERT.
  - Duyệt: `decisionLock` (403 `owner_only` / `own_role`) + `approveRoleGuard` trong điều kiện của dòng audit đánh dấu đầu batch (đọc tên vai trò trong batch). Từ chối giữ nguyên.
  - `GET /roles`: `admin` giữ `locked_reason:"admin"` (nhãn/xóa) nhưng `can.request` = có GĐ khác người gọi; `no_approver` tính theo vai trò. `ChangeRequest.locked_reason` thêm `owner_only`.
  - Mời/đổi vai trò: 403 `owner_only` từ lần đọc D1 + cùng điều kiện trong WHERE của lệnh ghi đầu batch (người dùng/vai trò không được tạo nếu đổi giữa chừng).
  - OpenAPI: enum `owner_only` + mô tả 403/409 → `pnpm openapi:export && pnpm client:generate`.
- Web: `problem-messages.ts` câu `owner_only`, `admin_only` bỏ vế "gán"; Người dùng: vai trò có `roles:write` hiện 🔒 "Chỉ Giám đốc gán vai trò có quyền Quản lý vai trò" với người không phải GĐ (trừ GĐ đầu tiên), hàng GĐ: 🔒 "Chỉ Giám đốc đổi vai trò của Giám đốc"; ngăn vai trò `admin` mở checklist gửi yêu cầu, câu khóa mới, thiếu người duyệt → câu riêng; ma trận bỏ 🔒 cột admin khi gửi yêu cầu được; yêu cầu: 🔒 "Chỉ Giám đốc duyệt đổi quyền của vai trò Quản trị hệ thống".
- Test sửa (luật cũ): fix-03 (GĐ gán admin → 200; admin gán admin → `owner_only`; admin thứ hai do GĐ tạo), rbac-advanced AC-3 (`admin` → 409 `no-eligible-approver`), AC-4 (admin2 do GĐ mời), AC-7 (JIT gán admin → `owner_only`), AC-13 (vế giam_doc chuyển sang fix-05; thay bằng GĐ duy nhất đổi `admin` → 409), roles AC-5 (`admin` + CATALOG → `grant_not_held`), contracts*/templates (GĐ thứ hai do GĐ mời).
- Kết quả: xem PROOF trong báo cáo driver (`CI=true pnpm --filter @runway/api test` 60 file / 441 pass, web 358 pass, typecheck + lint sạch).
- Còn mở: admin vẫn khóa được tài khoản GĐ (không lách duyệt 2 lớp — người bị khóa không duyệt; chỉ chặn công việc); GĐ tạo được admin nhưng không sửa/khóa được tài khoản admin (`admin_only` giữ nguyên, kể cả rà soát quý).
