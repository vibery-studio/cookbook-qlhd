# FIX-07: Gửi lại lời mời bỏ qua guard owner_only/admin_only (chiếm tài khoản pending)

Status: Fixed 2026-10-02 (chờ bạn duyệt)

## 1. What happens vs what should
- Steps: GĐ mời `giam_doc`/`admin` (chưa kích hoạt) → admin thường `POST /admin/users/:id/invite` → 200 + `activation_url` → `POST /auth/activate` với mật khẩu của mình → đăng nhập thành tài khoản đặc quyền.
- Actual: chỉ cần `users:write` + user `pending`. Expected: giống mời/đổi vai trò (FIX-03, FIX-05 R3, `docs/rbac.md`): vai trò `giam_doc`/`admin`/có `roles:write` chỉ Giám đốc đụng tới → 403 `owner_only` (`admin_only` nếu người gọi không phải admin cũng không phải GĐ). Nguồn: audit `~/security-audit-skill/tw-hopdong-live/run-1/NEEDS-VALIDATION.md` §1.

## 2. Failing test — before touching the code
- `test/integration/fix-07-reinvite-guards.test.ts` (1) trên code cũ → `AssertionError: expected 200 to be 403` (admin gửi lại lời mời cho `giam_doc` pending).

## 3. Cause
- `reinviteUser` chỉ kiểm `status === 'pending'`; không gọi các luật của `domain/user-assign.ts`. Token kích hoạt không gắn email → ai nhận link là chủ tài khoản.

## 4. Fix + proof
- `domain/user-assign.reinviteRefusal` (hàm thuần): `admin_only` (người gọi không phải admin/GĐ, đích giữ admin) → `root_role` → `owner_only` (đích giữ `giam_doc` hoặc vai trò có `roles:write`, người gọi không phải GĐ). GĐ vẫn gửi lại được cho admin pending (không thì không ai gửi được).
- `reinviteUser`: nạp vai trò đích + `loadAssignContext`, từ chối qua `refuse()` (`permission.denied`), route map `escalationProblem`; WHERE của INSERT token lặp `ownerMayReassignSql` (chỉ phần `giam_doc`; phần vai trò `roles:write` khác chỉ kiểm ở service — bị chặn đua khi GĐ đổi quyền vai trò giữa chừng là rủi ro không đáng kể).
- `GET /admin/users`: `can.reinvite` + `locked_reason.reinvite` từ cùng `reinviteRefusal`; OpenAPI + client sinh lại; web chỉ cập nhật type test.
- Test pass + fix-03/05/06: xem báo cáo.
