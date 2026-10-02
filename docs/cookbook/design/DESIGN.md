# DESIGN — screens, components, states of the contract app (design law)

Status: Approved — extracted 2026-09-29 from the approved mockup (`docs/cookbook/mockup/index.html`). Uses FEEL tokens only.

## Screens (sidebar nav, in this order)
| Screen | What it shows | Who |
|---|---|---|
| **Hợp đồng** | the library: one table (Mã · Hợp đồng · Khách hàng · Giá trị · Trạng thái · Người tạo · Cập nhật), status tabs with counts (Tất cả · Nháp · Chờ duyệt · Đã duyệt · Đã phát hành · Từ chối), "+ Tạo hợp đồng"; a draft shows *Nháp · chưa có số* instead of a number | everyone |
| **Mẫu hợp đồng** | template cards (fields as chips, approval steps); detail: typed fields with *bắt buộc* marks, default line items, clauses, steps; "Tạo hợp đồng từ mẫu này →"; 🔒 only Giám đốc edits | everyone reads, Giám đốc edits |
| **Chờ tôi duyệt** | the approvals queue for the signed-in user; each item opens the contract | approvers |
| **Khách hàng** | customer cards: contact, MST, phone, number of contracts, total value | everyone |
| **Phân quyền** | role × permission matrix (`contract:approve`, `contract:issue`, `audit:read`…) — read-only proof of the RBAC | everyone |
| **Nhật ký** | audit log, newest first, incl. refused actions (`permission.denied`) in the danger colour | audit readers |
| **Người dùng** (`/nguoi-dung`, row 4a · DEC-2) | accounts table (name · email · role chip · Chờ kích hoạt/Đang dùng/Đã khóa); "+ Mời người dùng" modal (email, tên hiển thị, vai trò) → activation link shown once + copy; pending rows "Tạo lại link"; role change/lock inline; last active admin can't be locked (Vietnamese reason); mobile = cards | `users:read` (admin, Giám đốc) |

## Components
- **Sidebar** 240px: app name + "nội bộ · của bạn", nav, section "HỆ THỐNG", user chip with role badge + Đăng xuất at the bottom.
- **Table**: 44px rows, hover `--bg-sunken`, money right-aligned mono, status as a pill (FEEL ramp), row click opens the drawer.
- **Contract drawer** 560px: header (code + status), info, line items + total, **approval timeline** (Tạo → Gửi duyệt → Duyệt/Từ chối → Phát hành, current step highlighted), **"Xem văn bản hợp đồng"**, footer actions gated by role — an action the user may not take shows 🔒 with the reason, never a dead button.
- **Create modal**: pick template → customer → values; required fields marked; "Tạo & xem văn bản".
- **Document preview ("paper")**: the Vietnamese contract layout — CỘNG HÒA… header, căn cứ, Bên A / Bên B, Điều 1 value table, Điều 2 term, Điều 3 clauses, signature blocks; draft watermark "NHÁP" until issued; issued = the stored snapshot.

## States (every screen)
- Empty: one sentence + the one action that fills it ("Chưa có hợp đồng nào — Tạo hợp đồng").
- Loading: skeleton rows, no spinner wall. Error: plain Vietnamese message + Thử lại; never a raw error code.
- Refused (403): the 🔒 explanation in place of the action; the refusal is also visible in Nhật ký.
- Mobile 390px: sidebar collapses to a top bar, tables become stacked cards, drawer becomes full-screen.

## Screens added after the live (v1.2; same tokens, same states)
| Screen | What it shows | Who |
|---|---|---|
| **Tài liệu** (replaces the single "Hợp đồng" list) | type tabs (HD · BG · DNTT · PXK) + pill Loại, "+ Tạo" menu shows only the types the user may create (server-computed), drawer shows parent/child links and "lập tài liệu con" with the 🔒 reason | per type permission |
| **Sản phẩm & giá** | products (dịch vụ · hàng hóa) with dated price levels ex-VAT + VAT rate; a price level is never edited, only superseded; confirm before ending a level | Quản lý · Giám đốc |
| **Nhập mẫu từ Word** | 3 steps: upload `.docx` → sandboxed preview + field table (label, type, required) → save as new template or new version; docx errors in plain Vietnamese | Giám đốc (`template:write`) |
| **Phân quyền** (now editable) | matrix + 560 px role drawer (save diff, clone, delete), add-role modal; a cell the editor cannot grant is disabled with one tooltip line, no per-row 🔒; requests tab + conflicting-pairs tab, nav badge for pending | roles:write holders |
| **Rà soát quyền** (`/ra-soat-quyen`) | quarterly access review, overdue banner | Giám đốc |
| **Bảo mật** | Root only: the 2-layer approval switch, reason required, audit row | Root |
| **Người dùng** (extended) | JIT grant/revoke chips with the countdown, banner "Kết thúc sớm"; role options and locks come from the API | admin · Giám đốc |

Rule for every new screen: the disabled/hidden state and its reason come from the API (`can`, `locked_reason`), never from a copy of the rule in the web app.
