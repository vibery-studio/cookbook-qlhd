# SPEC-02: Mẫu hợp đồng có phiên bản

Status: Approved 2026-09-29
Intent: docs/intent/INTENT-02.md

## 1. Research (sources + date)
- Domain: `documents.workbook.md` §2a (template · template_version · merge field · approval_policy), §2b (Template change effect, Approval policy,
  Output format), §2c (nội bộ bị in ra; trường mẫu cần mà app không lưu), §4 (route/validation/domain), §5 (`template_versions(template_id, version_no)` UNIQUE,
  body có giới hạn), §6 (guards, `template:write` chỉ Giám đốc, render escape, placeholder sót = từ chối), §9 (string-replace merge) (2026-09-29).
- Nguồn thật: `Hop_Dong_Dich_Vu.docx` (trích bằng `textutil`, 16 placeholder + 1 ghi chú nội bộ + Bên A + tài khoản) · `09_Bang_Gia.xlsx` sheet "Quy định"
  (quy tắc 1–3, 6) (2026-09-29).
- Quy ước API từ SPEC-01 (đã duyệt): Problem+JSON · 422 validation · slug gạch nối (`validation` `stale` `duplicate` `not-found`, mới: `template-check-failed`) ·
  ghi cần `Origin` + `X-Requested-With: fetch` · `Idempotency-Key` (header) · phân trang cursor ≤50 · dòng nhật ký cùng `db.batch` với thay đổi.
- D1 `batch()` = transaction, chạy tuần tự (đã ghi ở SPEC-01 §1) → thêm phiên bản + đổi `current_version_id` + dòng nhật ký đi chung một batch.
- Stack: không có thư viện mới. Bộ lọc HTML tự viết (allowlist, hàm thuần) — TODO PLAN: nếu muốn dùng thư viện, nghiên cứu docs chính thức trước khi cài (CLAUDE.md).

## 2. Requirements
- [FR-1] Bảng `templates` + `template_versions`; phiên bản chỉ thêm, không sửa, không xóa; `version_no` duy nhất trong một mẫu → OUT-3
- [FR-2] Mỗi phiên bản mang: `body` (chữ hợp đồng có `{{key}}`), `fields[]`, `default_line_items[]`, `default_clauses[]`, `approval_policy`, `field_rules[]` → OUT-1 OUT-2
- [FR-3] Seed mẫu "Hợp đồng cung cấp dịch vụ phần mềm" v1 từ .docx: mọi placeholder có trường + nguồn (bảng §3.4), ghi chú nội bộ không còn trong body và thành `approval_policy` → OUT-1 OUT-2
- [FR-4] `GET /templates`, `GET /templates/{id}` cho người có `contract:read`; xem được bản cũ theo `version_no` → OUT-1 OUT-3 OUT-5
- [FR-5] `POST /templates` (mẫu mới + v1) và `POST /templates/{id}/versions` (v kế tiếp, kiểm tra bằng `expected_version_no`) chỉ `template:write` → OUT-3 OUT-5
- [FR-6] Kiểm tra mẫu lúc nhập (dùng chung cho seed, `POST /templates`, `POST /templates/{id}/versions`); MỘT lỗi = từ chối cả phiên bản, không ghi gì, trả danh sách đầy đủ: → OUT-4
  (a) `{{placeholder}}` trong body không có trường · (b) trường `required` không có `source` · (c) trường có `source` mà app không có cột/nguồn tương ứng (liệt kê) ·
  (d) `approval_policy` sai (quyền/vai trò/biến lạ, bước rỗng) · (e) body chứa "Ghi chú nội bộ" hoặc thẻ/thuộc tính HTML ngoài allowlist · (f) vượt giới hạn kích thước · (g) cú pháp `{{#if}}` không cân
- [FR-7] Mỗi lần tạo mẫu/phiên bản có đúng 1 dòng nhật ký (`template.created`, `template.version_created`) trong cùng batch; lần bị chặn quyền có `permission.denied` → OUT-5
- [FR-8] Hợp đồng (row 3) ghim vào `template_version.id`; row 2 cung cấp hàm đọc theo id (kể cả bản cũ) và hợp đồng thu được phần "row 3 dựa vào" (§3.6) → OUT-3

## 3. Design

### 3.1 Data (migration mới, chỉ thêm)
- `templates(id ULID, type TEXT 'contract', name TEXT, name_norm TEXT UNIQUE, subject_type TEXT 'customer', current_version_id TEXT, active INTEGER DEFAULT 1, created_by, created_at, updated_at)`
  — `type` chọn tiền tố/dãy số ở row 3 (`contract` → `HD`). `current_version_id` chỉ đổi bằng CAS trong cùng batch với INSERT phiên bản.
- `template_versions(id ULID, template_id → templates, version_no INTEGER, body TEXT, fields TEXT(JSON), default_line_items TEXT(JSON), default_clauses TEXT(JSON),
  approval_policy TEXT(JSON), field_rules TEXT(JSON), note TEXT NULL, created_by, created_at)`; UNIQUE(`template_id`, `version_no`); không có cột `updated_*`, DAO không có hàm update/delete;
  trigger `BEFORE UPDATE/DELETE` chặn (thêm lớp bảo vệ — xem DEC-6).
- Seed = migration (DEC-5): `created_by` = NULL (`system`); dòng nhật ký seed `template.created` actor NULL (`audit_events.actor` nullable — đã xác nhận).
- Không lưu dữ liệu khách; không có tiền tính ở đây.

### 3.2 Chữ mẫu (`body`)
- Định dạng: HTML tối giản (DEC-1). Cho phép: `p h1 h2 h3 br strong em ul ol li table tr td th div span`, thuộc tính `class` (từ danh sách: `center` `right` `b` `sig` …) — không `script`, `style`, `on*`, `href`/`src` ngoài.
- Placeholder `{{key}}`: key = `[a-z][a-z0-9_]*`. Điều kiện duy nhất: `{{#if key}}…{{/if}}` (hiện khối khi `key` có giá trị). Không có vòng lặp, không biểu thức.
- Giá trị điền vào được HTML-escape lúc dựng (row 3). Placeholder còn sót sau khi điền = từ chối tạo (I3).
- Chữ hợp đồng seed: xem §3.5 (sao y từ .docx, trừ ghi chú nội bộ).

### 3.3 Trường (`fields[]`) và luật trường (`field_rules[]`)
`fields[] = {key, label, type, required, source, options?, options_from?, default?}`
- `type` ∈ `text · paragraph · money · number · percent · date · choice` (workbook §2a). `percent` lưu bps nguyên 0–10000 (giao diện nhập % tối đa 2 số lẻ: 10,5% = 1050); `money` = số nguyên đồng; `date` = ISO, in `dd/MM/yyyy`.
- `source` (chuỗi `loại` hoặc `loại:tham_chiếu`):
  | Loại | Nghĩa | Tham chiếu hợp lệ hôm nay (đăng ký trong domain, nguồn = cột thật của app) |
  |---|---|---|
  | `subject:<cột>` | chép từ khách của hợp đồng (chụp vào snapshot lúc tạo) | `name` `contact_person` `tax_code` `phone` `email` `address` (cột của `customers`, SPEC-01) |
  | `price_list:<cột>` | tra bảng giá theo ngày lập (SPEC-01 `price_list`) | `code` `name` `unit_price` `duration_value` `duration_unit` |
  | `derived:<tên>` | server tính (row 3) | `doc_date` `contract_end` `total` `total_in_words` `discount_bps` |
  | `issue:number` | số hợp đồng, có lúc phát hành, không có lúc tạo nháp | `number` |
  | `manual` | người tạo nhập | — |
  `deal:*` và mọi tham chiếu không có trong bảng trên = KHÔNG có nguồn → FR-6(c) từ chối và liệt kê.
- `required = true` → thiếu giá trị lúc TẠO hợp đồng thì từ chối, nêu tên trường (I3, row 3). Riêng `issue:number` không bắt buộc lúc tạo (bản nháp hiện "chưa có số"); bắt buộc có lúc phát hành.
- `default`: chỉ dùng khi mẫu ghi rõ: literal (seed: `giam_gia` = 0, Q-3) hoặc `derived:doc_date` (seed: `ngay_bat_dau`, Q-1). Trường có `default` không bắt buộc người tạo nhập; server điền khi trống. Giá trị mặc định `derived:doc_date` theo ngày lập mới khi nháp được sửa (row 3); giá trị người tạo đã nhập thì giữ nguyên.
- `field_rules[]`: `{all_or_none: [key, key]}` — hoặc cả hai trường đều có giá trị, hoặc cả hai trống (seed: `so_bao_gia` + `ngay_bao_gia`, tránh in "ngày " trống).
- Trường không xuất hiện trong body được phép (dùng để tính/chọn, ví dụ `ma_goi`).

### 3.4 Mẫu seed — ánh xạ placeholder (16 placeholder trong .docx)
| Placeholder | Label | Kiểu | Bắt buộc | Nguồn | Ghi chú |
|---|---|---|---|---|---|
| `so_hop_dong` | Số hợp đồng | text | (lúc phát hành) | `issue:number` | `HD-YYYY-NNN` gán lúc phát hành (I1); bản nháp in "Nháp · chưa có số" |
| `so_bao_gia` | Số báo giá | text | không | `manual` | trống → bỏ nguyên dòng "Căn cứ" |
| `ngay_bao_gia` | Ngày báo giá | date | không | `manual` | `all_or_none` với `so_bao_gia` |
| `ngay_hop_dong` | Ngày hợp đồng | date | có | `derived:doc_date` | ngày lập theo giờ VN (Q-2) |
| `ten_cua_hang` | Tên cửa hàng | text | có | `subject:name` | Bên B |
| `ten_khach` | Người đại diện Bên B | text | có (DEC-8) | `subject:contact_person` | cột nullable ở `customers` → thiếu thì từ chối, nêu tên |
| `chuc_vu_nguoi_ky` | Chức vụ người ký | text | **có** | `manual` | không có cột nào chứa; bắt buộc nhập tay (IDEA) |
| `sdt` | Điện thoại | text | có (DEC-8) | `subject:phone` | |
| `email` | Email | text | có (DEC-8) | `subject:email` | |
| `ten_goi` | Tên gói | text | có | `price_list:name` | theo `ma_goi` + ngày lập |
| `so_cua_hang` | Số cửa hàng | number | có | `manual` | nguyên 1–999 (trần kiểm tra hợp lý, không phải luật kinh doanh — Q-5) |
| `ngay_bat_dau` | Ngày bắt đầu | date | có (có `default`) | `manual`, `default: derived:doc_date` | mặc định = ngày lập, sửa được (Q-1) |
| `ngay_ket_thuc` | Ngày kết thúc | date | có | `derived:contract_end` | = bắt đầu + thời hạn gói − 1 ngày ("đến hết ngày"); thời hạn từ `price_list:duration_*` |
| `giam_gia` | Giảm giá (%) | percent | có (có `default`) | `manual`, `default: 0` | 0–10000 bps = 0–100% (Q-3); >10% kích bước Giám đốc |
| `tong_tien` | Giá trị hợp đồng | money | có | `derived:total` | giá gói × số cửa hàng − giảm giá, half-up (quyết định đã chốt); đã gồm VAT |
| `tong_tien_bang_chu` | Bằng chữ | text | có | `derived:total_in_words` | có chữ "đồng" cuối, dùng "lẻ" ("Một trăm lẻ năm nghìn đồng") vì .docx viết `(bằng chữ: …)` |

Trường thêm KHÔNG có trong body (để tính; không tạo placeholder mới):
| Key | Label | Kiểu | Bắt buộc | Nguồn | Dùng để |
|---|---|---|---|---|---|
| `ma_goi` | Gói | choice, `options: ["G3","G6","G12"]` | có | `manual` | chọn dòng giá → `ten_goi`, `unit_price`, thời hạn. `DT14` KHÔNG làm hợp đồng (Q-4): giá trị ngoài `options`, hoặc mã không có giá ngày lập → 422 nêu `ma_goi` |

Không tạo trường `don_gia`: .docx không có `{{don_gia}}`; đơn giá nằm ở dòng chi tiết trong snapshot (row 3).
`default_line_items[]` = `[]` (hợp đồng in một giá trị ở Điều 2, không bảng dòng). `default_clauses[]` = `[]` (Điều 1–5 nằm trong body; điều khoản cố định).

`approval_policy` seed (mode `combined`):
```json
{
  "mode": "combined",
  "steps": [
    {"step_no": 1, "label": "Quản lý duyệt", "permission": "contract:approve"}
  ],
  "rules": [
    {"when": {"var": "discount_bps", "op": "gt", "value": 1000},
     "add_steps": [{"label": "Giám đốc duyệt", "permission": "contract:approve", "role": "giam_doc"}]}
  ]
}
```
- `discount_bps > 1000` ≡ "discount_pct > 10": đúng 10,00% KHÔNG kích; 10,01% kích ("giảm >10%"). Bước thêm vào SAU các bước cố định, `step_no` cấp lúc tính (row 3).
- `mode` ∈ `none · steps · threshold · combined`; `steps` bắt buộc khi `steps`/`combined`; `rules` bắt buộc khi `threshold`/`combined`. `op` ∈ `gt gte lt lte eq`. `var` ∈ allowlist `discount_bps` `total` (biến tính được ở row 3). `role` (tùy chọn) ∈ vai trò seed ở SPEC-01.
- Bước 1 không ghi `role`: mọi người dùng active có `contract:approve` (Quản lý hoặc Giám đốc) trừ người tạo duyệt được — DEC-7. Bước "Giám đốc duyệt" có `role: giam_doc`.
- Một người KHÔNG quyết hai bước của cùng hợp đồng (Q-6): mỗi bước một người khác nhau, người tạo không quyết bước nào. Hệ quả cho row 3: I9 lúc gửi duyệt kiểm tồn tại phép gán người DUY NHẤT cho mọi bước (bộ ghép phân biệt; không có = từ chối, nêu bước không ghép được); `decideStep` từ chối 403 + `permission.denied` rule `one_person_one_step` nếu người quyết đã quyết bước trước của hợp đồng đó. Ví dụ (một Giám đốc + một Quản lý, hợp đồng >10%): Nhân viên tạo → bước 1 {Quản lý, Giám đốc}, bước 2 {Giám đốc} → gán được; Quản lý tạo → bước 1 {Giám đốc}, bước 2 {Giám đốc} → không gán được → từ chối, nêu "Giám đốc duyệt".
- Fail-closed (workbook §6): quy tắc không tính được (thiếu biến) = cần duyệt.

### 3.5 Chữ hợp đồng seed (sao từ .docx; Bên A từ .docx; ghi chú nội bộ đã bỏ)
```html
<div class="center b">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
<div class="center b">Độc lập – Tự do – Hạnh phúc</div>
<h1 class="center">HỢP ĐỒNG CUNG CẤP DỊCH VỤ PHẦN MỀM</h1>
<p class="center">Số: {{so_hop_dong}}</p>
{{#if so_bao_gia}}<p>Căn cứ báo giá số {{so_bao_gia}} ngày {{ngay_bao_gia}}.</p>{{/if}}
<p>Hôm nay, ngày {{ngay_hop_dong}}, chúng tôi gồm:</p>
<h3>Bên A (bên cung cấp)</h3>
<p class="b">CÔNG TY TNHH PHẦN MỀM NHẬT MINH</p>
<p>Địa chỉ: 25 Nguyễn Văn Trỗi, Phường Phú Nhuận, TP. Hồ Chí Minh</p>
<p>Đại diện: ông Nguyễn Nhật Minh — Chức vụ: Giám đốc</p>
<h3>Bên B (khách hàng)</h3>
<p>Tên cửa hàng: {{ten_cua_hang}}</p>
<p>Đại diện: {{ten_khach}} — Chức vụ: {{chuc_vu_nguoi_ky}}</p>
<p>Điện thoại: {{sdt}} — Email: {{email}}</p>
<h3>Điều 1. Nội dung dịch vụ</h3>
<p>Bên A cấp cho Bên B quyền sử dụng phần mềm quản lý bán hàng Nhật Minh, {{ten_goi}}, cho {{so_cua_hang}} cửa hàng, từ ngày {{ngay_bat_dau}} đến hết ngày {{ngay_ket_thuc}}. Bên A hỗ trợ cài đặt và hướng dẫn sử dụng qua điện thoại và Zalo trong giờ hành chính.</p>
<h3>Điều 2. Giá trị hợp đồng</h3>
<p>Giá trị hợp đồng: {{tong_tien}} đồng (bằng chữ: {{tong_tien_bang_chu}}), đã gồm VAT, đã trừ giảm giá {{giam_gia}}%.</p>
<h3>Điều 3. Thanh toán</h3>
<p>Bên B chuyển khoản 100% giá trị hợp đồng trong 7 ngày kể từ ngày ký, theo đề nghị thanh toán của Bên A. Tài khoản: 0071 0004 58213 · Vietcombank · Chủ tài khoản: CÔNG TY TNHH PHẦN MỀM NHẬT MINH.</p>
<h3>Điều 4. Trách nhiệm của hai bên</h3>
<p>Bên A bảo đảm phần mềm hoạt động ổn định và giữ bí mật dữ liệu bán hàng của Bên B. Bên B sử dụng phần mềm đúng mục đích và thanh toán đúng hạn.</p>
<h3>Điều 5. Điều khoản chung</h3>
<p>Hợp đồng lập thành 02 bản, mỗi bên giữ 01 bản, có giá trị như nhau. Mọi thay đổi phải được hai bên đồng ý bằng văn bản.</p>
<table class="sig"><tr><th>ĐẠI DIỆN BÊN A</th><th>ĐẠI DIỆN BÊN B</th></tr>
<tr><td>(ký, ghi rõ họ tên)</td><td>(ký, ghi rõ họ tên)</td></tr></table>
```
Chữ hợp đồng, Bên A và tài khoản ngân hàng nằm trong body (DEC-4): đổi = phiên bản mới, có nhật ký. Các thẻ đánh dấu (`h3`, `class`) là cách trình bày, không đổi chữ — người soát đối chiếu từng câu với .docx.

### 3.6 Row 3 dựa vào gì (hợp đồng — SPEC-03 phải khớp)
- **Ghim:** `contracts.template_version_id` = `template_versions.id` (ULID) của phiên bản đang `current_version_id` lúc tạo; không bao giờ ghim tên mẫu hay `version_no`. Bản nháp giữ nguyên ghim cho tới khi người tạo chọn "tạo lại theo bản mới nhất" (workbook §2b).
- **Đọc:** hàm DAO `getTemplateVersionById(db, id)` (trả cả bản cũ, kể cả khi `templates.active = 0`) và `getCurrentVersion(db, templateId)`; row 3 không tự đọc bảng.
- **Hình dạng dữ liệu cố định** (contract của row 2, đổi = phiên bản schema mới): `fields[]` như §3.3 (kèm `source` dạng chuỗi), `field_rules[]`, `default_line_items[]`, `default_clauses[]`, `approval_policy` như §3.4 (`mode`, `steps[]`, `rules[{when:{var,op,value}, add_steps[]}]`), `body` HTML + `{{key}}` + `{{#if}}`; `templates.type` cho dãy số/tiền tố; `templates.subject_type`.
- **Row 3 làm** (không phải row 2): điền `subject:*` từ khách và `price_list:*` theo `ma_goi` + ngày lập; điền `default` (`ngay_bat_dau`, `giam_gia`); tính `derived:*` và `issue:number`; từ chối thiếu trường bắt buộc + thiếu `all_or_none`; chụp snapshot có `template_version_id` + băm; đánh giá `approval_policy` trên snapshot → tạo `approval_step` lúc gửi duyệt (I9); dựng HTML từ body + snapshot (escape).
- **Mở rộng nguồn:** thêm nguồn `subject:*` mới = thêm dòng vào bảng đăng ký nguồn (một chỗ, `packages`/domain), không sửa mẫu cũ.

### 3.7 Screens / flow
Không giao diện ở row này (row 4). Kiểm tra qua `/docs`: đăng nhập Giám đốc → `POST /templates/{id}/versions` → `GET` thấy v2 làm current, v1 nguyên vẹn. Luồng lỗi: 422 kèm danh sách; 409 `stale` → tải lại rồi gửi lại.

### 3.8 API (contract-first; ghi cần `Origin` + `X-Requested-With: fetch`; hai POST nhận `Idempotency-Key`)
| Method + path | Quyền | Request → Response | Lỗi |
|---|---|---|---|
| `GET /templates?cursor&limit≤50` | `contract:read` | `{items:[{id, type, name, active, current_version:{id, version_no, created_at, created_by_name}, required_fields:[key], steps_summary}], next_cursor}` | 401 403 |
| `GET /templates/{id}?version_no=` | `contract:read` | `{id, type, name, subject_type, active, version:{id, version_no, body, fields, field_rules, default_line_items, default_clauses, approval_policy, note, created_at, created_by_name}, versions:[{id, version_no, created_at, created_by_name, note}]}` — không `version_no` → phiên bản hiện tại | 401 403 404 (mẫu hoặc số phiên bản không có) |
| `POST /templates` | `template:write` | `{type:"contract", name, subject_type:"customer", version:{body, fields, field_rules?, default_line_items, default_clauses, approval_policy, note?}}` → 201 (như GET, `version_no` = 1) | 409 `duplicate` (tên trùng, kèm `existing_id`) · 422 `validation` (dạng dữ liệu) · 422 `template-check-failed` (FR-6, kèm `errors[]`) |
| `POST /templates/{id}/versions` | `template:write` | `{expected_version_no, body, fields, field_rules?, default_line_items, default_clauses, approval_policy, note?}` → 201 phiên bản mới (`version_no` +1, thành current) | 404 · 409 `stale` (`expected_version_no` ≠ phiên bản hiện tại) · 422 `validation` · 422 `template-check-failed` |
- Không có `PATCH`/`PUT`/`DELETE` trên mẫu hay phiên bản (FR-1); không có endpoint tắt mẫu (DEC-3).
- `template-check-failed` (Problem+JSON như SPEC-01, `errors[]` mỗi phần tử `{code, key?, message}`); `code` ∈ `placeholder_without_field` · `required_field_without_source` · `unresolvable_source` (kèm `source`) · `policy_invalid` · `internal_note` · `html_not_allowed` · `too_large` · `unbalanced_if` · `all_or_none_invalid`. Trả TẤT CẢ lỗi một lần, thông báo tiếng Việt nêu tên trường.
- Thứ tự kiểm tra: dạng dữ liệu (Zod) → quyền → `template-check-failed` → CAS/ghi. Lỗi không ghi gì (trừ `permission.denied`).
- `created_by_name` lấy `display_name` (SPEC-01); `body` chỉ có trong response chi tiết, không trong danh sách.

## 4. Edge cases — the human marks each: now · later (why) · n/a
| Category | Case here | Decision |
|---|---|---|
| Input | placeholder viết hoa/khoảng trắng `{{ Ten }}` → không hợp lệ, liệt kê · key trùng trong `fields[]` → 422 · body rỗng · chữ có dấu tiếng Việt giữ nguyên (UTF-8) · `{{#if}}` không đóng · `<script>` hoặc `onclick` trong body → `html_not_allowed` | now |
| Input | trường `choice` phải có `options` (danh sách cố định) hoặc `options_from: "price_list"` (mã gói áp dụng ngày lập, như `ma_goi`); thiếu cả hai → 422 | now |
| Input | mẫu quá lớn: body > 64 KB, > 60 trường, > 10 bước → 422 `too_large` (Q-5) | now |
| Duplicates & identity | tên mẫu trùng (bỏ dấu cách/hoa thường) → 409 `duplicate` kèm `existing_id` · 2 placeholder cùng key trong body là hợp lệ (in 2 chỗ) | now |
| Two people at once | 2 Giám đốc cùng tạo v2 từ v1 → 1 thành công, 1 nhận 409 `stale` (CAS + UNIQUE `template_id, version_no`); `version_no` không bao giờ nhảy/trùng | now |
| Two people at once | Nhân viên đang tạo hợp đồng khi mẫu ra v2 → hợp đồng ghim id phiên bản lúc tạo, không đổi (row 3) | now (thuộc row 3, dữ liệu ở đây đủ) |
| Failure & retry | gửi lại cùng `Idempotency-Key` → trả đúng phiên bản đã tạo, không có v kế tiếp · thay đổi + dòng nhật ký cùng batch: thiếu một = cả hai không có | now |
| Permissions / not logged in | chưa đăng nhập → 401 · Nhân viên/Quản lý POST → 403 + `permission.denied` · `admin` kỹ thuật (không có `contract:read`) GET → 403 | now |
| Lifecycle | sửa/xóa phiên bản → không có đường nào · xóa/tắt mẫu → không làm ở row này (DEC-3) · rollback = tạo phiên bản mới với chữ của bản cũ | now (rollback bằng phiên bản mới) · later (tắt mẫu) |
| Lifecycle | phiên bản chưa dùng, sai → không xóa được; chỉ ra bản kế tiếp (chi phí thấp, đổi lấy lịch sử nguyên vẹn) | now |
| Money | mẫu chỉ khai báo kiểu `money`/`percent`; không tính tiền ở đây · ngưỡng 10% = `discount_bps > 1000` (10,00% không kích) | now |
| Time / dates | `created_at` unix giây · mốc ngày trong mẫu (`doc_date`, `contract_end`) tính ở row 3 theo giờ VN | now |
| Data | trường lấy từ nơi không có cột (`deal:*`, `subject:zalo`) → từ chối + liệt kê, không tạo mẫu "nửa chừng" | now |
| Data | khách chưa có `contact_person`/`phone`/`email` mà mẫu đòi → không phải lỗi mẫu; row 3 từ chối tạo hợp đồng, nêu tên trường | now (row 3) |
| Retention | mẫu/phiên bản/nhật ký lưu mãi | later — như SPEC-01 |

## 5. Security
- Who may do what: bảng API §3.8. `template:write` chỉ `giam_doc` (SPEC-01 ma trận); `contract:read` cả 3 vai trò nghiệp vụ; `admin` kỹ thuật không đọc/không sửa mẫu (SPEC-01 DEC-1).
- Personal data: mẫu không chứa dữ liệu cá nhân của khách; chứa dữ liệu công ty (địa chỉ Bên A, số tài khoản) — chỉ trả cho người đăng nhập có `contract:read`; không có endpoint công khai. Metadata nhật ký chỉ ghi id mẫu/phiên bản, `version_no`, số trường; KHÔNG ghi body.
- Abuse: (1) body chứa `<script>`/`on*`/`javascript:` → allowlist từ chối lúc ghi + escape giá trị lúc dựng (row 3) — Giám đốc bị chiếm phiên không tiêm được mã chạy trong bản in của người khác; (2) placeholder lạ để rò dữ liệu → placeholder chỉ điền từ `fields[]` đã khai báo, không có biểu thức/truy cập tùy ý; (3) sửa phiên bản đã dùng → không có route, DAO không có hàm, trigger chặn; (4) gửi mẫu khổng lồ để làm chậm → giới hạn kích thước + phân trang ≤50; (5) hạ ngưỡng duyệt bằng phiên bản mới → chỉ Giám đốc, có nhật ký từng phiên bản, hợp đồng đang chờ vẫn dùng chính sách đã ghim lúc gửi (workbook §2c).

## 6. Decisions (the human decides)
- [DEC-1] Định dạng `body` · options: HTML tối giản có allowlist / Markdown / Markdown + khối HTML · recommended: **HTML tối giản** (bản in A4, tiêu đề căn giữa, bảng chữ ký hai cột cần bố cục mà Markdown không có; workbook §2b Output format = HTML in được) + chỉ thêm `{{#if}}` · decided: **HTML tối giản + `{{#if}}`** (driver chốt theo đề xuất)
- [DEC-2] Nơi lọc HTML · options: lọc khi GHI (từ chối) / chỉ escape khi DỰNG / cả hai · recommended: **cả hai** (ghi: allowlist, từ chối; dựng: escape mọi giá trị) · decided: **cả hai (allowlist khi ghi, escape khi dựng)** (driver chốt theo đề xuất)
- [DEC-3] Tắt/khóa một mẫu · options: không có ở row 2 (cột `active` có sẵn, luôn 1) / `POST /templates/{id}/deactivate` ngay / tắt bằng phiên bản đặc biệt · recommended: **không có ở row 2** (chỉ 1 mẫu seed; thêm khi có mẫu thứ hai cần tắt, expand-only) · decided: **không có tắt mẫu ở row 2** (driver chốt theo đề xuất)
- [DEC-4] Thông tin Bên A (địa chỉ, người đại diện, tài khoản) · options: nằm trong body (đổi = phiên bản mới) / bảng cài đặt công ty, mẫu dùng `{{ben_a_*}}` · recommended: **trong body** (facts lấy đúng .docx, không đẻ thêm nơi lưu; đổi tài khoản ngân hàng cũng có lịch sử phiên bản) · decided: **Bên A trong body** (driver chốt theo đề xuất)
- [DEC-5] Cách seed · options: migration (dữ liệu cố định, mọi môi trường/test có sẵn) / script như admin seed · recommended: **migration** (giống bảng giá SPEC-01; kiểm tra mẫu seed bằng test dùng chính hàm kiểm tra §FR-6) · decided: **seed bằng migration (audit actor NULL cho phép)** (driver chốt theo đề xuất)
- [DEC-6] Chặn sửa phiên bản ở tầng DB · options: chỉ dựa vào code (không có route/hàm) / thêm trigger `BEFORE UPDATE/DELETE` · recommended: **thêm trigger** (rẻ, giữ lời hứa "mẫu cũ không đổi" cả khi có ai viết SQL) — nhưng migration sau phải tránh đụng trigger (expand/contract) · decided: **thêm trigger chặn UPDATE/DELETE `template_versions`** (driver chốt theo đề xuất)
- [DEC-7] Bước 1 "Quản lý duyệt" · options: mọi người có `contract:approve` (Quản lý hoặc Giám đốc) / chỉ vai trò `quan_ly` · recommended: **mọi người có `contract:approve`** (không tạo thêm trường hợp "Quản lý nghỉ nên không ai duyệt"; Giám đốc vẫn không tự duyệt hợp đồng mình tạo) · decided: **mọi người có `contract:approve` trừ người tạo, không ghi `role` ở bước 1; bước "Giám đốc duyệt" `role: giam_doc`; một người không quyết hai bước của cùng hợp đồng** (bạn chốt 2026-09-29)
- [DEC-8] Trường lấy từ khách có bắt buộc không (`ten_khach` `sdt` `email`) · options: cả ba bắt buộc (khách thiếu → hợp đồng bị từ chối, nêu tên, nhân viên bổ sung ở khách) / chỉ `ten_khach` bắt buộc, còn lại in trống / có `{{#if}}` bỏ dòng · recommended: **cả ba bắt buộc** (chữ .docx in cả ba; I3 cấm ô trống) · decided: **cả ba (`ten_khach` `sdt` `email`) bắt buộc** (driver chốt theo đề xuất)
- [DEC-9] Ai đọc được phiên bản cũ · options: mọi người có `contract:read` / chỉ `template:write` · recommended: **`contract:read`** (người xem một hợp đồng cũ phải thấy được chữ của đúng phiên bản đó; mẫu không có dữ liệu cá nhân) · decided: **`contract:read` đọc được bản cũ** (driver chốt theo đề xuất)

### Câu hỏi mở — đã chốt
- [Q-1] `ngay_bat_dau` · decided: **mặc định = ngày lập (`derived:doc_date`), sửa được, không bắt buộc nhập** (bạn chốt 2026-09-29)
- [Q-2] `ngay_hop_dong` · decided: **= ngày lập** (driver chốt theo đề xuất)
- [Q-3] `giam_gia` · decided: **`default` 0; lưu bps 0–10000; nhập % tối đa 2 số lẻ** (driver chốt theo đề xuất)
- [Q-4] `DT14` · decided: **không làm hợp đồng; `ma_goi` chỉ G3/G6/G12; DT14 → 422 nêu `ma_goi`** (bạn chốt 2026-09-29)
- [Q-5] giới hạn · decided: **body 64 KB, 60 trường, 10 bước** (số hợp lý, không phải luật kinh doanh) (driver chốt theo đề xuất)
- [Q-6] một người hai bước · decided: **KHÔNG — mỗi bước một người khác nhau** (bạn chốt 2026-09-29)

## 7. Acceptance — checkable from outside, few, about outcomes
- [AC-1] Sau migrate, Nhân viên/Quản lý/Giám đốc `GET /templates` → đúng 1 mẫu "Hợp đồng cung cấp dịch vụ phần mềm", `current_version.version_no` = 1, `required_fields` gồm `chuc_vu_nguoi_ky`;
  `GET /templates/{id}` trả `approval_policy` (bước 1 "Quản lý duyệt" không có `role` + luật `discount_bps > 1000` → "Giám đốc duyệt" `role: giam_doc`); `ma_goi` có `options` đúng G3/G6/G12; `ngay_bat_dau` có `default: derived:doc_date` — proves FR-2 FR-3 FR-4
- [AC-2] Body v1: không chứa "Ghi chú nội bộ" / "xóa trước khi gửi khách"; tập placeholder trong body = 16 key ở §3.4, mỗi key có trong `fields[]` với `source` đúng bảng; `chuc_vu_nguoi_ky` = `manual` + `required`; `so_bao_gia`/`ngay_bao_gia` không bắt buộc + `all_or_none`;
  `{{#if so_bao_gia}}` bọc dòng "Căn cứ" — proves FR-3, PRB-1
- [AC-3] Giám đốc `POST /templates/{id}/versions` (đổi một câu, `expected_version_no`:1) → 201 `version_no` 2, `GET /templates/{id}` hiện v2 là hiện tại; `GET …?version_no=1` giống từng byte trước khi tạo v2 — proves FR-1 FR-5, OUT-3
- [AC-4] Gửi phiên bản có `{{ten_cong_ty}}` không có trường; trường `required` không có `source`; trường `source:"deal:ten_khach"` và `"subject:zalo"` → 422 `template-check-failed`, `errors[]` liệt kê ĐỦ (`placeholder_without_field`, `required_field_without_source`, `unresolvable_source` kèm key); `GET` sau đó vẫn chỉ có v1, không thêm dòng nhật ký — proves FR-6(a)(b)(c), OUT-4
- [AC-5] Gửi body có "Ghi chú nội bộ (xóa trước khi gửi khách)…" → 422 `internal_note`; body có `<script>` hoặc `onclick` → 422 `html_not_allowed`; `approval_policy` với quyền lạ hoặc `mode:"steps"` không có bước → 422 `policy_invalid`; body 65 KB → 422 `too_large` — proves FR-6(d)(e)(f)
- [AC-6] 2 request `POST …/versions` cùng `expected_version_no`:1 đồng thời → đúng 1 × 201 + 1 × 409 `stale`; kho có đúng phiên bản 1 và 2, không trùng/nhảy `version_no` — proves §4 Two people at once, FR-1
- [AC-7] Cùng `Idempotency-Key` gửi 2 lần → 2 response giống nhau, chỉ có 1 phiên bản mới — proves §4 Failure & retry
- [AC-8] Chưa đăng nhập `GET /templates` → 401; Nhân viên và Quản lý `POST /templates` và `POST …/versions` → 403 Problem+JSON + 1 dòng `permission.denied` (actor, quyền `template:write`, IP) mỗi lần, `GET` cho thấy không có gì đổi; `admin` kỹ thuật `GET /templates` → 403 — proves §5, FR-7, OUT-5
- [AC-9] Mỗi lần `POST` thành công có đúng 1 dòng `template.created` hoặc `template.version_created` (target `template:<id>`, metadata `version_no`, không có body); `GET /audit?action=template.version_created` (Giám đốc) thấy dòng đó — proves FR-7
- [AC-10] OpenAPI của app không có `PATCH`/`PUT`/`DELETE` trên `/templates/**`; thử UPDATE/DELETE trực tiếp trên `template_versions` (test hạ tầng) bị trigger từ chối — proves FR-1, DEC-6
- [AC-11] `POST /templates` mới (mẫu nhỏ hợp lệ) → 201 v1; tên trùng → 409 `duplicate` kèm `existing_id` — proves FR-5, §4 Duplicates

## 8. Trace check (before the STOP)
- [x] every FR points to an OUT (FR-1→3, FR-2→1·2, FR-3→1·2, FR-4→1·3·5, FR-5→3·5, FR-6→4, FR-7→5, FR-8→3) · every AC proves an FR, a "now" edge case, or a DEC
  · every "now" edge case has an AC (Input → AC-4 AC-5; Duplicates → AC-11; Two people → AC-6; Retry → AC-7; Permissions → AC-8; Lifecycle → AC-3 AC-10; Data → AC-4; Money → AC-1 AC-2 (policy); Time n/a ở row này)
- [x] mỗi PRB có OUT: PRB-1→OUT-1·2 · PRB-2→OUT-3·5 · PRB-3→OUT-2 · PRB-4→OUT-1·4 · PRB-5→OUT-3·5
- [x] DEC-1…9 + Q-1…6 đã chốt (2026-09-29); chờ bạn duyệt SPEC (Status vẫn Draft)
