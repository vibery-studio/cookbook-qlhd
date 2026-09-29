# INTENT-01: Nền — vai trò, nhật ký, khách hàng, bảng giá

Status: Approved 2026-09-29
Serves: MAP M5 M6 M7 (+ giá cho M1) · Roadmap: ROADMAP-01 row 1
Asked by: bạn (chủ dự án) · Written: 2026-09-29

## 1. Problem today
- [PRB-1] Không phân biệt Nhân viên / Quản lý / Giám đốc: RUNWAY chỉ có `admin` · `member`; `admin` bỏ qua kiểm tra chủ sở
  hữu (`packages/rbac/src/policy.ts:28`) — dùng làm Giám đốc thì Giám đốc sửa được nháp của người khác.
- [PRB-2] Không ai trả lời được "ai đã làm gì": audit hiện chỉ đẩy ra Logpush, không đọc được trong app; lần bị từ chối
  quyền (403) không để lại dấu vết.
- [PRB-3] Khách hàng nằm rải trong Excel riêng từng người, trùng dòng (04_Quy_Trinh) — hợp đồng cần một khách thật để
  chép thông tin Bên B, không gõ lại.
- [PRB-4] Giá tự gõ, còn giá cũ (G6 2.400.000 → 2.700.000 từ 01/07/2026) — quy định 3: "Giá lấy theo bảng giá đang áp dụng
  vào ngày lập chứng từ. Không tự gõ giá."

## 2. Outcome — what "better" looks like
- [OUT-1] Mỗi người đăng nhập mang đúng 1 trong 3 vai trò với đúng quyền của mockup (Phân quyền); gỡ vai trò có hiệu lực
  ngay, không chờ cache ← PRB-1 · xem: `GET /me` + ma trận quyền
- [OUT-2] Quản lý / Giám đốc đọc được nhật ký trong app, mới nhất trước, gồm cả `permission.denied` ← PRB-2 · xem: `GET /audit`
- [OUT-3] Một danh sách khách chung (tên cửa hàng, người đại diện, MST, SĐT, email, địa chỉ) ← PRB-3 · xem: `GET /customers`
- [OUT-5] Người mới vào được app chỉ khi được mời/thêm; không ai tự đăng ký ← PRB-1 · xem: tạo người → đăng nhập được
- [OUT-4] Hỏi "giá G6 ngày 28/09/2026" → 2.700.000; "ngày 15/06/2026" → 2.400.000 ← PRB-4 · xem: `GET /price-list?date=`

## 3. Who and what it touches
- People: Giám đốc (gán vai trò), Quản lý + Giám đốc (đọc nhật ký), cả phòng (khách, bảng giá). Người rời công ty bị ảnh hưởng: mất quyền ngay.
- Data: dữ liệu cá nhân của khách (SĐT, email, MST, địa chỉ) — chỉ người đăng nhập có quyền xem; tiền (bảng giá, số nguyên đồng); IP trong nhật ký.

## 4. Out of scope
- Mẫu hợp đồng, hợp đồng, số, duyệt (row 2–3) · giao diện (row 4) · nhập 01_DS_Khach.xlsx / pipeline CRM (Parked) · sửa bảng giá trong app.

## 5. Open questions (answered before the SPEC)
- [Q-1] Tài khoản + vai trò → answer: seed 1 tài khoản quản trị đầu tiên; từ đó mời / thêm người vào (không tự đăng ký).
- [Q-2] Vai trò → answer: 3 vai trò mới `giam_doc` · `quan_ly` · `nhan_vien` theo ma trận mockup; `giam_doc` thêm
  `users:read/write`; `admin` giữ cho kỹ thuật, không gán cho người dùng nghiệp vụ.
- [Q-3] Khách hàng → answer: cả 3 vai trò (`contract:write`) thêm và sửa; không xóa.
- [Q-4] Bảng giá → answer: seed 09_Bang_Gia bằng migration, chỉ đọc; đổi giá = migration mới.
