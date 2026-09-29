# INTENT-03: Vòng đời hợp đồng — tạo, duyệt, phát hành có số, hủy + thay thế

Status: Approved 2026-09-29
Serves: MAP M1 M2 M3 M5 · Roadmap: ROADMAP-01 row 3
Asked by: bạn (chủ dự án) · Written: 2026-09-29

## 1. Problem today
- [PRB-1] Giá tự gõ, còn giá cũ: G6 lên 2.700.000 từ 01/07/2026 nhưng hộp hồ sơ còn 4 đơn giá 2.400.000; Quy định 3: "Giá lấy theo
  bảng giá đang áp dụng vào ngày lập chứng từ. Không tự gõ giá." Thành tiền, bằng chữ, ngày kết thúc cũng tính tay (workbook §2c
  "Typing prices by hand", "Trusting the client's total").
- [PRB-2] Thiếu thông tin thì điền đại: bản dựng thử in "Chủ cửa hàng" vào ô chức vụ người ký Bên B — một sự thật không ai ghi
  (workbook §2c "Filling a missing field with a guess"; IDEA: `chuc_vu_nguoi_ky` bắt buộc).
- [PRB-3] Giảm >10% lọt qua không ai duyệt; người tạo tự xác nhận việc của mình (bản dựng thử: sales tự bấm "đã thanh toán" đơn của
  mình). Quy định 2: "Sales được tự giảm tối đa 10%. Hợp đồng giảm trên 10% phải được Giám đốc duyệt trước khi gửi khách."
- [PRB-4] Số hợp đồng nhảy/trùng: mockup cấp số cho cả bản nháp (HD-2026-013, 014) → nháp bị bỏ để lại lỗ; hai người cùng phát hành
  một lúc có thể ra trùng số (workbook §2c "Numbering drafts", §9 "Two-step numbering"). Ghi chú trong mẫu: "Số hợp đồng đánh liên tục trong năm".
- [PRB-5] Sai thì sửa thẳng vào bản đã gửi khách; đổi giá/tên khách/mẫu sau đó thì mở lại hợp đồng cũ thấy nội dung khác tờ khách đang giữ.
  Quy định 6: "Chứng từ đã gửi khách thì không sửa. Sai thì hủy và làm chứng từ mới, số mới."
- [PRB-6] Không biết ai đã làm gì với một hợp đồng, kể cả lần bị chặn; hợp đồng có thể nằm mãi ở "Chờ duyệt" vì bước duyệt không ai
  làm được (Giám đốc duy nhất tạo hợp đồng giảm 15% — workbook §2c "A step nobody can take").

## 2. Outcome — what "better" looks like
- [OUT-1] Nhân viên tạo hợp đồng từ mẫu cho 1 khách: chọn gói + số cửa hàng + giảm giá + chức vụ người ký; app tự lấy giá theo ngày lập,
  tự tính thành tiền, bằng chữ, ngày kết thúc. G6 · 1 cửa hàng · −5% ngày 28/09/2026 → 2.565.000đ, 28/09/2026 → 27/03/2027 ← PRB-1 ·
  xem: `POST /contracts` → bản xem trước
- [OUT-2] Thiếu trường bắt buộc → bị chặn, nêu tên trường ("Chức vụ người ký"), không có hợp đồng nào được tạo ← PRB-2 · xem: 422 kèm danh sách
- [OUT-3] Mọi hợp đồng qua Quản lý duyệt; giảm >10% thêm Giám đốc; không ai tự duyệt hợp đồng của mình, kể cả Giám đốc; bước không ai
  duyệt được thì bị chặn ngay lúc gửi duyệt, nêu tên bước ← PRB-3 PRB-6 · xem: "Chờ tôi duyệt", 403 khi tự duyệt
- [OUT-4] Số chỉ cấp lúc phát hành, liên tục theo năm `HD-2026-001, 002…`; nháp/từ chối không tốn số; 10 người phát hành cùng lúc → 001…010
  không hở không trùng ← PRB-4 · xem: danh sách hợp đồng, probe đua 10 phát hành
- [OUT-5] Hợp đồng đã phát hành không bao giờ đổi (đổi giá, tên khách, mẫu → bản in y hệt); sai thì hủy (giữ số, ghi lý do) + làm hợp đồng
  mới với số mới ← PRB-5 · xem: `GET /contracts/{id}/render` trước/sau
- [OUT-6] Mỗi bước (tạo, gửi, duyệt, từ chối, phát hành, hủy, bị chặn) có đúng 1 dòng nhật ký cùng lúc với thay đổi; xem theo từng hợp đồng
  ← PRB-6 · xem: `GET /contracts/{id}/audit`, dòng thời gian trong hợp đồng

## 3. Who and what it touches
- People: Nhân viên (tạo, sửa nháp của mình, gửi duyệt); Quản lý + Giám đốc (cũng tạo được; duyệt/từ chối hợp đồng người khác, phát hành,
  hủy); người đọc nhật ký (Quản lý, Giám đốc). Khách hàng bị ảnh hưởng mà không dùng app: tờ hợp đồng họ giữ.
- Data: tiền (giá, giảm, tổng — số nguyên đồng, đã gồm VAT); dữ liệu cá nhân của khách chép vào hợp đồng (tên người đại diện, SĐT, email,
  MST, địa chỉ); số hợp đồng (công khai trên giấy).

## 4. Out of scope
- Giao diện web (row 4) · báo giá, đề nghị thanh toán, hợp đồng lập từ báo giá (Parked) · gửi hợp đồng qua email/Zalo, chữ ký điện tử,
  xuất PDF phía server (in bằng trình duyệt) · phụ lục/sửa đổi hợp đồng · xác nhận đã thanh toán · quy định 5 "mỗi cửa hàng chỉ dùng thử một
  lần" (cần dữ liệu cửa hàng) · soạn/sửa mẫu (row 2).

## 5. Open questions (answered before the SPEC)
- [Q-1] Ngưỡng và bước duyệt → answer: luôn Quản lý duyệt; giảm >10% thêm Giám đốc (IDEA). 10% đúng → chỉ Quản lý (Quy định 2 "tối đa 10%").
- [Q-2] Tính tiền → answer: giá gói (theo ngày lập) × số cửa hàng − giảm giá, half-up tới đồng, đã gồm VAT (IDEA).
- [Q-3] Từ chối → answer: kết thúc + "chép sang nháp mới" (IDEA).
- [Q-4] → answer (2026-09-29, SPEC-03 §6): Quản lý + Giám đốc phát hành; người tạo được phát hành hợp đồng của mình sau khi người khác duyệt; ngày hợp đồng = ngày lập, ngày bắt đầu mặc định = ngày lập; DT14 không làm hợp đồng. Thêm: mỗi bước duyệt một người khác nhau.
