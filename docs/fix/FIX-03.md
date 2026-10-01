# FIX-03: Giám đốc tự nâng mình thành `admin` qua màn Người dùng

Status: Fixed 2026-10-01

## 1. What happens vs what should
- Steps: đăng nhập Giám đốc (`giam_doc` có `users:write`) → `PATCH /admin/users/{id của mình} {"role":"admin"}` (hoặc gán `admin` cho người khác).
- Actual: 200 — Giám đốc thành `admin`, có `settings:*`/`flags:*`. `updateUser` không so actor với target, không hạn chế ai gán `admin`.
- Expected: tự đổi vai trò của mình → 403 `forbidden` `rule:"self_role"`; người không phải admin gán `admin` (đổi hoặc mời) → 403 `forbidden` `rule:"admin_only"`; mỗi 403 ghi 1 dòng `permission.denied` — agreed where: SPEC-06 DEC-5 A, §3.2 (dòng `/admin/users`), AC-7.
- Mở rộng (bạn chốt 2026-10-01, khe 1): **mọi** PATCH lên người đang mang `admin` (vai trò, khóa/mở khóa, đổi tên) bởi người không phải admin → 403 `admin_only`. Gộp cả đổi tên cho đơn giản: tài khoản quản trị chỉ admin sửa.
- Thay đổi hành vi đã duyệt (bạn chốt): SPEC-01 AC-4 "admin cuối cùng tự đổi vai trò → 409 last-admin" nay là **403 `self_role`** (luật tự-đổi chạy trước guard last-admin). Tự khóa admin cuối cùng và hạ admin cuối qua người khác vẫn 409 `last-admin`. Tự khóa / tự đổi tên giữ nguyên như cũ (không mở rộng phạm vi).

## 2. Failing test — before touching the code
- `apps/api/test/integration/fix-03-role-escalation.test.ts` (3 test) → đỏ trên code cũ:
  ```
  FAIL … > Giám đốc cannot make themselves admin → 403 self_role, one permission.denied row, role unchanged
  AssertionError: expected 200 to be 403 // Object.is equality
  FAIL … > Giám đốc cannot assign admin to someone else → 403 admin_only; other role changes still work
  AssertionError: expected 200 to be 403 // Object.is equality
  FAIL … > admin may assign admin to another user, but not change their own role (self_role, not last-admin)
  AssertionError: expected 200 to be 403 // Object.is equality
   Test Files  1 failed (1)
        Tests  3 failed (3)
  ```
- Mở rộng, test thứ 4 cùng file, đỏ trước khi sửa (3 test cũ đã xanh):
  ```
  FAIL … > Giám đốc cannot demote, disable or rename another admin → 403 admin_only each, one row each, nothing changes
  AssertionError: expected 200 to be 403 // Object.is equality
   Test Files  1 failed (1)
        Tests  1 failed | 3 passed (4)
  ```

## 3. Cause
- `updateUser` (`apps/api/src/services/user-admin-service.ts`) chỉ có guard last-admin; `requirePerm("users:write")` là cổng duy nhất, nên ai có `users:write` gán được mọi vai trò cho mọi người, kể cả chính mình và `admin`.

## 4. Fix + proof
- API (server là guard): `updateUser` — đầu tiên: người bị sửa mang `admin` mà actor không mang `admin` → `admin_only` (với mọi trường, kể cả no-op). Sau đó, khi có đổi vai trò: actor = target → `self_role`; vai trò mới `admin` mà actor không mang `admin` (đọc D1, không từ cache) → `admin_only`. `inviteUser` — `role:"admin"` bởi người không phải admin → `admin_only` (hôm nay schema mời đã 422 `admin`; guard để sẵn cho SPEC-06 đổi `role` thành string). Mỗi lần từ chối ghi 1 `permission.denied` (`target user:<id>` / `user:new`, metadata `{rule, permission:"users:write", role}`, ip) trước khi trả 403, không đổi gì khác. Route trả Problem `forbidden` + `rule` + `detail` tiếng Việt; mô tả 403 trong OpenAPI cập nhật → `pnpm openapi:export && pnpm client:generate` (chỉ đổi mô tả).
- Web (tiện dụng): `users-screen.tsx` — hàng của người mang `admin`, khi mình không phải admin: "🔒 Đổi vai trò" + "🔒 Khóa/Mở khóa" + lý do "🔒 Chỉ quản trị hệ thống sửa được tài khoản quản trị" (`adminTargetLocked`). Hàng của chính mình: "🔒 Đổi vai trò" (aria-disabled) + lý do "🔒 Không tự đổi vai trò của mình"; "🔒 Khóa" + "Không tự khóa tài khoản của mình" (giữ hành vi cũ, tách câu); hộp Đổi vai trò chỉ liệt kê `admin` khi người dùng hiện tại là admin (`role-locks.ts` `assignableRoles`). `problem-messages.ts` thêm câu cho `self_role` / `admin_only`.
- Test đổi: `foundation-acceptance.test.ts` AC-4 — phần tự đổi vai trò kỳ vọng 403 `rule:"self_role"` thay vì 409.
- Kết quả:
  ```
  CI=true pnpm --filter @runway/api exec vitest run test/integration/fix-03-role-escalation.test.ts
   Test Files  1 passed (1)   Tests  4 passed (4)
  CI=true pnpm --filter @runway/api exec vitest run test/integration/foundation-acceptance.test.ts
   Test Files  1 passed (1)   Tests  10 passed (10)
  CI=true pnpm --filter @runway/api exec vitest run test/integration/rbac-flow.test.ts
   Test Files  1 passed (1)   Tests  6 passed (6)
  pnpm --filter @runway/web exec vitest run src/features/users src/lib
   Test Files  6 passed (6)   Tests  73 passed (73)
  pnpm typecheck → Tasks: 7 successful, 7 total
  pnpm lint      → Tasks: 2 successful, 2 total
  ```
- Chấp nhận (bạn chốt): `admin_only` đọc vai trò actor từ D1 trong cùng request rồi mới ghi (không nằm trong WHERE) — chỉ lọt nếu actor bị gỡ `admin` đúng trong khoảng mili-giây đó.
- Ngoài phạm vi: `POST /admin/users/{id}/invite` (tạo lại link) không có luật `admin_only`.
