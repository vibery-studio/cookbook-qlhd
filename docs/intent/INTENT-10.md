# INTENT-10: Nhập mẫu từ Word (.docx) — tải file lên, đặt nhãn/kiểu/bắt buộc cho từng trường, lưu thành mẫu hoặc phiên bản mới

Status: Approved 2026-10-01 (driver chốt theo pattern bạn ủy quyền)
Serves: MAP M4 (Giám đốc quản lý mẫu có phiên bản; sửa mẫu không đổi tài liệu đã có) · Roadmap: ROADMAP-02 row 5 (thay "trình sửa mẫu" đang Parked của ROADMAP-01)
Asked by: bạn (phiên feedback 2026-10-01) · Written: 2026-10-01
Chạy song song row 4 (INTENT-09 / SPEC-09): chỉ dựa vào row 4 ở một chỗ — "mẫu thuộc một loại tài liệu" (xem Q-3).

## 1. Problem today
- [PRB-1] Mẫu của công ty nằm sẵn trong Word (`07_Mau_Tai_Lieu/Bao_Gia.docx`, `Hop_Dong_Dich_Vu.docx`, `De_Nghi_Thanh_Toan.docx`, đã có `{{placeholder}}`), nhưng đưa vào app phải nhờ lập trình viên viết lại thành HTML + khai báo trường trong migration (như `0013`, `0023`). Giám đốc không tự thêm hay sửa mẫu được.
- [PRB-2] Muốn đổi câu chữ một mẫu đang dùng (vd. thêm điều khoản), Giám đốc sửa trong Word quen tay, rồi lại phải chờ người chuyển tay sang app. Chuyển tay dễ sót trường hoặc gõ sai tên trường; lỗi chỉ lộ ra lúc lập tài liệu.
- [PRB-3] File Word gốc có thứ không được lên giấy gửi khách: "Ghi chú nội bộ (xóa trước khi gửi khách)…" ở đầu `Hop_Dong_Dich_Vu.docx` (workbook §2c). File cũng có thể chứa thứ app không in được (ảnh, đầu/chân trang, macro).

## 2. Outcome
- [OUT-1] Giám đốc tải một file `.docx` lên và thấy ngay bản xem trước kèm danh sách đủ các trường `{{…}}` có trong file (mỗi trường một dòng, có số lần xuất hiện), không cần ai viết code ← PRB-1 · nhìn ở: màn "Mẫu hợp đồng" → "Nhập từ Word"
- [OUT-2] Mỗi trường được Giám đốc đặt nhãn, kiểu, bắt buộc và nguồn dữ liệu, có gợi ý điền sẵn từ mẫu đang có. Lưu xong là có **mẫu mới** hoặc **phiên bản mới** của một mẫu; tài liệu đã phát hành không đổi, nháp vẫn giữ phiên bản cũ ← PRB-1, PRB-2 · nhìn ở: chi tiết mẫu (phiên bản), tạo tài liệu từ mẫu đó
- [OUT-3] Lỗi được báo **trước khi lưu**, bằng tiếng Việt, nêu tên trường: tên trường sai, `{{` thiếu `}}`, trường bắt buộc chưa có nguồn. Ghi chú nội bộ bị bỏ khỏi chữ mẫu, có liệt kê cho Giám đốc thấy. Phần không in được (ảnh, đầu/chân trang…) được báo rõ là đã bỏ ← PRB-2, PRB-3
- [OUT-4] Done-check của roadmap: tải `Bao_Gia.docx` → thấy đủ trường `{{…}}` → lưu → tạo được tài liệu từ mẫu đó ← PRB-1

## 3. Who and what it touches
- People: Giám đốc (người có `template:write` hôm nay) nhập mẫu · Nhân viên lập tài liệu từ mẫu nhập (không đổi cách làm) · Quản lý/Nhân viên chỉ xem mẫu.
- Data: `templates` + `template_versions` (append-only, đường ghi hiện có) · file `.docx` chỉ đọc trong bộ nhớ lúc xem trước, **không lưu** · không có dữ liệu cá nhân (mẫu chỉ chứa chỗ trống) · không đụng tiền.

## 4. Out of scope
- Trình soạn mẫu WYSIWYG / sửa chữ mẫu trong app (workbook §1 out of scope) — sửa trong Word rồi nhập lại thành phiên bản mới.
- Sửa quy trình duyệt (`approval_policy`) trong app: phiên bản mới chép quy trình của phiên bản hiện tại; mẫu mới nhận quy trình mặc định theo box. Màn sửa quy trình thì để sau.
- Giữ nguyên định dạng Word (font, màu, cỡ chữ, ảnh/logo, đầu/chân trang, đánh số tự động kiểu Word). Bản in vẫn dùng khuôn A4 hiện có.
- Xuất ngược ra `.docx` hoặc điền vào file Word gốc. Lưu file gốc để tải lại.
- Vòng lặp tổng quát `{{#each}}` — chỉ có bảng dòng hàng `{{bang_hang}}` (SPEC-08 DEC-7).
- Định nghĩa loại tài liệu (BG/HD/DNTT/PXK), tiền tố, dãy số → row 4.

## 5. Open questions (đã trả lời — driver chốt theo pattern bạn ủy quyền)
- [Q-1] Ai được nhập mẫu? → answer: **người có `template:write` hôm nay (Giám đốc)**, không thêm mã quyền mới.
- [Q-2] Nhập mẫu có được tạo tài liệu phát hành thật không, hay chỉ là nháp mẫu? → answer: **lưu là thành phiên bản thật** của mẫu, qua đúng đường `POST /templates` · `POST /templates/{id}/versions` và `checkTemplate` hiện có, không có "mẫu nháp" riêng.
- [Q-3] Mẫu thuộc loại nào khi row 4 chưa xong? → answer: dùng **khóa loại của row 4 trên `templates.type`**. Trước khi row 4 xong, loại tạm là `contract` (= HD), mẫu nhập vẫn tạo được hợp đồng. Khi row 4 xong, Giám đốc chọn loại BG/HD/DNTT/PXK lúc nhập.
- [Q-4] Ghi chú nội bộ trong file? → answer: **tự bỏ khỏi chữ mẫu và liệt kê ra** (workbook §2c), không chặn.
