# SPEC-03: Vòng đời hợp đồng — tạo, gửi duyệt, duyệt/từ chối, phát hành có số, hủy + thay thế

Status: Approved 2026-09-29
Intent: docs/intent/INTENT-03.md
Phụ thuộc: SPEC-01 (vai trò, `audit_events` + `auditInsert`, `customers`, `priceListAt`, `todayInVN`, Problem+JSON, `Idempotency-Key`) ·
**SPEC-02 §3.6** (nguồn sự thật cho hình dạng `template_version`; dùng đúng tên): `template_version { id, template_id, version_no, body, fields[{key,label,type,required,source,options?,default?}],
field_rules[{all_or_none:[key,key]}], default_line_items, default_clauses, approval_policy { mode:"combined", steps[{step_no,label,permission,role?}],
rules[{when:{var:"discount_bps",op:"gt",value:1000}, add_steps[{label,permission,role}]}] } }`. Nguồn (`source`): `subject:*` · `price_list:*` · `derived:*` · `issue:number` · `manual`.
SPEC-02 đổi hình dạng này → SPEC-03 phải sửa theo.

## 1. Research (sources + date)
- Domain: `documents.workbook.md` v1.1 §2–§9 (2026-09-29): I1–I9, Rung B cho D1, 12 bẫy §9; owner-box `Hop_Dong_Dich_Vu.docx`
  (15 chỗ trống `{{…}}`, Bên A, tài khoản) + `09_Bang_Gia.xlsx` (giá đã gồm VAT; "Quy định" 1–6).
- D1: `batch()` là một transaction tuần tự, lỗi ở câu nào thì rollback cả chuỗi (developers.cloudflare.com/d1/worker-api/d1-database,
  đã dẫn ở SPEC-01) → mỗi bước chuyển trạng thái + dòng nhật ký đi chung một batch. SQLite: `UNIQUE` coi các `NULL` là khác nhau
  (sqlite.org/lang_createindex.html "Unique Indexes"; sqlite.org/nulls.html) → `UNIQUE(type, series_year, seq)` không va giữa các nháp.
  Subquery trong một câu `UPDATE` thấy cùng một trạng thái DB; D1 chạy một writer mỗi lúc. **TODO(PLAN):** đọc lại 2 trang trên trước khi viết migration.
- RUNWAY: `requirePerm(..., {ownerId})` cho admin bỏ qua và cho phép khi actor == owner — ngược với tách quyền (`docs/rbac.md`, workbook §9) →
  SoD là kiểm tra miền, không dùng guard này. `withIdempotency()` đọc key ở header (`docs/idempotency.md`).

## 2. Requirements
- [FR-1] Tạo hợp đồng (`draft`) từ mẫu cho 1 khách: ghim `template_versions.id` của `current_version` của mẫu; lấy giá gói (`ma_goi`, chỉ G3/G6/G12) theo `doc_date` (giờ VN); server tính thành tiền,
  giảm, tổng, bằng chữ, ngày kết thúc; lưu **snapshot** (mọi giá trị đã trộn + khách + gói + điều khoản + phiên bản mẫu) + `snapshot_hash`.
  Mọi số tiền/ngày suy ra/số/trạng thái do client gửi → 422 → OUT-1
- [FR-2] Thiếu trường bắt buộc (sau khi trộn nguồn `subject`/`price_list`/`derived`/`manual`) → 422 `missing-fields` liệt kê `{key,label}`,
  không tạo dòng nào. Trường không bắt buộc trống → cho phép; `so_bao_gia` + `ngay_bao_gia` trống → không in dòng "Căn cứ" → OUT-2
- [FR-3] Sửa nháp: chỉ người tạo, chỉ `draft`, CAS theo `version`; sửa = sinh lại snapshot (trộn + tính giá lại); giữ phiên bản mẫu đã ghim trừ khi
  `use_latest_template: true` → OUT-1 OUT-5
- [FR-4] Gửi duyệt: chỉ người tạo; tính `approval_policy` của phiên bản đã ghim trên snapshot → tạo các `approval_steps` (luôn ≥1: "Quản lý duyệt"; `discount_bps` > 1000 thêm "Giám đốc duyệt"); **I9**: phải có phép gán người DUY NHẤT cho mọi bước (mỗi bước một người hợp lệ khác nhau, không ai là người tạo), không thì 409 `no-eligible-approver` nêu tên bước không gán được, hợp đồng vẫn
  `draft`, không tạo bước nào → OUT-3
- [FR-5] Duyệt / từ chối: đúng bước hiện tại (bước `waiting` nhỏ nhất), người duyệt có quyền + vai trò của bước, **không phải người tạo** và **chưa quyết bước nào khác của hợp đồng này** (kiểm tra
  miền, áp cho mọi vai trò) → sai thì 403 + `permission.denied` (rule `creator_cannot_approve` / `one_person_one_step`); lưu `snapshot_hash_at_decision`; bước cuối duyệt → `approved`; từ chối (bắt buộc
  ghi chú) → `rejected` (kết thúc) → OUT-3
- [FR-6] Phát hành: `approved` → `issued` + cấp số `HD-{YYYY}-{NNN}` trong CÙNG một câu `UPDATE` (Rung B), năm = ngày phát hành giờ VN; từ chối nếu
  snapshot đã khác lúc duyệt (409 `changed-after-approval`); lưu `rendered_html` + `rendered_hash` một lần → OUT-4 OUT-5
- [FR-7] Hủy: `issued` → `voided` với lý do bắt buộc; giữ số, giữ bản in. "Chép sang nháp mới" từ `rejected` hoặc `voided`: tạo nháp mới (người
  chép là người tạo, dữ liệu nhập chép lại, tính giá theo hôm nay + mẫu hiện hành); với `voided` ghi `replaced_by_id` → OUT-5
- [FR-8] Mọi bước chuyển trạng thái = CAS `UPDATE … WHERE id AND status=:from` + đúng 1 dòng `audit_events` trong cùng `db.batch`; 0 dòng → 409
  `state-conflict`. Tạo + mọi hành động nhận `Idempotency-Key` (lặp lại → kết quả gốc; cùng key khác body → 409) → OUT-4 OUT-6
- [FR-9] Đọc: danh sách (lọc trạng thái/khách/người tạo, cursor ≤50, đếm theo 5 tab), chi tiết (+ dòng thời gian từ các bước), bản in HTML
  (nháp: dựng từ snapshot + dấu "NHÁP"; đã phát hành: đúng `rendered_html` đã lưu), "Chờ tôi duyệt", nhật ký theo hợp đồng → OUT-1 OUT-3 OUT-6
- [FR-10] Sự kiện `contract.created/submitted/approved/rejected/issued/voided` qua 1 dispatcher trong tiến trình; listener hôm nay chỉ ghi log,
  không bao giờ làm hỏng request → OUT-6

## 3. Design

### 3.1 Dữ liệu (migration mới, chỉ thêm)
- `contracts`: `id` ULID · `type` TEXT NOT NULL CHECK = `'contract'` (tiền tố `HD`) · `template_id` · `template_version_id` · `customer_id` ·
  `source_contract_id` NULL (chép từ) · `status` CHECK IN (`draft`,`pending`,`approved`,`rejected`,`issued`,`voided`) · `created_by` · `doc_date`
  TEXT `YYYY-MM-DD` · `snapshot` TEXT JSON · `snapshot_hash` TEXT (SHA-256 hex của JSON chuẩn hóa, khóa sắp xếp) · `customer_name` + `total`
  (chép từ snapshot, chỉ để danh sách 1 query, ghi cùng lúc với snapshot) · `version` INTEGER (CAS sửa nháp) · `series_year` INTEGER NULL ·
  `seq` INTEGER NULL · `number` TEXT NULL · `issue_token` TEXT NULL · `issued_by` · `issued_at` · `rendered_html` NULL · `rendered_hash` NULL ·
  `submitted_at` · `decided_at` · `voided_by` · `voided_at` · `void_reason` · `replaced_by_id` NULL · `created_at` · `updated_at` (unix giây).
  - Ràng buộc: `UNIQUE(type, series_year, seq)` (NULL không va; có thể viết partial `WHERE seq IS NOT NULL` cho rõ) · UNIQUE `number` ·
    CHECK `(status IN ('issued','voided')) = (seq IS NOT NULL)` · CHECK `status <> 'voided' OR void_reason IS NOT NULL`.
  - Index: `(type, status, updated_at)` · `(customer_id)` · `(created_by)`.
  - Không bao giờ ghi đè: `snapshot`/`snapshot_hash` sau `draft`; `seq`/`number`/`rendered_*` sau khi có. Không xóa cứng dòng nào.
- `approval_steps`: `id` · `contract_id` · `step_no` · `label` · `required_permission` · `required_role` NULL · `status` CHECK IN
  (`waiting`,`approved`,`rejected`) · `decided_by` · `decided_at` · `note` · `snapshot_hash_at_decision` · `created_at`.
  UNIQUE `(contract_id, step_no)` · index `(status, required_permission)`.
- Snapshot (JSON, ≤256 KB): `template {id, version_id, version_no}` · `customer {id, name, contact_person, phone, email, tax_code, address}` ·
  `package {code, name, duration_value, duration_unit, unit_price, effective_from}` · `inputs` (các trường `manual` đã nhập) · `fields` (mọi
  key → giá trị đã trộn, đã định dạng để in) · `lines[{description, qty, unit_price, discount_bps, amount}]` · `gross`, `discount_amount`,
  `total`, `total_words` · `dates {doc_date, start, end}` · `clauses[]` · `policy` (bản chép `approval_policy` của phiên bản).
- Cấu hình số (hằng số trong code, không có bảng ở Rung B): `contract` → `HD`, pad 3, reset theo năm.

### 3.2 Quy tắc tính (hàm thuần, `apps/api/src/domain/contract/`)
- Nguồn từng trường (đúng `source` ở SPEC-02 §3.4): `subject:*` ← khách (`ten_cua_hang`=name, `ten_khach`=contact_person, `sdt`=phone,
  `email`) · `price_list:*` ← `ten_goi` (theo `ma_goi` + `doc_date`) · `manual` ← `ma_goi`, `so_cua_hang`, `giam_gia` (bps, `default` 0), `chuc_vu_nguoi_ky`, `so_bao_gia`, `ngay_bao_gia`,
  `ngay_bat_dau` (`default: derived:doc_date`, sửa được) · `derived:*` ← `ngay_hop_dong` (= `doc_date`), `ngay_ket_thuc` (`contract_end`), `tong_tien` (`total`), `tong_tien_bang_chu` (`total_in_words`), `discount_bps` (từ `giam_gia`);
  `issue:number` ← `so_hop_dong` (chỉ có lúc phát hành). Luật đi đôi: `field_rules` `all_or_none [so_bao_gia, ngay_bao_gia]`.
- Giá: `unit_price` = dòng bảng giá của `ma_goi` đang áp dụng ngày `doc_date` (`priceListAt`); `ma_goi` ngoài G3/G6/G12 (gồm `DT14`) hoặc không có giá ngày đó → 422 nêu `ma_goi`.
- Tiền (số nguyên đồng, giảm theo basis points `discount_bps` 0–10000): `gross = unit_price × so_cua_hang` (`so_cua_hang` 1–999) ·
  `discount_amount = floor((gross × discount_bps + 5000) / 10000)` (`discount_bps` = `giam_gia`, 0–10000; giảm 100% → total 0đ, cho phép) (half-up, số nguyên, không dùng float) · `total = gross − discount_amount`.
  Một dòng hàng duy nhất: `{ten_goi, qty = so_cua_hang, unit_price, discount_bps, amount = total}`. VAT đã nằm trong giá, không có dòng VAT.
  Kiểm: 2.700.000 × 1 − 5% = **2.565.000**; 4.800.000 × 2 − 15% = **8.160.000**.
- Bằng chữ: `amountInWords(2565000)` = "Hai triệu năm trăm sáu mươi lăm nghìn đồng"; quy ước "lăm/mốt/tư/**lẻ**" (105.000 → "Một trăm lẻ năm nghìn đồng") — DEC-6.
- Ngày: `doc_date` = `todayInVN(now)` lúc tạo và mỗi lần sửa nháp, đóng băng lúc gửi duyệt (DEC-4); `ngay_bat_dau` mặc định = `doc_date` (theo `doc_date` mới khi sửa nháp, trừ khi người tạo đã nhập tay) · `ngay_ket_thuc = ngay_bat_dau + N tháng − 1 ngày` (gói `month`); tháng đích thiếu ngày → DEC-5 (31/08 + 6 tháng → **28/02/2027**).
  Kiểm: G6 bắt đầu 28/09/2026 → **27/03/2027**; G12 28/09/2026 → **27/09/2027**. Gói `day` (DT14) không làm hợp đồng (DEC-3).
- Duyệt: `requiredSteps(policy, snapshot)` → `steps[]` cố định ("Quản lý duyệt", không `role`) + `add_steps` của mọi `rules[]` có `when` đúng trên snapshot (`discount_bps` > 1000 → "Giám đốc duyệt", `role: giam_doc`), `step_no` cấp theo thứ tự (10,00% đúng → 1 bước).
  Không đọc được biến → "cần duyệt" (fail-closed). `eligibleAssignment(steps, users, creator)` → bộ ghép phân biệt (đường tăng theo `step_no`; bước đầu tiên không thêm được là bước bị nêu tên) — dùng cho I9.
- `canTransition(from, to)`: `draft→pending` · `pending→approved|rejected` · `approved→issued` · `issued→voided`. `draft→issued` không bao giờ xảy ra
  ở app này vì IDEA: luôn Quản lý duyệt → mọi hợp đồng có ≥1 bước (giữ nhánh này trong hàm, nhưng policy không bao giờ trả 0 bước).
- `formatNumber('HD', 2026, 1, 3)` = `HD-2026-001` (quá 999 → `HD-2026-1000`, không cắt).
- Bản in: `renderHtml(versionBody, snapshot, number?)` — mọi giá trị được **escape HTML** trước khi chèn; khối "Căn cứ" chỉ in khi có
  `so_bao_gia` (`{{#if so_bao_gia}}…{{/if}}`, SPEC-02 §3.2); còn `{{…}}` nào sau khi trộn (trừ `so_hop_dong` ở nháp) → 422 `unresolved-placeholder`,
  kiểm lúc tạo/sửa nháp và lúc phát hành. Nháp in "Số: (chưa có số)" + dấu "NHÁP". Định dạng: tiền `2.565.000`, ngày `dd/mm/yyyy`, giảm `5` / `7,5`.

### 3.3 Máy trạng thái + quy tắc từng bước (mỗi bước: CAS + 1 dòng nhật ký trong cùng `db.batch`)
| Bước | Ai | Kiểm (thứ tự) | Ghi (một batch) | Nhật ký `action` · metadata |
|---|---|---|---|---|
| tạo | `contract:write` | schema → khách tồn tại → gói có giá ngày đó → trộn: thiếu → 422 → còn `{{}}` → 422 | INSERT contracts(draft) + audit | `contract.created` · {to:draft, source_id?} |
| sửa nháp | `contract:write` + là người tạo | status=draft, `expected_version` | UPDATE … WHERE id AND status='draft' AND version=:v AND created_by=:actor | `contract.updated` · {fields đổi (tên, không giá trị)} |
| gửi duyệt | `contract:submit` + là người tạo | tính bước → **I9** (dưới) | UPDATE draft→pending (CAS) + INSERT các step + audit | `contract.submitted` · {from, to, steps} |
| duyệt | quyền + vai trò của bước | người duyệt ≠ người tạo → 403 + `permission.denied` {rule `creator_cannot_approve`}; chưa quyết bước nào khác của hợp đồng → nếu đã quyết: 403 + `permission.denied` {rule `one_person_one_step`}; bước hiện tại; hash | UPDATE step WHERE status='waiting' AND step_no = bước nhỏ nhất còn waiting AND contract pending; nếu bước cuối: UPDATE contract pending→approved | `contract.approved` · {step_no, label, from, to} |
| từ chối | như duyệt; `note` bắt buộc | như duyệt | UPDATE step→rejected + contract pending→rejected | `contract.rejected` · {step_no, from, to} (lý do nằm ở step, không ở log) |
| phát hành | `contract:issue` (DEC-1, DEC-2) | — (mọi thứ nằm trong WHERE) | Rung B (dưới) + audit INSERT…SELECT theo `issue_token`; rồi CAS lưu `rendered_html/hash` | `contract.issued` · {from, to, number} |
| hủy | `contract:issue` | `reason` không rỗng | UPDATE issued→voided | `contract.voided` · {from, to, number} |
| chép sang nháp | `contract:write` | nguồn `rejected`/`voided`; voided: `replaced_by_id IS NULL` | INSERT nháp mới + (voided) UPDATE nguồn SET replaced_by_id WHERE replaced_by_id IS NULL + audit | `contract.created` · {source_id} |
- **I9 — người hợp lệ của một bước:** user `status = active`, có vai trò mang `required_permission`, và (nếu bước có `required_role`) có đúng vai trò
  đó, và `id ≠ created_by`. Bước 1 "Quản lý duyệt" không có `role` → mọi active có `contract:approve` trừ người tạo (Quản lý hoặc Giám đốc); bước "Giám đốc duyệt" → chỉ `giam_doc`. `admin` không có `contract:approve` nên không bao giờ hợp lệ.
  **Mỗi bước một người khác nhau:** lúc gửi duyệt phải tồn tại phép gán người DUY NHẤT cho tất cả bước (`eligibleAssignment`). Ví dụ 1 Giám đốc + 1 Quản lý: Quản lý tạo hợp đồng >10% → bước 1 {Giám đốc}, bước 2 {Giám đốc} → không gán được → 409 nêu "Giám đốc duyệt"; Nhân viên tạo → bước 1 {Quản lý, Giám đốc}, bước 2 {Giám đốc} → gán được. Không gán được → 409 `no-eligible-approver`
  `{step_no, label, reason}`, detail tiếng Việt: "Bước 'Giám đốc duyệt' không có ai khác duyệt được — người tạo không tự duyệt và một người không duyệt hai bước. Cách xử lý: người
  khác tạo hợp đồng này, hoặc thêm một người có vai trò Giám đốc." Đây là đọc-rồi-kiểm (không phải đua trạng thái); người bị gỡ vai trò sau khi gửi
  → hợp đồng chờ, ghi ở §4 (later).
- **Tách quyền (SoD):** `actor.id !== contract.created_by` và actor chưa quyết bước nào khác của hợp đồng (`approval_steps.decided_by`) kiểm trong command duyệt/từ chối, áp cho mọi vai trò; KHÔNG dùng `requirePerm({ownerId})`. Kiểm `one_person_one_step` trong cùng câu CAS của bước (`NOT EXISTS (… decided_by=:actor)`) để không đua.
  Refusal: 403 Problem+JSON slug `forbidden` + `rule: "creator_cannot_approve"` | `"one_person_one_step"` + `permission.denied` {actor, rule, target `contract:<id>`, ip}; hợp đồng không đổi.
- **Hash:** duyệt ghi `snapshot_hash_at_decision = contracts.snapshot_hash`; phát hành chỉ thắng nếu mọi bước `approved` và hash trùng (nằm trong WHERE).
- **Rung B — cấp số (một câu, không có bảng đếm):**
  `UPDATE contracts SET status='issued', issue_token=:tok, issued_by=:actor, issued_at=:now, updated_at=:now, series_year=:y,
  seq=(SELECT COALESCE(MAX(seq),0)+1 FROM contracts WHERE type='contract' AND series_year=:y),
  number=printf('HD-%d-%03d', :y, (SELECT COALESCE(MAX(seq),0)+1 FROM contracts WHERE type='contract' AND series_year=:y))
  WHERE id=:id AND status='approved' AND NOT EXISTS (SELECT 1 FROM approval_steps s WHERE s.contract_id=:id AND (s.status<>'approved'
  OR s.snapshot_hash_at_decision<>contracts.snapshot_hash))` → cùng batch: `INSERT INTO audit_events … SELECT … FROM contracts WHERE id=:id AND
  issue_token=:tok` → đọc lại. 0 dòng → 409 (`state-conflict`, hoặc `changed-after-approval` khi status vẫn `approved` mà hash lệch). `:y` = năm của
  `todayInVN(now)`. Hợp đồng hủy giữ `seq` nên MAX đúng; UNIQUE là lưới cuối. Sau đó `UPDATE … SET rendered_html, rendered_hash WHERE id AND
  issue_token=:tok AND rendered_html IS NULL`. Chết giữa hai bước → `GET /render` của hợp đồng `issued` mà `rendered_html` NULL dựng lại (tất định
  từ snapshot + number) và lưu bằng cùng CAS; không bao giờ bỏ phát hành.

### 3.4 Screens / flow
Không có giao diện ở row này (row 4); kiểm qua `/docs`. Dòng thời gian ở `GET /contracts/{id}`: Tạo → Gửi duyệt → từng bước Duyệt/Từ chối → Phát
hành → Hủy, lấy từ cột thời gian + `approval_steps` (Nhân viên xem được, không cần `audit:read`). Lỗi trả detail tiếng Việt để row 4 in thẳng.

### 3.5 API (contract-first; ghi cần `Origin` + `X-Requested-With: fetch`; mọi POST nhận header `Idempotency-Key`; lỗi Problem+JSON; 422 validation)
| Method + path | Guard | Request → Response | Lỗi |
|---|---|---|---|
| `POST /contracts` | `contract:write` | `{template_id, customer_id, values:{ma_goi, so_cua_hang, giam_gia?, chuc_vu_nguoi_ky, ngay_bat_dau?, so_bao_gia?, ngay_bao_gia?}}` (khóa `values` = `key` trường SPEC-02; `giam_gia` = bps nguyên 0–10000, mặc định 0; `ngay_bat_dau` mặc định = ngày lập) → 201 contract | 422 `validation` (lạ/cấm: `total`,`unit_price`,`number`,`status`,…) · 422 `missing-fields` · 422 `unresolved-placeholder` · 409 idempotency |
| `GET /contracts?status&customer_id&created_by&cursor&limit≤50` | `contract:read` (cả phòng) | `{items:[{id, number\|null, status, customer_name, total, created_by, created_by_name, updated_at}], next_cursor, counts:{draft,pending,approved,issued,rejected,voided}}` | 401 403 422 |
| `GET /contracts/{id}` | `contract:read` | contract + snapshot + `steps[]` + `timeline[]` + `can:{edit,submit,approve,reject,issue,void,copy}` (cho 🔒 ở row 4) | 404 |
| `PATCH /contracts/{id}` | `contract:write` + người tạo | `{expected_version, customer_id?, values?, use_latest_template?}` → 200 | 403 + `permission.denied` (không phải người tạo) · 409 `state-conflict` · 409 `stale` · 422 |
| `POST /contracts/{id}/submit` | `contract:submit` + người tạo | `{}` → 200 contract(pending, steps) | 403 · 409 `no-eligible-approver` · 409 `state-conflict` |
| `POST /contracts/{id}/approve` | `contract:approve` + quyền/vai trò bước + ≠ người tạo | `{note?}` → 200 | 403 (`creator_cannot_approve` / `one_person_one_step` / thiếu quyền / sai vai trò) · 409 `state-conflict` · 409 `changed-after-approval` |
| `POST /contracts/{id}/reject` | như approve | `{note}` (bắt buộc) → 200 contract(rejected) | 403 · 409 · 422 |
| `POST /contracts/{id}/issue` | `contract:issue` (Quản lý + Giám đốc, DEC-1; người tạo được, DEC-2) | `{}` → 200 contract(issued, number) | 403 · 409 `state-conflict` · 409 `changed-after-approval` |
| `POST /contracts/{id}/void` | `contract:issue` | `{reason}` → 200 contract(voided) | 403 · 409 · 422 |
| `POST /contracts/{id}/copy` | `contract:write` | `{}` → 201 contract(draft, source_contract_id) | 409 (nguồn không phải rejected/voided; voided đã có thay thế) · 422 (dữ liệu hôm nay thiếu trường / gói hết giá) |
| `GET /contracts/{id}/render` | `contract:read` | `text/html; charset=utf-8`; header `ETag` = `rendered_hash` khi đã phát hành (hợp đồng `voided`: chèn dải "ĐÃ HỦY" lúc trả, bytes lưu + hash không đổi — DEC-9); CSP `default-src 'none'; style-src 'unsafe-inline'` | 404 |
| `GET /contracts/{id}/audit?cursor&limit≤50` | `audit:read` | `{items, next_cursor}` (target `contract:<id>`, dùng lại DAO của `GET /audit`) | 403 404 |
| `GET /approvals/mine?cursor&limit≤50` | `contract:approve` | bước hiện tại của hợp đồng `pending` mà người gọi hợp lệ (quyền + vai trò, không phải người tạo, chưa quyết bước nào của hợp đồng đó) — 1 query join | 403 |
- Problem slug mới (gạch nối): `missing-fields` (kèm `missing_fields[{key,label}]`) · `unresolved-placeholder` (kèm `placeholders[]`) ·
  `no-eligible-approver` (kèm `step_no`, `label`) · `state-conflict` (kèm `current_status`) · `changed-after-approval`. Dùng lại `stale`,
  `forbidden`, `validation`, `idempotency-conflict`.
- Chép: `POST /contracts/{id}/copy` là tên đề xuất cho "chép sang nháp mới" (workbook không đặt tên).

## 4. Edge cases — the human marks each: now · later (why) · n/a
| Category | Case here | Decision |
|---|---|---|
| Input | trường lạ/cấm (`total`, `unit_price`, `number`, `status`, `ngay_ket_thuc`) → 422 · `so_cua_hang` số nguyên 1–999 (Q-B; trần hợp lý, không phải luật kinh doanh) · `giam_gia` (bps) 0–10000 · `ma_goi` ∉ {G3,G6,G12} (gồm DT14) → 422 nêu `ma_goi` · ngày ISO thật · `chuc_vu_nguoi_ky` chỉ khoảng trắng = trống · có `so_bao_gia` mà thiếu `ngay_bao_gia` (hoặc ngược lại) → 422 (DEC-8) · tên khách có `<script>` → in thành chữ | now |
| Duplicates & identity | bấm tạo 2 lần cùng key → 1 hợp đồng · cùng key khác body → 409 · 2 hợp đồng cho cùng khách cùng gói → cho phép (không có luật cấm) · chép 1 hợp đồng hủy 2 lần → lần 2 409 | now |
| Two people at once | 10 phát hành song song 10 hợp đồng → 001…010 · 5 phát hành 1 hợp đồng → 1 số · duyệt + từ chối cùng lúc → 1 thắng, 1 409 · 2 tab sửa nháp → 409 `stale` · hủy + phát hành đua → CAS | now |
| Failure & retry | batch lỗi → không đổi gì, không mất số · chết giữa phát hành và lưu bản in → `/render` dựng lại đúng · listener lỗi không làm hỏng request · lặp lại cùng key → kết quả gốc | now |
| Permissions / not logged in | chưa đăng nhập → 401 · Nhân viên duyệt → 403 + `permission.denied` · người tạo tự duyệt (cả Giám đốc) → 403 `creator_cannot_approve` · người đã duyệt bước 1 duyệt tiếp bước 2 → 403 `one_person_one_step` · người khác sửa nháp → 403 · Quản lý duyệt bước Giám đốc → 403 · admin mọi endpoint ghi → 403 · bị gỡ vai trò → request kế tiếp mất quyền (SPEC-01) | now |
| Permissions — người duyệt biến mất sau khi gửi (nghỉ việc) hoặc mất khả năng gán duy nhất (người đã duyệt bước 1 là người duy nhất duyệt bước 2) | hợp đồng chờ mãi; cách thoát: thêm người vai trò đó · xem DEC-10 (đề xuất chặn sớm) | later — cần luật "rút lại về nháp", hỏi bạn |
| Lifecycle | sửa `pending`/`approved`/`issued` → 409 · từ chối/hủy là kết thúc, không xóa · hủy giữ số · xóa nháp | now · xóa nháp: later (workbook cho phép xóa mềm; roadmap row 3 không có) |
| Money | số nguyên, half-up, không float · giảm 10,00% → 1 bước; 10,01% → 2 bước · giảm 0–100%, tổng 0đ (giảm 100%) cho phép (Q-C; >10% vẫn cần Giám đốc) · giá đổi giữa lúc tạo và phát hành → giữ giá snapshot | now |
| Time / dates | `doc_date`, năm của số = giờ VN: phát hành 00:30 ngày 01/01/2027 giờ VN → `HD-2027-001` · tạo 30/06 giá cũ, sửa nháp 01/07 → giá mới (DEC-4) · 31/08 + 6 tháng → 28/02/2027 (DEC-5) · `ngay_bat_dau` mặc định theo `doc_date` mới khi sửa nháp, trừ khi đã nhập tay | now |
| Template | tạo v2 sau khi có nháp v1 → nháp giữ v1 tới khi `use_latest_template`; hợp đồng đã phát hành không đổi · hợp đồng `pending` giữ policy lúc gửi | now |

## 5. Security
- Who may do what: bảng §3.5; ma trận quyền seed SPEC-01 (`giam_doc`, `quan_ly`: read/write/submit/approve/issue; `nhan_vien`: read/write/submit;
  `admin`: không có `contract:*`). SoD và "chỉ người tạo sửa/gửi" là kiểm tra miền, không nhờ ownership của `requirePerm`, áp cho mọi vai trò.
- Personal data: SĐT/email/MST/địa chỉ của khách nằm trong `snapshot` + `rendered_html` → chỉ người có `contract:read`; không có endpoint công khai;
  metadata nhật ký chỉ có id, số, trạng thái, bước, tên trường — không giá trị cá nhân, không số tiền; lý do từ chối/hủy lưu ở dòng hợp đồng/step.
- Abuse: tự duyệt (403 + log) · sửa nháp người khác (403) · gửi `total` giả (422) · XSS qua tên khách (escape + CSP không script ở `/render`) ·
  đua số (Rung B + UNIQUE) · đoán id liệt kê dữ liệu (ULID; đọc cả phòng là thiết kế — §2b "team-wide read") · request lớn (bodyLimit, snapshot ≤256 KB) ·
  dùng `approved` cũ sau khi snapshot đổi (hash trong WHERE).

## 6. Decisions (the human decides)
Workbook §2b đã chốt ở IDEA/INTENT: số lúc phát hành · chuỗi theo loại + năm · policy lưu theo phiên bản mẫu · duyệt và phát hành là 2 thao tác ·
tách quyền nghiêm (không ngoại lệ) · mỗi hợp đồng duyệt riêng · hủy + thay thế · phiên bản mới, nháp giữ phiên bản · HTML in được lưu lúc phát hành ·
số nguyên đồng, VAT trong giá, half-up · giá theo bảng giá ngày lập · cả phòng đọc, chỉ người tạo sửa nháp · từ chối = kết thúc + chép.
Còn mở:
- [DEC-1] Ai phát hành · options: Quản lý + Giám đốc (MAP M3, seed SPEC-01, mockup ma trận) / chỉ Giám đốc (CLAUDE.md "the director issues") ·
  recommended: **Quản lý + Giám đốc** (đã seed; mockup "OK, chờ khách ký rồi phát hành" do Quản lý) · decided: **Quản lý + Giám đốc (`contract:issue` như seed)** (bạn chốt 2026-09-29)
- [DEC-2] Người tạo có được phát hành hợp đồng của chính mình (sau khi người khác đã duyệt) · options: được / không · recommended: **được** (workbook
  §6 chỉ cấm tự duyệt; việc duyệt đã do người khác) · decided: **người tạo được phát hành hợp đồng của mình khi đã được người khác duyệt** (driver chốt theo đề xuất)
- [DEC-3] Gói Dùng thử DT14 (0đ, 14 ngày) có làm hợp đồng không · options: chặn (422) / cho, ngày kết thúc = bắt đầu + 13 ngày · recommended: **chặn**
  (hỏi — không có nguồn nào nói hợp đồng cho dùng thử) · decided: **chặn DT14: `ma_goi` chỉ G3/G6/G12, DT14 → 422 nêu `ma_goi`** (bạn chốt 2026-09-29)
- [DEC-4] `doc_date`/`ngay_hop_dong` = ngày tạo, sinh lại mỗi lần sửa nháp, đóng băng lúc gửi duyệt · options: như vậy / = ngày phát hành (giá vẫn theo
  ngày tạo) / nhập tay · recommended: **ngày tạo, cập nhật khi sửa nháp** (Quy định 3 "ngày lập chứng từ") · decided: **`doc_date` = ngày tạo, làm mới khi sửa nháp, đóng băng lúc gửi duyệt** (driver chốt theo đề xuất) (SPEC-02 Q-2 cùng kết luận)
- [DEC-5] Ngày kết thúc khi ngày bắt đầu không có ở tháng đích (31/08 + 6 tháng) · options: ngày trước "ngày kỷ niệm" (→ 28/02/2027) / kẹp cuối tháng rồi
  trừ 1 (→ 27/02/2027) · recommended: **28/02/2027** (khách không mất ngày) · decided: **kỷ niệm không tồn tại → ngày cuối tháng đích: 31/08/2026 + 6 tháng → 28/02/2027** (driver chốt theo đề xuất)
- [DEC-6] Bằng chữ · options: "linh" hay "lẻ"; viết hoa chữ đầu, kết thúc "đồng" · recommended: **"linh", viết hoa chữ đầu, "…đồng"** (bạn chọn "lẻ" thay) (ví dụ workbook
  "Hai triệu năm trăm sáu mươi lăm nghìn đồng") · decided: **"lẻ" (một trăm lẻ năm nghìn), viết hoa chữ đầu, kết thúc "đồng"** (bạn chốt 2026-09-29)
- [DEC-7] "Chép sang nháp mới" tính giá theo hôm nay + mẫu hiện hành (hợp đồng mới, Quy định 6 "làm chứng từ mới") · options: như vậy / giữ nguyên số tiền cũ ·
  recommended: **theo hôm nay** · decided: **"chép sang nháp mới" tính giá theo ngày lập mới + mẫu hiện hành** (driver chốt theo đề xuất)
- [DEC-8] `so_bao_gia` và `ngay_bao_gia`: bắt buộc đi đôi · options: đi đôi (thiếu một → 422) / độc lập · recommended: **đi đôi** (dòng "Căn cứ" cần cả hai) · decided: **`so_bao_gia` + `ngay_bao_gia` đi đôi (`all_or_none` ở SPEC-02)** (driver chốt theo đề xuất)
- [DEC-9] Bản in hợp đồng đã hủy · options: trả đúng bytes đã lưu + header `X-Contract-Status: voided` (row 4 hiện dải "ĐÃ HỦY") / chèn dải "ĐÃ HỦY" lúc trả
  (bytes lưu không đổi, hash tính trên bytes lưu) · recommended: **chèn dải lúc trả** (in ra giấy vẫn thấy đã hủy) · decided: **chèn dải "ĐÃ HỦY" lúc trả bản in; bytes lưu + hash không đổi** (driver chốt theo đề xuất)
- [DEC-10] — deadlock sau khi một bước đã duyệt · vấn đề: I9 chỉ kiểm lúc gửi. Nhân viên tạo hợp đồng >10% với 1 Giám đốc + 1 Quản lý: nếu Giám đốc duyệt bước 1 (được phép), bước 2 chỉ Giám đốc mà Giám đốc đã quyết bước 1 → hợp đồng kẹt `pending` · options: (a) `decideStep` từ chối (409 `would-block-later-step`, nêu bước) khi sau quyết định các bước còn lại không còn phép gán phân biệt; (b) chấp nhận, xử lý ở "rút lại về nháp" (later) · recommended: **(a)** (chặn tại nguồn, cùng hàm `eligibleAssignment`) · decided: **(a)** (bạn chốt 2026-09-29) — cần 1 AC: 1 GĐ + 1 QL, NV tạo >10%, GĐ duyệt bước 1 → 409 `would-block-later-step`, vẫn `pending`, QL duyệt bước 1 được
- Câu hỏi dữ kiện đã chốt: [Q-A] `ngay_bat_dau` mặc định = ngày lập, sửa được, không bắt buộc nhập (bạn chốt 2026-09-29) · [Q-B] số cửa hàng 1–999 (trần hợp lý, không phải luật kinh doanh) (driver chốt theo đề xuất) · [Q-C] giảm 0–100%, giảm 100% (tổng 0đ) cho phép; >10% vẫn cần Giám đốc (driver chốt theo đề xuất).

## 7. Acceptance — checkable from outside (workbook §7 chuyển sang app này: chỉ `contract`, chuỗi `HD`, dữ liệu Nhật Minh, ngày 28/09/2026 giờ VN)
Test (tên = tên workbook; mỗi cái là 1 test owner ở biên API, trừ các hàm thuần ghi rõ):
- [AC-1] `draft_has_no_number` — tạo → `number`, `seq` NULL; danh sách trả `number: null`, status `draft` — FR-1, I1
- [AC-2] `issue_assigns_next_number` — phát hành 2 hợp đồng → `HD-2026-001`, `HD-2026-002`; một hợp đồng bị từ chối xen giữa không tốn số — FR-6, I1
- [AC-3] `series_is_per_type_and_year` (chỉnh: chỉ HD) — phát hành lúc 00:30 01/01/2027 giờ VN (= 17:30 31/12/2026 UTC) → `HD-2027-001` trong khi 2026 đã có số — FR-6, §4 Time
- [AC-4] `missing_required_field_refuses` — thiếu `chuc_vu_nguoi_ky` → 422 `missing-fields` `[{key:"chuc_vu_nguoi_ky", label:"Chức vụ người ký"}]`, 0 dòng mới — FR-2, I3
- [AC-5] `optional_missing_field_allowed` — bỏ `so_bao_gia`/`ngay_bao_gia` → tạo được, bản in không có dòng "Căn cứ"; không còn `{{` nào — FR-2
- [AC-6] `server_prices_from_price_list_on_doc_date` — body có `total`/`unit_price` → 422; G6 tạo ngày 30/06/2026 → 2.400.000/cửa hàng, ngày 28/09/2026 → 2.700.000 — FR-1, I4
- [AC-7] `amount_math_is_integer` (hàm thuần + API) — G6 · 1 · −5% = 2.565.000 "Hai triệu năm trăm sáu mươi lăm nghìn đồng"; G12 · 2 · −15% = 8.160.000; "lẻ": 105.000 → "Một trăm lẻ năm nghìn đồng"; G6 28/09/2026 → 27/03/2027; G12 → 27/09/2027; 31/08/2026 + G6 → 28/02/2027; `ma_goi`=DT14 → 422 nêu `ma_goi`; `ngay_bat_dau` bỏ trống → = ngày lập — FR-1, DEC-3/5/6
- [AC-8] `snapshot_isolated_from_live_data` — sau khi tạo: đổi tên + SĐT khách, tạo mẫu v2 → `GET /render` của nháp không đổi (giá không sửa được trong app — kiểm giá bằng AC-6) — FR-1, I2
- [AC-9] `creator_cannot_approve` — Quản lý tạo hợp đồng −5% + gửi (có Giám đốc để qua I9) + tự duyệt → 403, vẫn `pending`, đúng 1 dòng `permission.denied` {rule `creator_cannot_approve`} — FR-5, I5
- [AC-10] `approval_is_per_document` (chỉnh: không có báo giá) — hợp đồng chép từ hợp đồng bị từ chối (đã có bước Quản lý duyệt trước đó) vẫn phải gửi duyệt lại từ đầu; bước cũ không chuyển sang — FR-7, I5
- [AC-11] `threshold_rule_selects_approval` (chỉnh theo IDEA: không có "không cần duyệt") — −5% → 1 bước "Quản lý duyệt"; −10% (`giam_gia`=1000) → 1 bước; −10,01% (1001) → 2 bước; −15% → 2 bước ("Quản lý duyệt", "Giám đốc duyệt") — FR-4
- [AC-12] `multi_step_in_order` (chỉnh: 2 bước) — −15%: Giám đốc duyệt trước bước Quản lý → 409; Quản lý duyệt → vẫn `pending`; Giám đốc từ chối → `rejected`, không số — FR-5
- [AC-13] `submit_refused_when_no_eligible_approver` (chỉnh: không có "Hợp tác đại lý") — Giám đốc duy nhất tạo hợp đồng −15% và gửi → 409 `no-eligible-approver` nêu "Giám đốc duyệt", vẫn `draft`, 0 step; thêm 1 người vai trò Giám đốc → gửi được và người đó duyệt được bước 2 — FR-4, I9
- [AC-13b] `submit_needs_distinct_approvers` — chỉ có 1 Giám đốc + 1 Quản lý: Quản lý tạo hợp đồng −15% và gửi → 409 `no-eligible-approver` nêu "Giám đốc duyệt" (bước 1 {Giám đốc}, bước 2 {Giám đốc}: không có phép gán phân biệt), vẫn `draft`, 0 step; Nhân viên tạo cùng hợp đồng → gửi được (bước 1 gán Quản lý, bước 2 Giám đốc) — FR-4, I9
- [AC-13c] `one_person_one_step` — hợp đồng −15% (Nhân viên tạo, đủ người): Giám đốc A duyệt bước 1, rồi A duyệt bước 2 → 403 + 1 dòng `permission.denied` {rule `one_person_one_step`}, vẫn `pending`; Giám đốc B duyệt bước 2 → `approved` — FR-5
- [AC-14] `pending_is_locked` — PATCH hợp đồng `pending` → 409 `state-conflict`; mỗi step đã duyệt có `snapshot_hash_at_decision` = `snapshot_hash` — FR-3, I2
- [AC-15] `issued_is_immutable_void_keeps_number` — PATCH hợp đồng `issued` → 409; hủy (lý do) → `voided`, số giữ; chép → nháp mới, duyệt, phát hành → số kế tiếp; nguồn có `replaced_by_id` — FR-7, I6
- [AC-16] `every_move_writes_one_audit_row` — tạo → gửi → duyệt → phát hành = 4 dòng `contract.*` có from/to (+1 với 2 bước); hủy +1 — FR-8, I7
- [AC-17] `idempotent_create_and_issue` — cùng key 2 lần cho tạo và cho phát hành → 1 hợp đồng, 1 số; cùng key khác body → 409 — FR-8, I8
Probe (dán output thật trong PROOF):
- [AC-18] Đua số: 10 hợp đồng `approved` → 10 `POST /issue` đồng thời → 10× 200, `HD-2026-001…010`; `SELECT COUNT(*), COUNT(DISTINCT seq), MIN(seq), MAX(seq)
  FROM contracts WHERE type='contract' AND series_year=2026` → `10|10|1|10`. Rồi 5 `POST /issue` đồng thời vào 1 hợp đồng → đúng 1 số, còn lại 409 (hoặc replay); MAX tăng đúng 1 — FR-6
- [AC-19] Thiếu trường: như AC-4, rồi thêm giá trị → tạo được, bản in có chức vụ đúng như nhập — FR-2
- [AC-20] Tự duyệt: như AC-9; lặp lại bằng Giám đốc (tạo −15%, có Giám đốc thứ 2) tự duyệt bước 2 → 403; admin gọi approve → 403 (thiếu `contract:approve`); Nhân viên duyệt
  hợp đồng người khác → 403 + `permission.denied` {permission `contract:approve`} — FR-5, §5
- [AC-21] Dữ liệu sống: phát hành, lưu `rendered_hash`; đổi tên + SĐT khách, thêm dòng giá G6 mới hiệu lực trong test → `/render` hash Y HỆT, tên cũ, SĐT cũ, 2.565.000 — FR-6, I2
- [AC-22] Sửa mẫu: phát hành trên v1; tạo v2 đổi một điều khoản → hash không đổi; hợp đồng mới dùng v2; nháp cũ vẫn v1 tới khi PATCH `use_latest_template` — FR-3, I2
- [AC-23] Replay: `POST /contracts` 2 lần cùng key + body → cùng id, lần 2 là replay, COUNT +1; khác body → 409 — FR-8
- [AC-24] Giả tiền: `total: 1000000`, `unit_price: 1` → 422; không có dòng mới; tạo đúng → 2.565.000 — FR-1
- [AC-25] Duyệt rồi sửa: duyệt bước 1, sửa snapshot trực tiếp trong DB (test) → phát hành 409 `changed-after-approval`, không tốn số — FR-6
Fixture Nhật Minh (seed khi PROOF, doc date 28/09/2026): khách A · G6 · 1 · −5% → 1 bước → `HD-2026-001` · 2.565.000đ · 28/09/2026 → 27/03/2027; khách B · G12 · 2 ·
−15% (Nhân viên tạo; cần ≥1 Quản lý + ≥1 Giám đốc khác nhau) → Chờ duyệt 2 bước → `HD-2026-002` · 8.160.000đ · 28/09/2026 → 27/09/2027. Chỉ dùng phần hợp đồng của fixture workbook (BG/DNTT ngoài phạm vi).
Khác:
- [AC-26] Chưa đăng nhập gọi mọi endpoint §3.5 → 401, không dữ liệu; Nhân viên gọi `/approvals/mine` và `/contracts/{id}/audit` → 403 + `permission.denied`;
  người không phải người tạo PATCH/submit → 403 — §5
- [AC-27] Khách tên `<script>alert(1)</script>` → `/render` chứa `&lt;script&gt;`, header CSP có `default-src 'none'` — §5, §3.2
- [AC-28] `/approvals/mine`: Quản lý thấy bước 1 của hợp đồng người khác, không thấy hợp đồng mình tạo, không thấy bước Giám đốc; sau khi bước 1 duyệt, Giám đốc thấy bước 2 (trừ người vừa duyệt bước 1) — FR-9
- [AC-29] `GET /contracts?status=pending` trả đúng, `counts` khớp, `limit` >50 → 422 — FR-9

## 8. Trace check (before the STOP)
- [x] every FR points to an OUT (FR-1…10 → OUT-1…6) · every AC proves an FR, a "now" edge case, or a DEC · every "now" edge case has an AC
  (Input → AC-24 AC-27 AC-4; Duplicates → AC-17 AC-23 AC-15; Two people → AC-18 + **TODO(PLAN) thêm test duyệt+từ chối đua**; Failure → AC-18, render dựng lại:
  **TODO(PLAN) test chết giữa phát hành và lưu bản in**; Permissions → AC-9 AC-20 AC-26; Lifecycle → AC-14 AC-15; Money → AC-7 AC-11; Time → AC-3 AC-6; Template → AC-22)
- [x] DEC-1…9 + Q-A/B/C đã chốt (2026-09-29); AC-13b/13c chứng minh I9 phân biệt + `one_person_one_step` (FR-4, FR-5); AC-7 chứng minh DEC-3/5/6
- [x] DEC-10 chốt (a) · SPEC-02 approved cùng lúc với đúng hình dạng đã dựa vào

## 9. Tách card gợi ý (cho PLAN-03)
Nguyên tắc: một file chỉ thuộc một card; route chỉ gọi service; mỗi command một file service + một file DAO; test integration mỗi nhóm một file
(PLAN viết sẵn, đỏ). Agent song song chạy **chỉ file test của mình** với `CI=true` (miniflare cạn port), nên dùng worktree; điều phối chạy cả bộ.
- **C-03-001 — hợp đồng chung (tuần tự, trước hết):** `apps/api/src/db/schema.ts` + migration (`pnpm db:generate`) · `dto/contracts.ts` (mọi request/response
  §3.5) · `dto/error.ts` (5 slug mới) · `routes/contracts.routes.ts` + `routes/approvals.routes.ts` + đăng ký ở `routes/index.ts` (guard đầy đủ, handler gọi
  service) · `services/contract/*.ts` stub có chữ ký, trả 501 · `domain/contract/types.ts` (Snapshot, Policy, Step…) · `events/contract-events.ts`
  (dispatcher + listener log) · hằng số action nhật ký · `pnpm client:generate` · helper test `test/helpers/contracts.ts` (`seedContract(db,{status,…})`
  chèn thẳng dòng ở trạng thái bất kỳ để các card sau test độc lập).
- **Đợt 1 (song song):**
  - C-03-002 domain thuần: `domain/contract/{pricing,dates,amount-words,policy,assignment,state,merge,number,hash}.ts` + `test/unit/contract-domain.test.ts` (AC-7, AC-11 phần thuần, `eligibleAssignment` cho AC-13b).
  - C-03-003 render: `domain/contract/render.ts` + `services/contract/render-service.ts` + `test/integration/contracts-render.test.ts` (AC-5 bản in, AC-27).
  - C-03-004 đọc: `dao/contract-read-dao.ts` (list+counts, detail+steps+timeline, approvals queue) + `services/contract/read-service.ts` +
    `test/integration/contracts-read.test.ts` (AC-28 AC-29, `/contracts/{id}/audit` dùng lại `audit-dao`).
- **Đợt 2 (song song, cần 002; 006 cần 003):**
  - C-03-005 tạo/sửa/chép: `dao/contract-write-dao.ts` + `services/contract/{create,update,copy}-service.ts` + `test/integration/contracts-create.test.ts`.
  - C-03-006 số + phát hành + hủy: `dao/contract-issue-dao.ts` (Rung B, lưu bản in) + `services/contract/{issue,void}-service.ts` + `test/integration/contracts-issue.test.ts`.
  - C-03-007 gửi + duyệt/từ chối + SoD + I9: `dao/approval-dao.ts` (eligible approvers, steps CAS, `one_person_one_step`) + `services/contract/{submit,decide}-service.ts` +
    `test/integration/contracts-approval.test.ts` (AC-9, AC-13b, AC-13c).
- **C-03-008 PROOF (tuần tự, cuối):** script probe + fixture Nhật Minh (`scripts/` hoặc `test/probes/`), đua 10 phát hành, dán output vào PLAN-03.
- Va chạm cần chốt trước khi phát: `routes/*.ts`, `schema.ts`, `dto/*`, `dto/error.ts`, client sinh ra → chỉ C-03-001 đụng; card sau cần đổi API → dừng, sửa ở
  C-03-001-b tuần tự. `audit-dao.ts` chỉ đọc (dùng `auditInsert`), không sửa.
