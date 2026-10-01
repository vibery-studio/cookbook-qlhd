# INTENT-05: Xuất PDF tài liệu đã phát hành

Status: Approved 2026-10-01
Serves: MAP M3 · Roadmap: ROADMAP-02 row 1
Asked by: bạn (phiên feedback 2026-10-01) · Written: 2026-10-01

## 1. Problem today
- [PRB-1] Muốn gửi hợp đồng cho khách (Zalo/email) phải mở bản in → hộp thoại in → "Lưu thành PDF" → tự đặt tên file: nhiều bước, người mới không biết.
- [PRB-2] Bản PDF từ trình duyệt khác nhau theo máy/trình duyệt: lề, ngắt trang, header/footer (URL, ngày giờ) của trình duyệt, font.
- [PRB-3] Không có file PDF chuẩn nào được lưu: mỗi lần tải là một bản tự tạo; sau này gửi email tự động (Parked) không có file để đính kèm.

## 2. Outcome — what "better" looks like
- [OUT-1] Một nút "Tải PDF" trên tài liệu đã phát hành → tải ngay file tên theo số (`HD-2026-001.pdf`) ← PRB-1 · xem: ngăn chi tiết + bản in
- [OUT-2] PDF A4 ổn định: cùng nội dung bản in đã đóng băng, tiếng Việt đủ dấu, không header/footer trình duyệt, ai tải ở máy nào cũng y hệt từng byte ← PRB-2 · xem: mở file trên 2 máy khác nhau
- [OUT-3] PDF tạo một lần khi phát hành và được lưu; lỗi tạo PDF không bao giờ chặn/hoàn tác việc phát hành — tự thử lại, trong lúc chờ vẫn in được bằng trình duyệt ← PRB-3 · xem: tài liệu đã phát hành có trạng thái PDF
- [OUT-4] Ai tải PDF đều có quyền đọc tài liệu đó; mỗi lần tạo PDF ghi nhật ký ← PRB-3 · xem: Nhật ký

## 3. Who and what it touches
- People: Nhân viên · Quản lý · Giám đốc (ai có `contract:read`) tải; người phát hành không phải làm thêm gì.
- Data: file PDF chứa thông tin khách (tên, SĐT, MST, địa chỉ) và giá trị hợp đồng → dữ liệu cá nhân + tiền; chỉ người có quyền đọc, không đường dẫn công khai.

## 4. Out of scope
- PDF cho nháp / chờ duyệt (chưa đóng băng — vẫn xem bản in có dấu "NHÁP").
- Gửi email kèm PDF (Parked), chữ ký số, file `.docx` có thể sửa.

## 5. Open questions (answered before the SPEC)
- [Q-1] Tạo PDF bằng gì? (load-bearing: thêm hạ tầng Cloudflare — bạn tạo khi deploy)
  - A. **Cloudflare Browser Rendering** (Chrome headless qua binding) in `rendered_html` đã lưu → PDF, lưu vào **R2**; tạo qua Queue sau khi phát hành (thử lại tự động). Đẹp đúng bản in, ít code nhất. Cần: bật Browser Rendering + tạo 1 bucket R2 (bạn làm, `docs/deploy.md`); có giới hạn phút/ngày theo gói.
  - B. Thư viện JS dựng PDF trong Worker (pdf-lib/pdfmake): không dịch vụ ngoài, nhưng phải vẽ lại bố cục tờ giấy bằng code + nhúng font tiếng Việt; dễ lệch bản in, mỗi mẫu mới (row 3–4) phải vẽ lại.
  - C. Tạo PDF ở trình duyệt (html2pdf): 1 nút, không hạ tầng, nhưng không đạt OUT-2 (khác theo máy) và OUT-3 (không lưu).
  - Khuyến nghị: **A** — chỉ A đạt cả OUT-1/2/3, và tự đúng cho mọi mẫu/loại tài liệu sau này. → answer: **A** (bạn chốt 2026-10-01)
- [Q-2] Tài liệu đã hủy: vẫn tải PDF gốc (bản đã gửi khách)? Khuyến nghị: **có, file gốc không đổi**; trạng thái "Đã hủy" hiện trên app, không đóng dấu vào file. → answer: **có, file gốc** (bạn chốt 2026-10-01)
