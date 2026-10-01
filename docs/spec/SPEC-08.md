# SPEC-08: Sản phẩm & giá — dịch vụ + hàng hóa, mức giá theo ngày (chưa VAT + thuế suất), dòng hàng trên tài liệu

Status: Approved 2026-10-01 (DEC-1/2/10 + seed DEMO bạn chốt; DEC-3..9, 11..13 + edge "now/later" theo đề xuất — driver chốt, bạn ủy quyền)
Intent: docs/intent/INTENT-08.md (Approved 2026-10-01; Q-1..Q-6 ràng buộc) · Roadmap: ROADMAP-02 row 3 · Chạy song song row 2b (SPEC-07) — **C-08-001 chạy SAU C-07-001** (chung journal migration, catalog, client); ai merge sau thì `db:generate` lại migration + `openapi:export && client:generate` lại.
**Thay Q-5 của INTENT-08 (bạn chốt 2026-10-01, không sửa INTENT):** seed DEMO = gói phần mềm G3/G6/G12 **KCT** (`vat_rate_bps` NULL), giá chưa VAT = **giá hiện tại** (tổng không đổi, không lệch 1đ) + **2 hàng hóa DEMO 10%** để có nhóm thuế; mọi dòng seed gắn nhãn DEMO.

## 1. Research (2026-10-01)
Code (đã kiểm):
- `price_list(code, name, duration_value, duration_unit, unit_price, effective_from, effective_to, note)` UNIQUE `(code, effective_from)` (`db/schema.ts:335`); seed 7 dòng "đã gồm VAT" (`0010_seed_foundation.sql:45`); chỉ đổi bằng migration. `priceListAt(db, date)` lọc `from ≤ date ≤ to` (`dao/price-list-dao.ts`); `GET /price-list?date=` quyền `contract:read`.
- Snapshot hôm nay: một gói (`snapshot.package`) + **một dòng** `{description, qty=so_cua_hang, unit_price, discount_bps, amount}`; `gross`, `discount_amount` half-up bps, `total` (`domain/contract/pricing.ts`, `snapshot.ts:200-312`). `ma_goi` cứng `["G3","G6","G12"]` trong `buildSnapshot` (`snapshot.ts:150`); chỉ gói `month` (`:170`). `loadAndBuild` tra giá theo `todayInVN(now)` (`services/contract/snapshot-builder.ts:93`); sao chép HĐ dựng lại từ `snapshot.inputs` (`copy-service.ts:27`).
- Nguồn trường: `SOURCE_REGISTRY` (`domain/template-sources.ts`) có `price_list:{code,name,unit_price,duration_*}`, `derived:{doc_date,contract_end,total,total_in_words,discount_bps}`. Mẫu seed v1 (`0013`): `ten_goi`=`price_list:name`, `so_cua_hang`, `ma_goi` (choice), `tong_tien`=`derived:total`, câu "đã gồm VAT". `template_versions` append-only (trigger `0012`) → đổi mẫu = thêm phiên bản.
- Trộn: mọi giá trị **escape HTML** (`merge.ts:93`); không có vòng lặp/khối bảng. Web: form chọn `ma_goi` + `so_cua_hang` (`features/contracts/contract-form-modal.tsx:77-79,234`, `values.ts`), drawer in `snapshot.lines` (`contract-drawer.tsx:224`).
- Catalog 16 mã (`packages/rbac/src/catalog.ts`); 2b (SPEC-07 FR-10) thêm 2 mã (`jit:grant`, `reviews:write`) + migration `0019_*`+ → cùng file với row này. Migration lint chặn `DROP TABLE` cùng PR với code (`scripts/lint-migrations.ts`, expand/contract).
Luật VN (chính thức, nguồn ngày 2026-10-01):
- NĐ 123/2020/NĐ-CP Điều 10 khoản 6 (sửa bởi NĐ 70/2025/NĐ-CP, hiệu lực 01/06/2025): hóa đơn GTGT ghi "đơn giá; thành tiền **chưa có thuế GTGT**, thuế suất, **tổng số tiền thuế GTGT theo từng loại thuế suất**, tổng cộng tiền thuế, tổng tiền thanh toán đã có thuế"; điểm c: thuế suất là thuế suất **tương ứng với từng loại hàng hóa, dịch vụ**; điểm đ: chiết khấu thương mại phải thể hiện rõ, giá tính thuế theo luật GTGT; khoản 13: đồng tiền là Đồng Việt Nam ("đ"). — hethongphapluat.com/nghi-dinh-123-2020-nd-cp-quy-dinh-ve-hoa-don-chung-tu/dieu-10 · luatvietnam.vn (NĐ 70/2025).
- NQ 204/2025/QH15: thuế suất 10% → **8%** cho đa số hàng hóa, dịch vụ từ 01/07/2025 **đến hết 31/12/2026** → thuế suất **đổi theo ngày** là chuyện có thật sắp tới (01/01/2027). — thuvienphapluat.vn (NQ 204/2025).
- Luật Thuế GTGT 48/2024/QH15 Điều 5 khoản 21: **sản phẩm phần mềm, dịch vụ phần mềm** thuộc đối tượng **không chịu thuế GTGT** (KCT) → cần mức "KCT", khác 0%. — misa / thuvienphapluat (dẫn luật).
- Làm tròn: luật không quy định từng dòng hay cả hóa đơn; mẫu hóa đơn tính thuế **theo nhóm thuế suất** (khoản 6). Đơn vị làm tròn = đồng.
Miền: lỗi kinh điển — sửa giá cũ làm tài liệu cũ đổi số · lùi ngày hiệu lực · float · thuế gõ tay · lệch 1đ giữa tổng dòng và tổng thuế · giá client gửi.

## 2. Requirements
- [FR-1] Sản phẩm: `kind` = dịch vụ (thời hạn N ngày/tháng) | hàng hóa (đơn vị tính, mã/SKU); thêm, sửa tên/đơn vị/thời hạn, ngừng bán/bán lại — quyền `product:write`; `code`, `kind` không đổi sau khi tạo; không xóa cứng → OUT-1, Q-2
- [FR-2] Mức giá: `unit_price_ex_vat` (đồng nguyên) + `vat_rate` (DEC-1) + `effective_from`; thêm mức mới — quyền `price:write`; **không sửa mức đã/đang hiệu lực**, không lùi ngày (DEC-5); hủy mức chưa tới ngày (DEC-6) → OUT-2, Q-3
- [FR-3] Giá tại ngày D = mức có `effective_from` lớn nhất ≤ D (giờ VN); không có → sản phẩm "chưa có giá ngày D" → OUT-2
- [FR-4] Tài liệu chọn 1–50 dòng `{product_id, qty}`; server lấy giá theo `doc_date`, tính tiền (§3.3); client gửi giá/tiền → 422 → OUT-4, I4
- [FR-5] Snapshot chép đủ dòng (mã, tên, đơn vị, thời hạn, giá chưa VAT, thuế suất, ngày hiệu lực của mức) + nhóm thuế + tổng; sửa/thêm/hủy sản phẩm hay giá sau đó **không** đổi tài liệu (draft chỉ đổi khi người tạo sửa = tính lại theo ngày sửa, như SPEC-03 FR-3) → OUT-2, I2
- [FR-6] Bản in hiện tiền trước thuế · giảm giá · thuế theo từng thuế suất · tổng thanh toán + bằng chữ; bảng dòng hàng (DEC-7); mẫu seed lên v2 (DEC-8) → OUT-3
- [FR-7] Quyền mới `product:write` ("Sửa sản phẩm"), `price:write` ("Đặt giá") trong catalog + seed `quan_ly`, `giam_doc`; đọc sản phẩm = `contract:read` (DEC-11) → Q-1
- [FR-8] Nhật ký cùng batch: `product.created` · `product.updated` (tên trường đổi) · `product.deactivated`/`reactivated` · `price.added` · `price.cancelled` (mã, ngày, giá, thuế suất — không PII) → OUT-1, OUT-2
- [FR-9] Màn "Sản phẩm & giá" (danh sách + ngăn + lịch sử giá + thêm mức giá) và form tài liệu chọn sản phẩm vào dòng → OUT-1, OUT-4
- [FR-10] Seed DEMO (gói phần mềm KCT, giá = giá hiện tại; 2 hàng hóa DEMO 10%) + seeder `pnpm dev:seed-products` chạy lại được (DEC-12) → Q-5
- [FR-11] Tiền dòng + tổng là hàm thuần dùng chung, không gắn `contract` (row 4: BG/DNTT/PXK dùng lại) → ROADMAP row 4

## 3. Design
### 3.1 Data (migration mới, chỉ thêm — expand; số file = kế tiếp lúc build, xem §9)
- `products(id ULID, kind CHECK IN ('service','goods'), code, code_norm UNIQUE (trim + upper; `[A-Z0-9._-]{1,32}`), name 1–120, unit 1–20 (vd. "cửa hàng", "cái"), duration_value INT NULL, duration_unit NULL CHECK IN ('day','month'), active INT 1, version INT 1, created_by, created_at, updated_at)`; CHECK: `service` ⇒ duration đủ (1–120 tháng/1–3650 ngày) · `goods` ⇒ duration NULL.
- `product_prices(id ULID, product_id FK, effective_from TEXT YYYY-MM-DD, unit_price_ex_vat INT CHECK 0..10^12, vat_rate_bps INT NULL CHECK IN (0,500,800,1000) — NULL = KCT, created_by, created_at)`; UNIQUE `(product_id, effective_from)`; index `(product_id, effective_from DESC)`.
  Trigger: `BEFORE UPDATE` → RAISE (không bao giờ sửa) · `BEFORE DELETE WHEN OLD.effective_from <= date('now','+7 hours')` → RAISE (chỉ hủy mức tương lai) · `BEFORE INSERT WHEN NEW.effective_from < date('now','+7 hours') AND EXISTS(mức khác của product)` → RAISE (chống lùi ngày, phòng thủ 2 lớp; VN không DST).
- Không có `effective_to`: kết thúc = ngày trước mức kế tiếp (tính khi đọc) → không còn hai cột phải giữ khớp.
- `price_list`: giữ nguyên, code thôi đọc; `DROP` ở PR contract sau (DEC-9). Seed DEMO (DEC-12, bạn chốt): G3/G6/G12 `service`, unit "cửa hàng", **KCT**, giá chưa VAT = giá hiện tại: G3 1.350.000 (2025-01-01) → 1.500.000 (2026-01-01) · G6 2.400.000 (2025-01-01) → 2.700.000 (2026-07-01) · G12 4.500.000 (2025-01-01) → 4.800.000 (2026-01-01) · DT14 `service` `day` 0đ KCT `active=0` (SPEC-02 Q-4). Hàng hóa DEMO 10% (từ 2026-01-01; số giả lập, bạn thay qua seeder): `DEMO-MIN-01` "Máy in hóa đơn (DEMO)" cái 1.000.000 · `DEMO-GIAY-01` "Giấy in nhiệt (DEMO)" cuộn 20.000. Mọi dòng seed gắn nhãn DEMO. Migration chèn seed **trước** khi tạo trigger INSERT (mức 2026 nằm sau mức 2025).
- `permissions` + `product:write`, `price:write`; `role_permissions` → `quan_ly`, `giam_doc` (`INSERT OR IGNORE`). Admin không có (như `contract:*`).
- Mẫu seed v2: migration thêm `template_versions` v2 của mẫu seed + dời `current_version_id` (append-only giữ v1) — DEC-8.

### 3.2 Snapshot (tài liệu MỚI; demo cũ wipe — Q-6)
`lines[{product_id, code, name, kind, unit, duration_value|null, duration_unit|null, qty, unit_price_ex_vat, vat_rate_bps|null, price_from, amount_ex_vat, discount_amount, net_ex_vat}]` · `vat_groups[{vat_rate_bps|null, base, vat}]` · `subtotal_ex_vat` · `discount_bps` · `discount_amount` · `total_ex_vat` · `vat_total` · `total` (= tổng thanh toán, gồm VAT; `contracts.total` chép như hôm nay) · `total_words` · `inputs.lines[{product_id, qty}]` (cho sửa/sao chép) · bỏ `package`, `gross`. Trần 50 dòng, snapshot ≤ 256 KB giữ.

### 3.3 Quy tắc tiền (hàm thuần `domain/money/line-pricing.ts`, không float, BigInt như `pricing.ts`)
- Dòng: `amount_ex_vat = qty × unit_price_ex_vat` · `discount_amount = halfUp(amount × discount_bps / 10000)` (giảm % theo tài liệu, áp từng dòng TRƯỚC thuế — DEC-3) · `net = amount − discount`.
- Nhóm thuế (DEC-2): theo `vat_rate_bps` (KCT riêng nhóm, thuế 0): `vat = halfUp(Σnet × rate / 10000)`. `total_ex_vat = Σnet` · `vat_total = Σvat` · `total = total_ex_vat + vat_total`.
- Kiểm (seed DEMO): G6 × 1 −5% → net 2.565.000, nhóm KCT thuế 0, **2.565.000** · G12 × 2 −15% → **8.160.000** (khớp SPEC-03, không lệch) · G6 × 1 + `DEMO-MIN-01` × 1 → nhóm KCT 2.700.000/0 · nhóm 10% 1.000.000/100.000 · tổng **3.800.000** · `DEMO-GIAY-01` × 3 −5% → net 57.000, thuế 5.700, **62.700**; làm tròn .5 + mức 8% kiểm bằng fixture ở unit test C-08-002.
- `qty` nguyên 1–9.999 (DT `service`: số cửa hàng). Thập phân (kg, m) → later.
- HĐ (DEC-10): đúng **1 dòng dịch vụ theo tháng** (cho `contract_end`, `ten_goi`) + 0..n dòng hàng hóa; không có / >1 / dịch vụ `day` → 422 `lines`. Sản phẩm ngừng bán hoặc chưa có giá ngày lập → 422 `product-inactive` / `no-price` nêu dòng. Trùng `product_id` 2 dòng → 422.
- Ngưỡng duyệt giữ: `discount_bps > 1000`; biến `total` = gồm VAT.

### 3.4 Nguồn trường + mẫu v2
- Bỏ `price_list:*`, `options_from:"price_list"`. Thêm `derived:` `subtotal_ex_vat` · `discount_amount` · `total_ex_vat` · `vat_total` · `vat_rates` ("10%", "8%, 10%", "KCT") · `service_name` · giữ `doc_date` `contract_end` `total` `total_in_words` `discount_bps`. Kiểu trường mới `lines` + nguồn `derived:lines_table`: chỗ đặt bảng; renderer dựng `<table>` từ `snapshot.lines`, **escape từng ô**, không bao giờ lấy HTML từ người dùng.
- Mẫu v2 (thân giữ nguyên trừ Điều 1–2): Điều 1 "… phần mềm quản lý bán hàng Nhật Minh, {{ten_goi}}, từ ngày {{ngay_bat_dau}} đến hết ngày {{ngay_ket_thuc}}, theo bảng: {{bang_hang}}"; Điều 2 "Tiền trước thuế {{tien_truoc_thue}} đồng · giảm giá {{giam_gia}}% ({{tien_giam_gia}} đồng) · thuế GTGT ({{thue_suat}}) {{tien_thue}} đồng · **tổng thanh toán {{tong_thanh_toan}} đồng** (bằng chữ: {{tong_thanh_toan_bang_chu}})". Bỏ `ma_goi`, `so_cua_hang`, `tong_tien`, câu "đã gồm VAT". Bảng: STT · Tên · ĐVT · SL · Đơn giá chưa VAT · Thuế suất · Thành tiền chưa VAT.

### 3.5 API (contract-first; ghi cần `Origin`=`APP_ORIGIN` + `X-Requested-With: fetch`; Problem+JSON; `.strict()`)
| Method + path | Quyền | Request → Response | Lỗi |
|---|---|---|---|
| `GET /products?date&kind&active&q&limit` | `contract:read` | → `{date, items: Product[]}`; `Product = {id, kind, code, name, unit, duration_value, duration_unit, active, version, price: Level\|null (tại date, mặc định hôm nay VN), next_price: Level\|null, can:{edit, price}}`; `Level = {id, effective_from, effective_to\|null, unit_price_ex_vat, vat_rate_bps\|null, unit_price_inc_vat}` | 401 · 403 · 422 ngày sai |
| `GET /products/{id}` | `contract:read` | → `Product` + `prices: (Level & {status: past\|current\|scheduled})[]` mới nhất trước | 404 |
| `POST /products` (+`Idempotency-Key`) | `product:write` (+`price:write` nếu có `first_price`) | `{kind, code, name, unit, duration_value?, duration_unit?, first_price?: {unit_price_ex_vat, vat_rate_bps\|null, effective_from}}` → 201 `Product` | 409 `duplicate` (code) · 422 |
| `PATCH /products/{id}` | `product:write` | `{expected_version, name?, unit?, duration_value?, duration_unit?, active?}` → 200 | 404 · 409 `stale` · 422 (gửi `code`/`kind`) |
| `POST /products/{id}/prices` (+`Idempotency-Key`) | `price:write` | `{unit_price_ex_vat, vat_rate_bps\|null, effective_from}` → 201 `Level` | 404 · 409 `duplicate` (trùng ngày) · 422 `price-backdated` |
| `DELETE /products/{id}/prices/{priceId}` | `price:write` | → 204 | 404 · 409 `price-in-effect` |
| `POST /pricing/preview` | `contract:write` | `{lines[{product_id, qty}], discount_bps}` → `{doc_date, lines, vat_groups, subtotal_ex_vat, discount_amount, total_ex_vat, vat_total, total, total_words}` (không ghi gì) | 422 `lines`/`no-price`/`product-inactive` |
| `POST /contracts`, `PATCH /contracts/{id}` (đổi) | như cũ | + `lines[{product_id, qty}]` (1–50) top-level; `values` bỏ `ma_goi`, `so_cua_hang` | + 422 trên |
| `GET /price-list` | — | **bỏ** (OpenAPI + client cùng commit) | |
- Slug mới: `price-backdated`, `price-in-effect`, `no-price`, `product-inactive`. Ghi = một `db.batch` (thay đổi + audit); PATCH CAS `version`; thêm giá dựa UNIQUE + trigger (không check-then-write).

### 3.6 Màn hình (DESIGN: bảng 44px, tiền mono phải, ngăn 560px, 🔒 + lý do)
- Nav "Sản phẩm & giá" `/san-pham` (sau Khách hàng; mọi người có `contract:read`). Tab Tất cả · Dịch vụ · Hàng hóa · Ngừng bán + tìm (mã/tên). Bảng: Mã · Tên · Loại (pill) · ĐVT · Thời hạn · Giá chưa VAT · Thuế suất · Giá gồm VAT · Sắp áp dụng ("2.600.000 từ 01/01/2027"). Rỗng: "Chưa có sản phẩm nào — Thêm sản phẩm". 390px: thẻ.
- "+ Thêm sản phẩm" (`product:write`): modal — Loại (Dịch vụ/Hàng hóa), mã, tên, ĐVT, thời hạn (chỉ dịch vụ), giá đầu tiên + thuế suất (0% · 5% · 8% · 10% · KCT) + từ ngày (mặc định hôm nay); hiện "Giá gồm VAT: …".
- Ngăn sản phẩm: thông tin + Lưu (CAS; 409 → "Người khác vừa sửa" + Tải bản mới) · Ngừng bán/Bán lại · **Lịch sử giá** (Sắp áp dụng · Đang áp dụng · Đã hết, mỗi mức: giá chưa VAT, thuế suất, gồm VAT, từ–đến, người đặt) · "+ Thêm mức giá" (từ ngày min = mai; "Tài liệu lập trước ngày này giữ giá cũ") · mức sắp áp dụng có "Hủy". Không quyền: 🔒 "Chỉ Quản lý, Giám đốc sửa sản phẩm/đặt giá".
- Form tài liệu: khối **Dòng hàng** thay Gói + Số cửa hàng: mỗi dòng combobox sản phẩm (đang bán, có giá hôm nay; chưa có giá → 🔒 "Chưa có giá hôm nay") · SL · ĐVT · đơn giá chưa VAT (chỉ đọc) · thành tiền; "+ Thêm dòng", xóa dòng; Giảm giá %; ô tổng (trước thuế · giảm · thuế từng thuế suất · tổng thanh toán) từ `POST /pricing/preview` (debounce, ghi "Máy chủ tính lại khi lưu"). Drawer + bản in: bảng dòng có thuế suất + khối tổng.
- Nhật ký: câu cho `product.*`, `price.*` ("đặt giá «DEMO-MIN-01» 1.100.000 đ + 10% từ 01/01/2027").

## 4. Edge cases — đề xuất; bạn chốt now · later · n/a
| Category | Case here | Decision (đề xuất) |
|---|---|---|
| Input | mã rỗng/ký tự lạ/>32, tên >120, giá âm/thập phân/>10^12, thuế suất ngoài {0,5,8,10,KCT}, ngày giả (31/02), dịch vụ thiếu thời hạn, hàng hóa có thời hạn, `qty` 0/âm/thập phân, 0 hoặc >50 dòng, body có `unit_price`/`total` | now → 422 |
| Duplicates & identity | mã trùng khác hoa thường (`code_norm`) → 409 · 2 mức cùng ngày → 409 · bấm Tạo 2 lần (Idempotency-Key) · trùng `product_id` trong 1 tài liệu → 422 | now |
| Two people at once | 2 PATCH cùng version → 1 thắng, 409 `stale` · 2 người thêm mức cùng ngày → UNIQUE 1 thắng · hủy mức đúng lúc qua nửa đêm → trigger chặn | now |
| Failure & retry | batch lỗi → không đổi, không audit · retry có Idempotency-Key | now |
| Permissions | không đăng nhập 401 · Nhân viên/admin ghi → 403 + `permission.denied` · Nhân viên đọc được | now |
| Lifecycle | không xóa sản phẩm, chỉ ngừng bán · ngừng bán khi nháp đang dùng → sửa nháp/sao chép báo 422 nêu dòng · tài liệu chờ duyệt/phát hành không đổi | now |
| Money | gói KCT + hàng 10% trong 1 tài liệu (2 nhóm) · làm tròn half-up theo nhóm · nhiều thuế suất trong 1 tài liệu · KCT · giá 0đ · giảm 100% → 0đ · không float | now |
| Time / dates | giá theo ngày VN (00:30 01/01 ra mức mới) · lùi ngày → 422 + trigger · mức sắp tới không ảnh hưởng hôm nay · nháp sửa sau ngày đổi giá → tính giá mới (SPEC-03) | now |
| Thuế đổi theo luật | NQ 204 hết 31/12/2026 → hàng hóa đặt mức 01/01/2027 cùng giá, thuế mới; gói phần mềm KCT không đổi | now (DEC-1) |
| SL thập phân / tồn kho / bảng giá theo khách | | later (Parked / INTENT §4) |

## 5. Security
- Ai làm gì: đọc = `contract:read`; ghi sản phẩm `product:write`, giá `price:write` (QL, GĐ); API quyết định, 🔒 ở UI chỉ gợi ý. Không PII (giá, mã không phải dữ liệu cá nhân → audit ghi giá trị được).
- Chống sửa lịch sử: trigger D1 chặn UPDATE mọi mức, DELETE mức đã hiệu lực, INSERT lùi ngày — kể cả bug code. Giá luôn từ server (I4); client chỉ gửi `product_id` + `qty`.
- Abuse: đoán id (ULID, 404) · gửi `code`/`kind` khi sửa (422) · đặt giá 0đ để "bán chui" (cho phép — nhật ký `price.added` lộ ai đặt; ngưỡng duyệt vẫn chạy) · bảng dòng: mọi ô escape (tên sản phẩm có `<script>` in thành chữ) · spam sản phẩm (trần 500, `limit` ≤ 100).

## 6. Decisions (bạn chốt)
- [DEC-1] Thuế suất nằm đâu · options: **A** cột của sản phẩm (sửa = áp từ lúc sửa) · **B** trên từng mức giá (đổi theo ngày, append-only như giá) · recommended: **B** (NQ 204: 8% hết 31/12/2026 → đặt trước mức 01/01/2027; không ai phải thức nửa đêm; "theo sản phẩm" vẫn đúng) · decided: **B** (bạn chốt 2026-10-01)
- [DEC-2] Làm tròn VAT · options: **A** từng dòng rồi cộng · **B** theo nhóm thuế suất trên tổng tài liệu · **C** một lần trên tổng (chỉ 1 thuế suất) · recommended: **B** (đúng cấu trúc NĐ 123 Đ10.6 "tổng thuế theo từng loại thuế suất"; ít lệch nhất; hỗ trợ nhiều thuế suất) · decided: **B** (bạn chốt 2026-10-01)
- [DEC-3] Giảm giá % với VAT · options: **A** trừ trên tiền chưa VAT từng dòng rồi tính thuế · **B** trừ trên tổng gồm VAT · recommended: **A** (chiết khấu thương mại giảm giá tính thuế — NĐ 123 Đ10.6đ) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-4] Danh mục thuế suất · options: **A** 0/5/8/10% · **B** A + **KCT** (không chịu thuế) · recommended: **B** (phần mềm KCT theo Luật 48/2024 Đ5.21 — DEMO: gói phần mềm KCT, hàng hóa 10%) · decided: **B** (driver chốt — bạn ủy quyền)
- [DEC-5] Ngày hiệu lực sớm nhất · options: **A** luôn ≥ mai · **B** mức đầu tiên của sản phẩm mới ≥ hôm nay, các mức sau ≥ mai · recommended: **B** (sản phẩm mới bán được ngay; đổi giá không làm 2 tài liệu cùng ngày khác giá) · decided: **B** (driver chốt — bạn ủy quyền)
- [DEC-6] Đặt nhầm mức tương lai · options: **A** không hủy, chỉ thêm mức khác · **B** hủy được khi chưa tới ngày (trigger chặn khi đã tới) · recommended: **B** (chưa tài liệu nào dùng; nhật ký `price.cancelled`) · decided: **B** (driver chốt — bạn ủy quyền)
- [DEC-7] Bảng dòng hàng trong mẫu · options: **A** chỗ đặt `{{bang_hang}}` (kiểu `lines`), server dựng bảng · **B** cú pháp lặp `{{#each lines}}` · recommended: **A** (an toàn, đủ cho HĐ/BG/PXK; lặp tổng quát để row 5 nếu .docx cần) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-8] Mẫu seed + dữ liệu cũ · options: **A** migration thêm v2 (placeholder mới), bỏ nguồn `price_list:*`, wipe hợp đồng demo local · **B** giữ v1 chạy qua ánh xạ `price_list:*` → dòng dịch vụ · recommended: **A** (Q-6; không gánh hai cách tính) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-9] Bảng `price_list` · options: **A** giữ, thôi đọc; DROP ở PR riêng sau · **B** DROP ngay · recommended: **A** (lint expand/contract chặn B) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-10] Dòng của hợp đồng · options: **A** đúng 1 dịch vụ tháng + n hàng hóa · **B** tự do; ngày kết thúc = thời hạn dài nhất · recommended: **A** (văn bản HĐ nói về 1 gói; BG/PXK ở row 4 tự có luật dòng riêng) · decided: **A** (bạn chốt 2026-10-01)
- [DEC-11] Quyền đọc sản phẩm · options: **A** dùng `contract:read` · **B** mã mới `product:read` · recommended: **A** (mọi vai trò đã có; row 4 tổng quát hóa đọc) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-12] Seed + seeder · options: **A** migration seed DEMO + `pnpm dev:seed-products` (chỉ local, đọc `scripts/data/products.demo.json`, upsert sản phẩm theo mã, thêm mức thiếu; `--replace` xóa sản phẩm/giá local bằng helper tạm bỏ trigger) · **B** chỉ seeder, migration không seed · recommended: **A** (DB mới migrate là chạy được, e2e có dữ liệu; seed theo bản chốt ở đầu SPEC; số thật bạn thay bằng file + `--replace`) · decided: **A** (driver chốt — bạn ủy quyền)
- [DEC-13] Tổng tạm tính trên form · options: **A** `POST /pricing/preview` (server, cùng hàm) · **B** client tự tính bằng hàm chép sang web · recommended: **A** (I4: một nguồn tính; không lệch 1đ giữa form và bản in) · decided: **A** (driver chốt — bạn ủy quyền)

## 7. Acceptance
- [AC-1] Sau migrate: `GET /me` QL + GĐ có `product:write`, `price:write`; NV, admin không; catalog +2 mã; `GET /products` có G3/G6/G12 (KCT, `vat_rate_bps` null), DT14 ngừng bán, `DEMO-MIN-01`/`DEMO-GIAY-01` (10%, nhãn DEMO); `GET /products?date=2026-06-30` G6 2.400.000, `2026-07-01` → 2.700.000 — FR-3, FR-7, FR-10
- [AC-2] QL `POST /products {kind:"goods", code:"may-in-01", unit:"cái", first_price:{…, effective_from: hôm nay}}` → 201, mã `MAY-IN-01`; lặp `may-in-01` → 409 `duplicate`; hàng hóa có `duration_value` → 422; NV → 403 + `permission.denied`; không đăng nhập → 401 — FR-1, §4 Input/Permissions, DEC-5
- [AC-3] GĐ `POST /products/{DEMO-MIN-01}/prices {effective_from: hôm qua}` → 422 `price-backdated`; `{mai, 1.100.000, 800}` → 201; `GET ?date=mai` ra mức mới, hôm nay ra mức cũ; trùng ngày → 409; `DELETE` mức mai → 204 + `price.cancelled`; `DELETE` mức đang áp dụng → 409 `price-in-effect`; `UPDATE`/`DELETE` thẳng D1 mức đã hiệu lực → lỗi trigger — FR-2, DEC-1, DEC-6
- [AC-4] Tạo HĐ `lines:[{G6,1}]`, giảm 5% → `total` 2.565.000, `vat_groups:[{null, 2.565.000, 0}]`; `[{G12,2}]` −15% → 8.160.000; G6 + `DEMO-MIN-01` → 3.800.000, 2 nhóm (KCT 0 · 10% 100.000); `DEMO-GIAY-01`×3 −5% → 62.700; body có `unit_price` → 422 — FR-4, DEC-2, DEC-3, §4 Money
- [AC-5] HĐ đã phát hành + nháp: đổi tên G6, thêm mức giá, ngừng bán G6 → `GET /render` HĐ phát hành hash y nguyên; nháp không đổi tới khi người tạo sửa; sửa nháp → 422 `product-inactive` nêu dòng — FR-5, I2, §4 Lifecycle
- [AC-6] Dòng sai: 0 dòng, 51 dòng, 2 dòng dịch vụ, chỉ hàng hóa, DT14, trùng `product_id`, sản phẩm chưa có giá hôm nay → 422 đúng slug/dòng — FR-4, DEC-10
- [AC-7] Bản in v2: có bảng dòng (escape: sản phẩm tên `<b>x</b>` in thành chữ), tiền trước thuế, thuế "KCT" (chỉ gói) / "KCT, 10%" (gói + hàng DEMO), tổng thanh toán + bằng chữ "Hai triệu năm trăm sáu mươi lăm nghìn đồng"; không còn "đã gồm VAT" — FR-6, DEC-7, DEC-8
- [AC-8] Hai `PATCH /products/{id}` cùng `expected_version` → 1×200, 1×409 `stale`, 1 dòng `product.updated`; hai `POST …/prices` cùng ngày song song → 1×201, 1×409 — §4 Two people
- [AC-9] `RUNWAY_LOCAL=1 pnpm dev:seed-products` chạy 2 lần → cùng kết quả; sửa giá trong file + `--replace` → giá mới; thiếu `RUNWAY_LOCAL` → từ chối — FR-10, DEC-12
- [AC-10] Màn (e2e, 1 spec desktop ở PROOF): QL vào "Sản phẩm & giá" → thêm hàng hóa → thêm mức giá G6 từ mai → lịch sử thấy "Sắp áp dụng"; NV tạo HĐ chọn G6 + hàng hóa, ô tổng hiện thuế theo nhóm, tạo → drawer khớp số; NV mở `/san-pham` → chỉ xem, 🔒 — FR-9, DEC-13

## 8. Rủi ro (đưa vào PLAN)
- R-1 Va chạm row 2b: `catalog.ts`, `schema.ts`, `migrations/` + `meta/_journal.json`, `dto/error.ts`, `packages/client`, `problem-messages.ts`, `audit-sentence.ts`, `permission-labels.ts`, `app/nav.ts`. Ai merge sau: rebase, `db:generate` lại số migration, `openapi:export && client:generate` lại. AC-1 ghi "catalog +2", không số tuyệt đối.
- R-2 Bỏ `GET /price-list` + `values.ma_goi` đổi kiểu client → web contracts phải theo cùng đợt (C-08-005 → 008).
- R-3 Test hiện có dựa vào `ma_goi`/`price_list`/2.700.000 gồm VAT (`contracts-*.test.ts`, `templates-acceptance`, `template-check`, `contract-snapshot`, web `contract-drawer.test`) → sửa trong card đổi hành vi, ghi PLAN.
- R-4 Lệch 1đ: hết (gói KCT, giá chưa VAT = giá hiện tại — bạn chốt). Còn lại: số DEMO phải thay bằng số thật qua seeder trước khi dùng thật.
- R-5 Wipe demo local: `mv apps/api/.wrangler/state …` + migrate + `dev:seed-team` + `dev:seed-products` (CLAUDE.md).

## 9. Tách card gợi ý (file scope rời nhau)
| Card | Phạm vi file | Phụ thuộc | Xong khi |
|---|---|---|---|
| **C-08-001** dữ liệu + quyền | `db/schema.ts` (2 bảng), migration mới (bảng + trigger + seed DEMO + quyền), `catalog.ts`, `docs/rbac.md` | **sau C-07-001** (journal/catalog/client chung) | AC-1 phần dữ liệu |
| **C-08-002** tiền thuần | `domain/money/line-pricing.ts` (+ `price-at.ts`), `test/domain/line-pricing.test.ts` | — (∥ 001) | ví dụ §3.3 xanh |
| **C-08-003** hợp đồng OpenAPI | `dto/products.ts` (mới), `dto/contracts.ts`, `dto/error.ts`, `routes/products.routes.ts` + `pricing.routes.ts` (501), bỏ `price-list.routes.ts`/`dto/price-list.ts`/`dao/price-list-dao.ts`, `routes/index.ts`, OpenAPI + client | 001 | client sạch |
| **C-08-004** API sản phẩm & giá | `dao/product-dao.ts`, `services/product-service.ts`, routes 003, `test/integration/products.test.ts` | 002, 003 | AC-2, AC-3, AC-8 |
| **C-08-005** tài liệu dùng dòng | `domain/contract/{snapshot,types,render,merge}.ts`, `domain/template-sources.ts`, `domain/template-check.ts`, `dto/templates.ts`, `services/contract/{snapshot-builder,copy-service}.ts`, migration mẫu v2, `routes/pricing.routes.ts`, test contracts/templates/domain | 002, 003 (∥ 004) | AC-4..AC-7 |
| **C-08-006** seeder | `scripts/dev-seed-products.ts`, `scripts/data/products.demo.json`, `scripts/lib/dev-seed.ts` (helper), `package.json` | 001 | AC-9 |
| **C-08-007** web Sản phẩm & giá | `apps/web/src/features/products/**` (mới), `app/nav.ts` (1 dòng), `features/roles/permission-labels.ts`, `features/audit/audit-sentence.ts`, `lib/problem-messages.ts` | 004 (sau C-07-006 nếu cùng lúc) | màn chạy, test web |
| **C-08-008** web form + drawer dòng | `apps/web/src/features/contracts/**` | 005 | form chọn dòng, drawer khớp |
| **C-08-009** e2e + PROOF | `apps/web/e2e/**`, `docs/cookbook/design/DESIGN.md` (dòng màn mới — bạn duyệt), PLAN PROOF log | 001–008 | AC-10 |
Thứ tự: 001 ∥ 002 → 003 → 004 ∥ 005 ∥ 006 → 007 ∥ 008 → 009. API suite và e2e không chạy cùng lúc.

## 10. Trace check (trước STOP)
- [x] FR → OUT: FR-1 OUT-1/Q-2 · FR-2 OUT-2/Q-3 · FR-3 OUT-2 · FR-4 OUT-4 · FR-5 OUT-2 · FR-6 OUT-3 · FR-7 Q-1 · FR-8 OUT-1/2 · FR-9 OUT-1/4 · FR-10 Q-5 · FR-11 row 4
- [x] AC → FR/edge/DEC: AC-1 FR-3,7,10 · AC-2 FR-1, Input, Permissions, DEC-5 · AC-3 FR-2, DEC-1,6, Time · AC-4 FR-4, DEC-2,3, Money · AC-5 FR-5, Lifecycle · AC-6 FR-4, DEC-10 · AC-7 FR-6, DEC-7,8 · AC-8 Two people, Duplicates · AC-9 FR-10, DEC-12 · AC-10 FR-9, DEC-13 · DEC-4 → AC-1/AC-4 (KCT trong unit test 002) · DEC-9, DEC-11 → AC-1 · FR-8 → AC-3, AC-8 (audit) · FR-11 → C-08-002 (hàm không import `contract`)
- [x] edge "now" có AC: Input AC-2 AC-6 · Duplicates AC-2 AC-8 · Two people AC-8 · Failure AC-8 (thua không audit) · Permissions AC-2 AC-10 · Lifecycle AC-5 · Money AC-4 · Time AC-1 AC-3 · Thuế đổi AC-3 (edge theo đề xuất — driver chốt)
- [x] DEC-1..13 chốt · [x] SPEC duyệt 2026-10-01
