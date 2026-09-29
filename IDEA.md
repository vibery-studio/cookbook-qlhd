# IDEA — quản lý hợp đồng Nhật Minh

Status: Approved 2026-09-29

**Ai:** Phòng Kinh doanh Công ty TNHH Phần mềm Nhật Minh — Nhân viên (sales), Quản lý, Giám đốc.
**Việc chính:** sales lập hợp đồng cung cấp dịch vụ phần mềm từ mẫu của công ty cho một khách; giá lấy từ bảng giá,
qua duyệt đúng người, phát hành với số liên tục `HD-YYYY-NNN`; hợp đồng đã phát hành không bao giờ bị sửa lén.
**Hôm nay hỏng ở đâu:** giá tự gõ (còn giá cũ), giảm >10% lọt qua không ai duyệt, số hợp đồng nhảy/trùng, sai thì sửa
thẳng vào bản đã gửi khách, không biết ai đã làm gì.
**Tốt hơn trông thế nào:** mở app thấy mọi hợp đồng theo trạng thái; không ai tự duyệt hợp đồng của mình; số không hở,
không trùng; mọi bước (kể cả bị từ chối) nằm trong nhật ký.

**Nguồn sự thật:** `docs/cookbook/` (workbook + design + mockup) · hồ sơ chủ doanh nghiệp
`ship-with-claude/modules/M5/01-tu-lieu-khach-gui/owner-box/` — `07_Mau_Tai_Lieu/Hop_Dong_Dich_Vu.docx` (mẫu hợp đồng,
thông tin Bên A, tài khoản), `09_Bang_Gia.xlsx` (bảng giá đã gồm VAT + sheet "Quy định").

**Ngoài phạm vi (bản này):** báo giá, đề nghị thanh toán, CRM/pipeline khách, gửi email/Zalo, chữ ký điện tử, hóa đơn
điện tử, xác nhận đã thanh toán.

## Quyết định đã chốt (2026-09-29)
- Giá từ bảng giá theo ngày lập (đã gồm VAT): thành tiền = giá gói × số cửa hàng − giảm giá; làm tròn half-up tới đồng.
- Duyệt: luôn Quản lý duyệt; giảm >10% thêm bước Giám đốc duyệt. Người tạo không bao giờ tự duyệt; không có người duyệt hợp lệ → chặn lúc gửi duyệt, nêu tên bước (I9).
- Mẫu: chỉ seed "Hợp đồng cung cấp dịch vụ phần mềm" (Hop_Dong_Dich_Vu.docx); Bên A lấy từ .docx; ghi chú nội bộ → quy tắc duyệt.
- `so_bao_gia`/`ngay_bao_gia`: tự nhập, không bắt buộc; trống → không in dòng "Căn cứ". `chuc_vu_nguoi_ky`: bắt buộc, nhập tay.
- Từ chối = kết thúc + "chép sang nháp mới". Web: React + Vite.
