# INTENT-08: Sản phẩm & giá — quản lý trên app, chọn vào dòng hàng, giá chưa VAT + thuế suất

Status: Approved 2026-10-01
Serves: MAP M1 (+ M8 mới: Quản lý · Giám đốc quản lý sản phẩm và giá) · Roadmap: ROADMAP-02 row 3
Asked by: bạn (phiên feedback 2026-10-01) · Written: 2026-10-01

## 1. Problem today
- [PRB-1] Bảng giá chỉ đổi được bằng migration (dev); Quản lý/Giám đốc không tự thêm gói hay đổi giá.
- [PRB-2] Chỉ có gói dịch vụ theo thời hạn (G3/G6/G12); không có hàng hóa (đơn vị tính, mã) cho báo giá/phiếu xuất kho (row 4).
- [PRB-3] Giá đang là "đã gồm VAT" một mức; không tách tiền trước thuế, thuế suất theo sản phẩm, tiền thuế.

## 2. Outcome
- [OUT-1] Quản lý/Giám đốc thêm, sửa, ngừng bán sản phẩm (dịch vụ có thời hạn · hàng hóa có đơn vị tính + mã) ← PRB-1 PRB-2
- [OUT-2] Giá mới = một mức giá có hiệu lực từ ngày X (không sửa mức cũ, không lùi về quá khứ); tài liệu lập trước X giữ giá cũ; tài liệu đã phát hành không bao giờ đổi ← PRB-1
- [OUT-3] Giá lưu **chưa VAT** + **thuế suất theo sản phẩm**; tài liệu hiện tiền trước thuế · thuế · tổng thanh toán (bằng chữ) ← PRB-3
- [OUT-4] Tạo tài liệu: chọn sản phẩm vào dòng hàng; giá lấy theo ngày lập ← M1

## 3. Who and what it touches
- People: Quản lý + Giám đốc (sửa: quyền mới `product:write`, `price:write`) · mọi người (xem, chọn).
- Data: sản phẩm, mức giá theo ngày, thuế suất — tiền; snapshot hợp đồng (cách tính tổng đổi cho tài liệu MỚI).

## 4. Out of scope
- Tồn kho (Parked) · nhiều bảng giá theo khách/kênh · chiết khấu theo sản phẩm (giảm giá vẫn theo % trên tài liệu như hiện nay).

## 5. Open questions
- [Q-1] Ai sửa? → answer: **Quản lý + Giám đốc** (`product:write`, `price:write`) (bạn chốt 2026-10-01)
- [Q-2] Loại sản phẩm? → answer: **dịch vụ (thời hạn) + hàng hóa (đơn vị tính, mã); không tồn kho** (bạn chốt)
- [Q-3] Đổi giá? → answer: **mức giá mới có hiệu lực từ ngày, không sửa mức cũ, không lùi quá khứ** (bạn chốt)
- [Q-4] VAT? → answer: **giá chưa VAT + thuế suất theo sản phẩm** (bạn chốt)
- [Q-5] Thuế suất các gói G3/G6/G12 hiện có + cách đổi giá "đã gồm VAT" sang "chưa VAT"? → answer: **giả lập (DEMO): 10%, giá chưa VAT = round(giá cũ ÷ 1,1)**; số thật bạn set sau → phải có seeder (`pnpm dev:seed-products`) thay được (bạn chốt 2026-10-01)
- [Q-6] Hợp đồng đã lập (nháp/chờ duyệt) theo cách tính cũ: giữ cách cũ hay tính lại khi sửa? → answer: **dữ liệu hiện có là demo — wipe/seed lại, không cần tương thích** (bạn chốt; ghi nhớ, không hỏi lại)
