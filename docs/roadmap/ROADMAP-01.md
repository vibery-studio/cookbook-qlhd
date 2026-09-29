# ROADMAP-01: phòng Kinh doanh lập, duyệt, phát hành hợp đồng trong app

Status: Active 2026-09-29
Goal: trong app đang chạy, sales tạo hợp đồng từ mẫu Nhật Minh, Quản lý/Giám đốc duyệt, phát hành ra `HD-2026-001…`
không hở số; checklist §7 của `documents.workbook.md` click qua được bằng 3 vai trò.
Drafted from: MAP M1–M7 · `docs/cookbook/documents.workbook.md` · owner-box (mẫu + bảng giá).

## Rows (in order)
| # | Feature | Serves (MAP line) | Why here — needs / priority | Done when | Status |
|---|---|---|---|---|---|
| 1 | Nền: 3 vai trò + quyền `contract:*` `template:write` `audit:read` · bảng `audit_events` + `permission.denied` · khách hàng tối thiểu · bảng giá (seed 09_Bang_Gia) | M5 M6 M7 | needs: không có · mọi dòng sau cần vai trò, nhật ký, khách, giá | `/docs`: đăng nhập 3 vai trò, gọi thiếu quyền → 403 + dòng nhật ký; `GET` khách + giá theo ngày trả đúng | todo |
| 2 | Mẫu hợp đồng có phiên bản — seed "Hợp đồng cung cấp dịch vụ phần mềm" từ `Hop_Dong_Dich_Vu.docx` (bỏ ghi chú nội bộ → thành quy tắc duyệt) | M4 | needs: #1 (quyền `template:write`) | `GET /templates` thấy mẫu + trường bắt buộc + bước duyệt; tạo v2 không đổi v1 | todo |
| 3 | Vòng đời hợp đồng: tạo → gửi duyệt → duyệt/từ chối → phát hành (số) → hủy + thay thế; hàng đợi "Chờ tôi duyệt"; nhật ký theo hợp đồng | M1 M2 M3 M5 | needs: #1 #2 · lõi nghiệp vụ, rủi ro cao nhất | 16 test + 8 probe §7 xanh, dán output thật (đua 10 phát hành → 001…010) | todo |
| 4a | Giao diện nền `apps/web` (React + Vite): design tokens FEEL, sidebar, đăng nhập + kích hoạt, màn Khách hàng · Phân quyền · Nhật ký | M5 M6 M7 | needs: #1 · chạy song song với #2 #3 (đổi thứ tự 2026-09-29) | 3 vai trò đăng nhập, xem đúng 3 màn theo quyền; mobile 390px đọc được | todo |
| 4b | Giao diện hợp đồng: Hợp đồng · Mẫu · Chờ tôi duyệt · bản in + e2e-kit | M1–M4 | needs: #3 (API đủ) · #4a | checklist §7 click bằng 3 vai trò, 1 e2e desktop + 1 mobile 390px | todo |

## Parked (asked for, not on this roadmap yet)
- Báo giá (`BG`) + Đề nghị thanh toán (`DNTT`) — mẫu có trong owner-box — 2026-09-29 — why not now: app chỉ có loại `contract`; thêm loại sau khi lõi chạy
- Nhập 01_DS_Khach.xlsx / CRM pipeline khách (04_Quy_Trinh) — 2026-09-29 — why not now: workbook `crm` riêng, dữ liệu cá nhân cần spec riêng
- Gửi hợp đồng qua email khi phát hành — why not now: workbook `email`, nghe `contract.issued`
- Kết nối Claude qua MCP (`mcp-codemode.workbook.md`) — why not now: DRAFT, chỉ khi bạn yêu cầu
