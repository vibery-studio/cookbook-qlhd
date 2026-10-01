# FIX-08: `POST /me/export` đưa `users.password_hash` vào archive

Status: Fixed 2026-10-02 (chờ bạn duyệt)

## 1. What happens vs what should
- Steps: đăng nhập → `POST /me/export` chỉ với cookie phiên → `archive.tables.users[0].password_hash` (scrypt) nằm trong phản hồi.
- Actual: hash mật khẩu có trong archive · Expected: credential không bao giờ vào archive — agreed where: `data-inventory.ts` ("security tokens — never in an archive"); phát hiện từ audit `NEEDS-VALIDATION.md` §2.

## 2. Failing test — before touching the code
- `privacy-flow > POST /me/export > FIX-08: archive carries no credential columns` → fails: `expected '{"schema_version":1,…"users":[{…"password_hash":"scrypt$1024$8$1$…` not to contain 'password_hash'`.
- Test cũng quét cột mọi bảng `exportable` (qua `pragma_table_info`) tìm tên giống credential (`password|secret|token|salt|pepper|api_key`): chỉ có `users.password_hash`; `snapshot_hash_at_decision` là hash nội dung, không phải credential.

## 3. Cause
- `selectByOwner` chạy `SELECT *`; inventory loại bảng token nhưng không có quy tắc loại cột cho `users`.

## 4. Fix + proof
- `DataInventoryEntry.excludeColumns?`; entry `users` = `["password_hash"]`. `selectByOwner` lấy cột bảng (`pragma_table_info`) trừ denylist rồi SELECT danh sách cột tường minh (hash không bị đọc ra); `quoteIdent` giữ nguyên.
- Không thêm hỏi lại mật khẩu cho `/me/export` (chưa quyết).
- Còn mở (ngoài phạm vi): đổi mật khẩu/email có cần mật khẩu cũ không.
