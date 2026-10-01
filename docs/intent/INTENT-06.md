# INTENT-06: Quản lý vai trò — sửa quyền, thêm vai trò, clone vai trò

Status: Approved 2026-10-01
Serves: MAP M7 (+ M5 nhật ký) · Roadmap: ROADMAP-02 row 2
Asked by: bạn (2026-10-01: "Phân quyền không edit được") · Written: 2026-10-01

## 1. Problem today
- [PRB-1] Ma trận vai trò × quyền chỉ đọc; muốn đổi quyền của một vai trò phải viết migration (dev), chủ doanh nghiệp không tự làm được.
- [PRB-2] Chỉ có 3 vai trò cố định (+ admin); người làm việc khác (vd. Kế toán chỉ xem hợp đồng đã phát hành) phải nhận một vai trò rộng hơn cần thiết.
- [PRB-3] Loại tài liệu mới (row 4) sẽ thêm quyền mới; không có chỗ gán các quyền đó cho vai trò.

## 2. Outcome — what "better" looks like
- [OUT-1] Người có quyền quản trị vai trò bật/tắt từng quyền của một vai trò trên màn Phân quyền; người mang vai trò đó thấy quyền mới ở lần tải tiếp theo (không phải đăng xuất) ← PRB-1 · xem: `/phan-quyen`
- [OUT-2] Thêm vai trò mới (tên, mô tả) hoặc clone một vai trò có sẵn rồi chỉnh; gán cho người ở màn Người dùng ← PRB-2 PRB-3
- [OUT-3] Mọi thay đổi vai trò/quyền có dòng nhật ký (ai, vai trò nào, quyền nào bật/tắt) ← M5
- [OUT-4] Không ai làm hệ thống mất quản trị: không tắt được quyền quản trị cuối cùng, không xóa vai trò đang có người dùng ← an toàn

## 3. Who and what it touches
- People: người quản trị vai trò (Q-1) · mọi người dùng bị ảnh hưởng gián tiếp (quyền của họ đổi).
- Data: `roles`, `role_permissions`, `user_roles`, cache phiên (principal trong KV); không dữ liệu cá nhân mới.

## 4. Out of scope
- Quyền theo từng bản ghi (chỉ xem hợp đồng của mình…), quyền theo phòng ban/chi nhánh.
- Tạo mã quyền mới trên giao diện (mã quyền do code định nghĩa; giao diện chỉ gán).

## 5. Open questions (answered before the SPEC)
- [Q-1] Ai được quản lý vai trò? → answer: **Giám đốc + admin** (quyền mới `roles:write`) (bạn chốt 2026-10-01)
- [Q-2] Vai trò mới có được dùng trong bước duyệt không (bước duyệt hiện gắn cứng `quan_ly`/`giam_doc`)? → answer: **không** — duyệt theo quyền; bước gắn vai trò (`giam_doc`) giữ nguyên; luật duyệt không đổi (bạn chốt)
- [Q-3] Chống tự nâng quyền: người quản trị có được sửa vai trò của chính mình / gán quyền mà mình không có? → answer: **không sửa vai trò mình đang mang, không gán quyền mình không có; vai trò admin khóa đủ quyền quản trị** (bạn chốt)
- [Q-4] Xóa vai trò: cho xóa khi không còn ai dùng, hay chỉ "ngừng dùng"? → answer: **xóa khi không còn ai mang; 3 vai trò gốc + admin không xóa được; nhật ký giữ tên** (bạn chốt)
