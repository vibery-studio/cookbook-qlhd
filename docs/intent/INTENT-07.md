# INTENT-07: Kiểm soát RBAC nâng cao — SoD · four-eyes · rà soát định kỳ · admin JIT

Status: Approved 2026-10-01
Serves: MAP M7 M5 · Roadmap: ROADMAP-02 row 2b
Asked by: bạn (bộ quy tắc RBAC gửi 2026-10-01) · Written: 2026-10-01

## 1. Problem today
- [PRB-1] Một người có thể được gán hai vai trò kiểm soát chéo nhau (vd. người lập và người duyệt chi) — không có gì chặn ở cấp vai trò.
- [PRB-2] Một người quản trị đổi quyền của cả một vai trò là có hiệu lực ngay, không ai thứ hai xem lại.
- [PRB-3] Không có lúc nào ai xác nhận lại "ai đang mang vai trò gì"; người nghỉ việc/đổi vị trí có thể giữ quyền.
- [PRB-4] Vai trò admin là quyền thường trực; không có cấp tạm thời có lý do + hết hạn.

## 2. Outcome — what "better" looks like
- [OUT-1] Khai báo cặp vai trò xung đột; hệ thống từ chối gán vai trò thứ hai cho cùng một người ← PRB-1
- [OUT-2] Đổi quyền vai trò thành một yêu cầu chờ người thứ hai duyệt; chỉ có hiệu lực sau khi duyệt ← PRB-2
- [OUT-3] Định kỳ có danh sách rà soát người × vai trò; người phụ trách xác nhận hoặc gỡ; quá hạn thì nhắc ← PRB-3
- [OUT-4] Cấp admin tạm thời: nhập lý do + thời hạn, tự thu hồi khi hết hạn, đều có nhật ký ← PRB-4

## 3. Who and what it touches
- People: Giám đốc, admin (quản trị) · mọi người (bị rà soát).
- Data: vai trò, gán vai trò, yêu cầu đổi quyền, đợt rà soát; nhật ký.

## 4. Out of scope
- Dynamic SoD theo phiên (mỗi người một vai trò trên giao diện nên SoD theo bản ghi đã có ở hợp đồng: không tự duyệt, mỗi bước một người).
- Kế thừa vai trò (hierarchy).

## 5. Open questions (answered before the SPEC)
- [Q-1] Four-eyes khi chỉ có một Giám đốc + một admin: ai duyệt yêu cầu đổi quyền? → answer: **người khác có `roles:write`** (GĐ đề xuất → admin duyệt và ngược lại; không tự duyệt; yêu cầu hết hạn sau 7 ngày) (bạn chốt 2026-10-01)
- [Q-2] Rà soát định kỳ: chu kỳ và ai rà soát? → answer: **hàng quý, Giám đốc rà**; xác nhận hoặc gỡ từng dòng; quá 15 ngày chưa xong → nhắc trên app (bạn chốt)
- [Q-3] JIT admin: ai được xin, ai duyệt, thời hạn tối đa? → answer: **Giám đốc cấp cho người khác, lý do + thời hạn ≤ 8 giờ, tự thu hồi**; giữ 1 admin kỹ thuật thường trực (bạn chốt)
- [Q-4] Cặp xung đột: khai báo trên giao diện hay cố định trong code? → answer: **trên giao diện Phân quyền** (người có `roles:write`); khai báo khi đã có người mang cả hai → chặn + liệt kê (bạn chốt)

