# INTENT-02: Mẫu hợp đồng có phiên bản

Status: Draft
Serves: MAP M4 (nền cho M1 M2) · Roadmap: ROADMAP-01 row 2
Asked by: bạn (chủ dự án) · Written: 2026-09-29

## 1. Problem today
- [PRB-1] Mẫu hợp đồng của công ty (`Hop_Dong_Dich_Vu.docx`) mở đầu bằng "Ghi chú nội bộ (xóa trước khi gửi khách): hợp đồng
  có giảm giá trên 10% cần Giám đốc duyệt…". Chép mẫu nguyên văn vào app → ghi chú nội bộ in ra trên hợp đồng của khách
  (workbook §2c "Importing the owner's template verbatim"). Quy tắc thật nằm trong một câu văn, không nằm ở chỗ máy kiểm được.
- [PRB-2] Sửa mẫu là sửa chữ của cả kho: hợp đồng đã phát hành mà mở lại/in lại theo mẫu mới thì tờ giấy khách đang giữ và tờ
  trong hệ thống khác nhau, không ai biết (quy định 6: "Chứng từ đã gửi khách thì không sửa"; workbook §2c "Rendering from live data").
- [PRB-3] Luồng duyệt viết cứng trong code: muốn đổi ngưỡng 10% hay thêm một bước Giám đốc cho một mẫu là phải nhờ lập trình viên
  (workbook §2c "Approval flow hard-coded").
- [PRB-4] Mẫu cần một thông tin mà app không lưu (ví dụ chức vụ người ký Bên B; nếu mẫu sau này đòi một trường không có cột nào chứa):
  lần tạo đầu tiên "chạy được" nhưng in ô trống, hoặc — như bản dựng thử thực tế — tự điền "Chủ cửa hàng", một sự thật không ai ghi
  (workbook §2c "Filling a missing field with a guess" + "A field the template needs but the app doesn't store").
- [PRB-5] Hôm nay chỉ có 1 file Word, không biết "đang dùng bản nào", ai sửa, sửa gì, khi nào; hợp đồng đã làm không ghi được
  nó làm từ bản nào.

## 2. Outcome — what "better" looks like
- [OUT-1] Mẫu "Hợp đồng cung cấp dịch vụ phần mềm" có trong app, đúng chữ của file Word, KHÔNG còn ghi chú nội bộ; mọi chỗ trống
  `{{...}}` là một trường có tên, có kiểu, bắt buộc hay không, và biết lấy giá trị từ đâu ← PRB-1 PRB-4 · xem: `GET /templates/{id}`
- [OUT-2] Quy tắc duyệt là dữ liệu của mẫu: "Quản lý duyệt luôn; giảm >10% thêm Giám đốc duyệt" đọc được, sửa được bằng phiên bản mới,
  không cần sửa code ← PRB-1 PRB-3 · xem: `approval_policy` trong `GET /templates/{id}`
- [OUT-3] Sửa mẫu = tạo phiên bản mới (v2, v3…); phiên bản cũ giữ nguyên từng chữ mãi mãi để hợp đồng sau này ghim vào đúng một
  phiên bản ← PRB-2 PRB-5 · xem: tạo v2 → `GET` v1 vẫn y hệt
- [OUT-4] Mẫu thiếu/sai bị từ chối lúc nhập, nêu rõ tên trường: chỗ trống không có trường, trường bắt buộc không có nguồn, trường lấy từ
  nơi app không có cột → liệt kê cho bạn thấy TRƯỚC lần tạo hợp đồng đầu tiên, không để ô trống ← PRB-4 · xem: gửi mẫu lỗi → 422 kèm danh sách
- [OUT-5] Cả phòng xem được mẫu và phiên bản; chỉ Giám đốc tạo/sửa mẫu; mỗi lần đổi có dòng nhật ký ← PRB-2 PRB-5 · xem: Nhân viên gửi POST → 403 + `permission.denied`

## 3. Who and what it touches
- People: Giám đốc (viết/nhập mẫu, tạo phiên bản); cả phòng (đọc mẫu để biết cần nhập gì); Quản lý/Giám đốc (bước duyệt do mẫu quy định);
  Nhân viên (bị chặn nếu mẫu đòi trường mà khách chưa có dữ liệu — thấy tên trường thiếu). Row 3 (hợp đồng) là người dùng trực tiếp của dữ liệu này.
- Data: nội dung mẫu (chữ hợp đồng, thông tin công ty Bên A, số tài khoản công ty — dữ liệu doanh nghiệp, không phải dữ liệu cá nhân của khách); quy tắc duyệt.
  Không có tiền tính ở row này (mẫu chỉ khai báo trường tiền; tính ở row 3).

## 4. Out of scope
- Tạo/duyệt/phát hành hợp đồng, tính tiền, đánh số, dựng bản in (row 3) · giao diện soạn mẫu, WYSIWYG (row 4 chỉ hiển thị; workbook: mẫu sửa dạng văn bản có `{{}}`) ·
  các mẫu khác trong mockup (Dịch vụ tư vấn, Thi công lắp đặt, Hợp tác đại lý — chỉ seed 1 mẫu; thêm mẫu = `POST /templates` sau) · xóa/tắt mẫu (xem SPEC-02 DEC-3) ·
  mẫu Báo giá / Đề nghị thanh toán (Parked) · tự chuyển file .docx thành mẫu (chuyển tay một lần, lưu vào seed).

## 5. Open questions (answered before the SPEC)
- [Q-1] Chỉ seed mẫu nào → answer: chỉ "Hợp đồng cung cấp dịch vụ phần mềm" từ `Hop_Dong_Dich_Vu.docx` (IDEA, quyết định đã chốt).
- [Q-2] Ghi chú nội bộ về giảm >10% → answer: bỏ khỏi chữ hợp đồng, thành quy tắc duyệt: Quản lý duyệt luôn, giảm >10% thêm bước Giám đốc (IDEA).
- [Q-3] `so_bao_gia` / `ngay_bao_gia` / `chuc_vu_nguoi_ky` → answer: 2 trường đầu tự nhập, không bắt buộc, trống thì bỏ dòng "Căn cứ"; `chuc_vu_nguoi_ky` bắt buộc, nhập tay (IDEA).
- [Q-4] Ai sửa mẫu → answer: Giám đốc (`template:write`; MAP M4, mockup "🔒 only Giám đốc edits").
- [Q-5] Còn mở (không chặn INTENT, hỏi ở SPEC-02 §6): định dạng chữ mẫu, cách hiển thị bản cũ, ngày bắt đầu hợp đồng, ngày hợp đồng.
