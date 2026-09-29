# INTENT-04b: Giao diện hợp đồng — Hợp đồng · Mẫu hợp đồng · Chờ tôi duyệt · bản in

Status: Approved 2026-09-30
Serves: MAP M1 M2 M3 M4 · Roadmap: ROADMAP-01 row 4b
Asked by: bạn (chủ dự án) · Written: 2026-09-30

## 1. Problem today
- [PRB-1] Vòng đời hợp đồng (row 3) chỉ chạy qua `/docs`: Nhân viên không tạo được hợp đồng, người duyệt không thấy việc chờ mình, không ai xem được "tờ giấy".
- [PRB-2] Mẫu hợp đồng (row 2) chỉ là JSON: không thấy trường bắt buộc, điều khoản, các bước duyệt trước khi tạo.
- [PRB-3] Lỗi nghiệp vụ (thiếu trường, tự duyệt, không có người duyệt đủ điều kiện, bị sửa trước, đã khóa) hiện ra mã/JSON, không phải câu người dùng hiểu kèm việc làm tiếp.
- [PRB-4] Không có cách nhìn "hợp đồng này đang ở bước nào, ai đã làm gì" cho một hợp đồng.

## 2. Outcome — what "better" looks like
- [OUT-1] Hợp đồng: bảng (Mã · Hợp đồng · Khách hàng · Giá trị · Trạng thái · Người tạo · Cập nhật) + tab trạng thái có đếm; nháp hiện "Nháp · chưa có số" ← PRB-1 · xem: `/hop-dong`
- [OUT-2] Tạo hợp đồng: chọn mẫu → khách → giá trị; trường bắt buộc đánh dấu; thiếu trường → câu tiếng Việt nêu tên trường, không tạo gì ← PRB-1 PRB-3 · xem: "+ Tạo hợp đồng"
- [OUT-3] Ngăn chi tiết (drawer 560px): thông tin, dòng hàng + tổng, dòng thời gian duyệt (bước hiện tại nổi bật), nhật ký của hợp đồng; nút theo quyền — không được làm thì 🔒 + lý do, không bao giờ là nút chết ← PRB-3 PRB-4 · xem: bấm một dòng
- [OUT-4] Hành động: sửa nháp · gửi duyệt · duyệt / từ chối (lý do) · phát hành · hủy (lý do) · tạo bản thay thế — mỗi lỗi 403/409/422 thành câu tiếng Việt ← PRB-3 · xem: đi hết vòng đời bằng 3 vai trò
- [OUT-5] Bản in: "tờ giấy" tiếng Việt (CỘNG HÒA…, Bên A/B, Điều 1–3, chữ ký); nháp có dấu "NHÁP"; đã phát hành = bản lưu, in được bằng trình duyệt ← PRB-1 · xem: "Xem văn bản hợp đồng"
- [OUT-6] Mẫu hợp đồng: thẻ mẫu (trường dạng chip, các bước duyệt); chi tiết: trường có dấu *bắt buộc*, dòng hàng mặc định, điều khoản, bước duyệt; "Tạo hợp đồng từ mẫu này →" ← PRB-2 · xem: `/mau-hop-dong`
- [OUT-7] Chờ tôi duyệt: hàng đợi của người đang đăng nhập, mỗi mục mở hợp đồng ← PRB-1 · xem: `/cho-toi-duyet` bằng Quản lý / Giám đốc
- [OUT-8] E2E: 1 spec desktop (hết vòng đời, 3 vai trò, có 1 bước vào app khi chưa đăng nhập) + 1 spec mobile 390px ← mọi PRB · xem: PROOF log

## 3. Who and what it touches
- People: Nhân viên (tạo, sửa nháp, gửi) · Quản lý (+ duyệt bước QL, phát hành, hủy) · Giám đốc (+ duyệt bước GĐ; mẫu chỉ xem — Q-1) · admin không thấy màn hợp đồng (không có `contract:*`).
- Data: snapshot hợp đồng chứa thông tin khách (tên, SĐT, MST, địa chỉ) — chỉ người có `contract:read`; không lưu gì ở trình duyệt.

## 4. Out of scope
- Báo giá / Đề nghị thanh toán, gửi email khi phát hành, nhập Excel, MCP (Parked).
- Xuất PDF phía máy chủ (in bằng trình duyệt). Chữ ký số. Trình sửa mẫu (Q-1 → Parked).

## 5. Open questions (answered before the SPEC is approved)
- [Q-1] Màn Mẫu hợp đồng: chỉ xem, hay Giám đốc sửa được (tạo phiên bản mới: trường, điều khoản, bước duyệt)? Khuyến nghị: **chỉ xem** trong 4b — trình sửa mẫu (trường + chính sách duyệt) là một màn lớn, rủi ro sai quy tắc duyệt; API đã có, sửa qua `/docs` khi cần; đưa vào Parked. → answer: **chỉ xem** (bạn chốt 2026-09-30)
- [Q-2] Thẻ khách hàng có "số hợp đồng + tổng giá trị" (DESIGN.md) — cần thêm vào API `GET /customers`. Làm trong 4b? Khuyến nghị: **có** — DESIGN đã chốt, chỉ đếm hợp đồng đã phát hành (không tính nháp/hủy). → answer: **có, chỉ tính đã phát hành** (bạn chốt 2026-09-30)
- [Q-3] Sửa luôn các nit giao diện 4a (tiêu đề lặp, nhãn quyền nền RUNWAY, highlight sidebar) trong 4b? Khuyến nghị: **có** — cùng khung, nhỏ, trước khi làm thêm màn. → answer: **có** (bạn chốt 2026-09-30)
