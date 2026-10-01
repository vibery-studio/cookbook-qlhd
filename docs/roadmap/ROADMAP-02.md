# ROADMAP-02: nhiều loại tài liệu, sản phẩm có giá, mẫu nhập từ Word, xuất PDF

Status: Active 2026-10-01
Goal: trong app đang chạy, phòng Kinh doanh quản lý sản phẩm + giá, chọn sản phẩm vào tài liệu; lập Hợp đồng · Báo giá ·
Đề nghị thanh toán (+ loại mới khi có mẫu) theo cùng vòng đời duyệt/phát hành; Giám đốc tải `.docx` lên thành mẫu mới;
tài liệu đã phát hành tải về được dạng file PDF.
Drafted from: phiên feedback 2026-10-01 (4 yêu cầu) · Parked ROADMAP-01 (BG + DNTT, trình sửa mẫu) · MAP M1 M3 M4.

## Rows (in order)
| # | Feature | Serves (MAP line) | Why here — needs / priority | Done when | Status |
|---|---|---|---|---|---|
| 1 | Xuất PDF tài liệu đã phát hành (tải file `HD-2026-001.pdf`, từ bản in đã đóng băng) | M3 | needs: không có · độc lập, nhỏ nhất, dùng ngay | bấm "Tải PDF" trên hợp đồng đã phát hành → file PDF đúng nội dung bản in, tiếng Việt đủ dấu | done 2026-10-01 (tạo khi bấm) |
| 2a | Quản lý vai trò: sửa ma trận vai trò × quyền, thêm/clone/xóa vai trò; gán vai trò theo quyền ⊇; nhật ký bất biến (thêm 2026-10-01, bạn đặt) | M7 (+ M5 nhật ký) | needs: không có · quyền truy cập → feature đầy đủ; trước #4 vì loại tài liệu mới sinh quyền mới | Giám đốc/admin clone "Nhân viên" → "Kế toán", bật/tắt quyền, gán cho người; người đó đăng nhập lại thấy đúng quyền; mỗi thay đổi có dòng nhật ký; không tự khóa mình khỏi quản trị | todo |
| 2b | Kiểm soát RBAC nâng cao (bộ quy tắc bạn gửi 2026-10-01): cặp vai trò xung đột (Static SoD) · đổi quyền cần người thứ hai duyệt (four-eyes) · rà soát định kỳ người × vai trò · admin tạm thời có hạn giờ + lý do (JIT) | M7 M5 | needs: #2a · làm song song với #3 được | mỗi quy tắc có AC riêng ở SPEC-07; đổi quyền vai trò chờ duyệt người thứ hai; admin JIT tự thu hồi | todo |
| 3 | Quản lý sản phẩm & giá: thêm/sửa sản phẩm, giá có hiệu lực theo ngày (không sửa giá cũ); chọn sản phẩm vào dòng hàng tài liệu | M1 (+ MAP mới: M8) | needs: không có · tiền → feature đầy đủ; dòng 4 cần (báo giá, phiếu xuất kho dùng dòng hàng) | Quản lý thêm sản phẩm + giá mới từ ngày X; tạo hợp đồng chọn sản phẩm, giá đúng theo ngày lập; tài liệu cũ không đổi | todo |
| 4 | Nhiều loại tài liệu: tổng quát `contract` → loại có tiền tố + dãy số riêng (HD · BG · DNTT; PXK = phiếu xuất kho, mình soạn theo mẫu chuẩn kế toán 02-VT để làm ví dụ loại mới); tài liệu con từ tài liệu cha (BG → HD → DNTT) | M1–M3 (+ MAP mới: M9) | needs: #3 · #2 (gán quyền loại mới) · đổi mô hình dữ liệu (expand/contract) | lập BG-2026-001 → HD từ BG giữ giá đóng băng → DNTT-2026-001; PXK-2026-001 in đúng mẫu; mỗi loại số riêng từ 001 | todo |
| 5 | Nhập mẫu từ `.docx`: tải file lên → đọc `{{placeholder}}` → Giám đốc đặt nhãn/kiểu/bắt buộc cho từng trường → lưu thành mẫu (hoặc phiên bản mới) của một loại | M4 | needs: #4 (mẫu phải thuộc một loại) · thay "trình sửa mẫu" đang Parked | tải `Bao_Gia.docx` → thấy đủ trường `{{…}}` → lưu → tạo được tài liệu từ mẫu đó | todo |

## Parked (asked for, not on this roadmap yet)
- Tồn kho (phiếu xuất kho trừ số lượng tồn) — 2026-10-01 — why not now: chỉ in phiếu từ mẫu; quản lý kho là module riêng
- Nhập 01_DS_Khach.xlsx / CRM pipeline khách — 2026-09-29 — why not now: dữ liệu cá nhân, spec riêng
- Gửi tài liệu qua email khi phát hành — why not now: workbook `email`; cần PDF (#1) trước
- Kết nối Claude qua MCP (`mcp-codemode.workbook.md`) — why not now: DRAFT, chỉ khi bạn yêu cầu
