# FIX-06: Luật khóa/ẩn trên giao diện do API quyết, không do web tự tính

Status: Fixed 2026-10-02 (chờ bạn duyệt)

## 1. What happens vs what should
- Steps: đăng nhập `admin` → Phân quyền → mở vai trò Quản lý/Nhân viên → ô `contract:issue`, `contract:approve` hiện cho tick (web coi admin có mọi quyền) → gửi → 403 `grant_not_held`. Cùng gốc: Người dùng (`role-locks.ts`), JIT (`jit-rules.ts`), Hợp đồng (`lock-reasons.ts`), menu "+ Tạo" (`creatableTypes`) — web tự viết lại luật của server, lệch là sai.
- Expected (bạn chốt 2026-10-02): "đảm bảo rằng các luật đó được tính từ backend, không phải frontend" — mọi ô mờ / nút 🔒 / lựa chọn ẩn và câu lý do do API tính bằng CHÍNH hàm mà guard ghi dùng; web chỉ hiển thị + đổi mã lý do thành câu tiếng Việt.

### Kiểm kê (apps/web/src)
| Chỗ | Luật | Loại | Xử lý |
|---|---|---|---|
| roles/roles-screen `holds`, role-drawer `cannotGrant`, role-form-modal + `cloneSeed` | grant_not_held (thêm mã mình không có) | (b) | → `GET /roles` `Role.can.grant`, `grantable` |
| users/role-locks `selectableRoles`, `notHeld`, `ownerOnly`, `ownerTargetLocked`, `adminTargetLocked`, `targetRoleLocked`, self locks | self_role, admin_only, owner_only (+bootstrap), root_role, FR-12, tự khóa | (b) | → `GET /admin/users` `can` / `locked_reason` / `role_options` / `invite_roles` |
| users/jit-rules `jitRowAction` | self_grant, already_admin, not_active, jit_active, quyền thu hồi (thiếu jit_actor) | (b) | → `can.grant_jit`/`revoke_jit`, `locked_reason.grant_jit`, `jit_grant` |
| contracts/lock-reasons `lockReason` | lý do khóa (creator, một người một bước, vai trò bước, contract:issue…) | (b) | → `Contract.can.reason` |
| contracts/list-params `creatableTypes` + `WRITE_PERMISSION` | loại → mã quyền tạo; DNTT không tạo lẻ | (b) | → `GET /contracts` `can_create` |
| contracts `can.*`, `can.create_child[].reason_code` | — | (a) | giữ |
| access-review `can` + `locked_reason` | — | (a) | giữ |
| products `product.can` | — | (a) | giữ |
| roles `can.edit/delete/request/direct`, `locked_reason`, `request_locked_reason`; requests `can`/`locked_reason` | — | (a) | giữ (web chỉ ghép cờ API) |
| nav, route-guard, cổng màn theo mã quyền (templates import `template:write`, customers/contract-form `contract:write`, audit `users:read`, security, access-review) | gương `/me.permissions` = cổng route | (a) | giữ |
| contracts `visibleActions(status)` | nút nào có nghĩa theo trạng thái (hiển thị) | (a) | giữ |
| roles `violatedPairs` (SoD) · jit `validReason` (10–500) | kiểm dữ liệu người dùng đang nhập, gương schema/`sodViolations` | (c) | giữ — server vẫn trả 409/422 |

## 2. Failing test — before touching the code
- API `test/integration/fix-06-api-locks.test.ts` (3) + `contracts-4b-acceptance` "FIX-06" (1), chạy trên code cũ (stash `apps/api/src`):
  ```
  FAIL fix-06 > roles: admin lacks contract:issue …   AssertionError: … (undefined and string) is invalid for this assertion
  FAIL fix-06 > users as admin …                       TypeError: Cannot read properties of undefined (reading 'map')
  FAIL fix-06 > users as Giám đốc …                    TypeError: Cannot read properties of undefined (reading 'find')
  FAIL contracts-4b > FIX-06: can.reason …             AssertionError: expected undefined to match object { edit: 'not_creator', …(2) }
  ```
- Web trên code cũ: `roles-screen.test` 2 failed ("greyed boxes come from can.grant, not /me", "clone drops … grantable"); `users-screen.test` 2 failed (hàng GĐ owner_only, ô mời theo `invite_roles`).

## 3. Cause
- Web tự viết lại luật của server (một bản sao thứ hai) từ `/me` — `/me.permissions` là principal cache (có JIT), còn guard đọc D1 `user_roles`; bản sao lệch (admin "có mọi quyền", thiếu `jit_actor`, `root` chọn được, `can.edit` HĐ bỏ quyền ghi theo loại).

## 4. Fix + proof
- API — một bản luật thuần, guard và màn hình cùng gọi:
  - `domain/user-assign.ts`: `assignRefusal` / `editRefusal` (thứ tự guard của `inviteUser`/`updateUser`), `roleOptions`, `changeRoleLock`, `statusLock`, `jitGrantRefusal`, `mayRevokeJit`. `user-admin-service` (`loadAssignContext`, `listUsersFor`) + `jit-service` dùng chúng; SQL trong WHERE (`ownerMayAssignSql`, `notLastActiveAdmin`, CAS JIT) giữ nguyên.
  - `domain/grant.ts`: `grantMissing` (thay 2 bản `missingFrom`), `grantableCodes` → `Role.can.grant`, `RolesResponse.grantable`.
  - `domain/contract/action-locks.ts`: `decideLock` (decide-service), `draftWriteLock` (update/delete), `copyLock` (copy), `createLock` (create), `submitLock`/`withdrawLock`/`issueLock` → `buildCan` = `can.*` + `can.reason.*`; `creatableTypes` → `ContractList.can_create`.
  - `GET /admin/users` → `AdminUsersPage {items: AdminUserItem[], next_cursor, invite_roles}`; mỗi hàng `can{change_role,set_status,reinvite,grant_jit,revoke_jit}`, `locked_reason{change_role,set_status,grant_jit}`, `role_options`, `jit_grant`. Không bao giờ liệt kê `member`/`root`.
  - Đổi hành vi nhìn thấy: `can.edit`/`can.delete`/`can.copy` HĐ giờ xét mã ghi theo loại (khớp guard); hàng chưa kích hoạt: "Khóa" 🔒 `pending` (trước: bấm → 409).
- Web: `role-locks.ts` chỉ còn bảng mã → câu (+ `rowLockNotes`, `firstOpen`); `jit-rules.ts` bỏ `jitRowAction`; `users-screen`/`jit-controls` vẽ từ hàng API; `roles` dùng `can.grant`/`grantable`; `lockReason(action, contract)` đọc `can.reason`; "+ Tạo" đọc `can_create`.
- Đã chốt (A): server chặn tự khóa mình → 403 `self_disable` (chạy trước guard last-admin). AC-4 của SPEC-01 / FIX-03 "tự khóa admin cuối → 409" nay là 403 `self_disable`; admin cuối bị khóa bởi người khác vẫn 409 `last-admin`. Test: `foundation-acceptance` AC-4, `fix-06-api-locks`.
- Kết quả: xem báo cáo PROOF (API full, web, typecheck, lint, openapi drift, build).
