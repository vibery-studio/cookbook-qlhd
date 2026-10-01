# ROADMAP-03: dọn nợ hiển thị + chốt dữ kiện thật trước khi dùng hằng ngày

Status: Draft 2026-10-01 (chờ bạn sắp thứ tự / duyệt — chưa build)
Goal: app chạy với số liệu thật của Nhật Minh (giá, thuế suất, mẫu PXK) và không còn nit hiển thị đã ghi ở PROOF row 2b–5.
Drafted from: Nits trong PLAN-07/08/09/10 §6 · TODO facts (SPEC-08, SPEC-09) · Parked ROADMAP-02.

## Rows (in order)
| # | Feature | Serves (MAP line) | Why here — needs / priority | Done when | Status |
|---|---|---|---|---|---|
| 1 | Chốt dữ kiện thật: giá + thuế suất (KCT/8%/10%) qua `dev:seed-products --replace`; mẫu PXK đối chiếu Phụ lục I TT 99 (hay TT 133), "Bộ phận"/kho | M8 M9 | needs: kế toán Nhật Minh trả lời · tiền + pháp lý → trước khi dùng thật | bỏ hết nhãn DEMO trên sản phẩm + PXK | todo |
| 2 | Nit hiển thị: pill xuống dòng (bảng Tài liệu/Sản phẩm), drawer PXK bỏ cột giá + khối tiền 0 ₫, "Mẫu hợp đồng" → "Mẫu tài liệu", cột "Kiểu" khi nhập mẫu, ngăn vai trò Esc khi đang sửa | M1 M4 M7 | needs: không · small changes | ảnh 1440/390 không còn các điểm trên | todo |
| 3 | Dọn kỹ thuật: DROP bảng `price_list` (PR riêng, expand/contract); thêm người giữ `roles:write` thường trực (four-eyes lockout) | — | needs: không · nợ đã ghi ở handoff | migration drop riêng; ≥ 3 người giữ `roles:write` | todo |

## Parked (asked for, not on this roadmap yet)
- Tồn kho (PXK trừ tồn) — 2026-10-01 — why not now: module riêng
- Theo dõi thu tiền / nhiều đợt thanh toán cho DNTT — 2026-10-01 (INTENT-09 ngoài phạm vi) — why not now: công nợ là feature riêng
- Gửi tài liệu cho khách qua email/Zalo — 2026-10-01 — why not now: workbook `email`
- Nhập 01_DS_Khach.xlsx / CRM pipeline khách — 2026-09-29 — why not now: dữ liệu cá nhân, spec riêng
- Ảnh/đầu-chân trang khi nhập Word (SPEC-10 later) — 2026-10-01 — why not now: bộ thẻ in hiện tại không có ảnh
- Kết nối Claude qua MCP (`mcp-codemode.workbook.md`) — why not now: DRAFT, chỉ khi bạn yêu cầu
