# SPEC-09: Nhiều loại tài liệu — Báo giá → Hợp đồng → Đề nghị thanh toán, mỗi loại số riêng (+ Phiếu xuất kho DEMO)

Status: Approved 2026-10-01 (driver chốt theo pattern bạn ủy quyền: DEC-1..9, 11..14 = A, DEC-10 = B; edge "now/later" theo đề xuất; fact thiếu của PXK = DEMO)
Intent: docs/intent/INTENT-09.md (Approved 2026-10-01; Q-1..Q-4 ràng buộc, Q-5/Q-6 trả lời ở DEC-5/DEC-4) · Roadmap: ROADMAP-02 row 4 · MAP M1–M3 + M9
Dữ liệu hiện có là demo → wipe/seed lại (memory "demo data wipeable"); migration vẫn phải chép dòng cũ đúng (DB thật sau này).

## 1. Research (2026-10-01)
Code (đã kiểm):
- `contracts` (`db/schema.ts:403`): đã có cột `type` nhưng **CHECK `type = 'contract'`** (`ck_contracts_type`, migration `0014`); `source_contract_id` = nguồn **sao chép** (rejected/voided → nháp mới, `copy-service.ts`), `replaced_by_id` đặt trên bản bị hủy khi sao chép; UNIQUE partial `(type, series_year, seq) WHERE seq IS NOT NULL` + `uq_contracts_number`. Không bảng nào FK tới `contracts`, không trigger trên `contracts`.
- Số: `SERIES = { contract: { prefix: "HD", pad: 3 } }` (`domain/contract/number.ts`); `issueCas` (`dao/contract-issue-dao.ts`) = 1 `UPDATE` lấy `MAX(seq)+1` theo `(type, year)` + audit `INSERT…SELECT` guard `issue_token`, một `db.batch`; `TYPE`/`NUMBER_FORMAT` đang cứng `contract`/`HD`. Năm = `seriesYear(now)` giờ VN. Hủy = `voidCas` issued→voided giữ số.
- Duyệt: `approval_policy` nằm trong `template_versions` (mẫu HĐ v2, `0023`): `combined` = bước "Quản lý duyệt" + rule `discount_bps > 1000` → "Giám đốc duyệt" (role `giam_doc`) → luật duyệt **theo mẫu**, mỗi loại có mẫu riêng là có luật riêng, không cần code.
- `templates.type` (không CHECK); DTO tạo mẫu `type: z.literal("contract")` (`dto/templates.ts:106`). Mẫu HĐ v2 có `so_bao_gia`, `ngay_bao_gia` (`manual`, all_or_none).
- Snapshot dựng bởi `loadAndBuild` (`services/contract/snapshot-builder.ts`): **tra giá lại theo `todayInVN(now)`** mỗi lần tạo/sửa/sao chép → con chép giá cha cần đường dựng riêng (không gọi `resolveLines`). Tiền: `domain/money/line-pricing.ts` thuần (SPEC-08 FR-11).
- Quyền: catalog đóng (`packages/rbac/src/catalog.ts`), `contract:{read,write,submit,approve,issue}`; route gắn `requirePerm` ở `routes/contracts.routes.ts:382-392`.
- Nguồn trường: `SOURCE_REGISTRY` (`domain/template-sources.ts`) — `subject:*`, `derived:*`, `issue:number`.
- Lint `scripts/lint-migrations.ts`: chặn `DROP TABLE`/`RENAME`/`DROP COLUMN` **cùng PR** với code `apps/api/src/**`.
Nền tảng:
- SQLite `ALTER TABLE` chỉ hỗ trợ RENAME TABLE/COLUMN, ADD COLUMN, DROP COLUMN — **không sửa được CHECK** → đổi CHECK = dựng lại bảng (tạo bảng mới, chép, DROP, RENAME) — sqlite.org/lang_altertable.html ("Making Other Kinds Of Table Schema Changes"). drizzle-kit sinh đúng mẫu `__new_<table>` này cho SQLite.
Box (07_Mau_Tai_Lieu, đọc 2026-10-01):
- `Bao_Gia.docx`: số/ngày, Kính gửi tên khách — cửa hàng, ĐT, email; bảng STT · Gói dịch vụ · Số cửa hàng · Đơn giá · Giảm giá · Thành tiền; "Tổng cộng (đã gồm VAT)"; bằng chữ; **"Báo giá có hiệu lực 15 ngày, đến hết ngày {{hieu_luc_den}}"**; "Nhân viên phụ trách".
- `De_Nghi_Thanh_Toan.docx`: số/ngày; "Căn cứ hợp đồng số {{so_hop_dong}} ngày {{ngay_hop_dong}}"; Nội dung · Số tiền; bằng chữ; **Tài khoản 0071 0004 58213 · Vietcombank · Chủ TK CÔNG TY TNHH PHẦN MỀM NHẬT MINH**; "Nội dung chuyển khoản: NM {{so_de_nghi}}"; "Hạn thanh toán".
- `Hop_Dong_Dich_Vu.docx`: "Căn cứ báo giá số {{so_bao_gia}} ngày {{ngay_bao_gia}}"; Điều 3 "chuyển khoản 100% … trong 7 ngày kể từ ngày ký, theo đề nghị thanh toán".
- Header Bên A (cả 3 file): CÔNG TY TNHH PHẦN MỀM NHẬT MINH · 25 Nguyễn Văn Trỗi, Phường Phú Nhuận, TP. Hồ Chí Minh · 028 3997 2468 · kinhdoanh@nhatminh.vn.
Cookbook (`documents.workbook.md`): {type} sở hữu tiền tố + dãy riêng, `{PREFIX}-{YYYY}-{NNN}` reset mỗi năm theo ngày phát hành (§107-108); `source_document_id` BG → HĐ → DNTT, **con chép tiền ĐÓNG BĂNG của cha, duyệt riêng** (I5, §89, §130); `validUntil = doc_date + 15 ngày`, `paymentDue = doc_date + 7 ngày` (§172); probe `series_is_per_type_and_year` (§232).
Kế toán — PXK mẫu 02-VT (DEMO):
- **Thông tư 99/2025/TT-BTC** (ký 27/10/2025) hiệu lực **01/01/2026**, **thay TT 200/2014** (và 75/2015, 53/2016, 195/2012); Phụ lục I có 02-VT "Phiếu xuất kho". Doanh nghiệp **được tự thiết kế** biểu mẫu chứng từ nếu đủ nội dung theo Luật Kế toán → 02-VT là mẫu hướng dẫn. — vnlawfirm.vn/bieu-mau/phieu-xuat-kho-theo-thong-tu-99-mau-so-02-vt/ · safebooks.vn/mau-chung-tu-ke-toan-hang-ton-kho-theo-tt99/ · ketoanleanh.edu.vn (phieu-xuat-kho-mau-02-vt-theo-thong-tu-99-2025-tt-btc) · expertis.vn/van-ban/phu-luc-i-thong-tu-99-2025-tt-btc/
- **TT 133/2016 KHÔNG bị thay**: DNNVV vẫn dùng TT 133, hoặc chọn TT 99 (nhất quán cả năm tài chính). — thuvienphapluat.vn (thong-tu-992025-co-thay-the-thong-tu-1332016…-213873) · luatvietnam.vn (tu-01-01-2026-co-the-ap-dung-che-do-ke-toan-doanh-nghiep-cho-doanh-nghiep-vua-va-nho)
- Bố cục 02-VT (giống nhau giữa TT 200/133/99, khác dòng "ban hành kèm theo"): Đơn vị · Bộ phận · "Mẫu số 02 - VT" + dòng thông tư · **PHIẾU XUẤT KHO** · Ngày … · Số … · Nợ … Có … · Họ và tên người nhận hàng · Địa chỉ (bộ phận) · Lý do xuất kho · Xuất tại kho (ngăn lô) · Địa điểm · bảng STT (A) · Tên, nhãn hiệu, quy cách, phẩm chất vật tư, dụng cụ, sản phẩm, hàng hóa (B) · Mã số (C) · Đơn vị tính (D) · Số lượng Yêu cầu (1) / Thực xuất (2) · Đơn giá (3) · Thành tiền (4) · Cộng · Tổng số tiền (viết bằng chữ) · Số chứng từ gốc kèm theo · ký: Người lập phiếu · Người nhận hàng · Thủ kho · Kế toán trưởng (hoặc bộ phận có nhu cầu nhập) · Giám đốc. **TODO(build): đối chiếu nhãn từng chữ với file Phụ lục I TT 99 chính thức** (trang tổng hợp không hiện đủ ảnh mẫu; nhãn trên theo bố cục 02-VT TT 200 mà các nguồn nói TT 99 giữ nguyên cấu trúc).
- Lưu ý nghiệp vụ: Đơn giá/Thành tiền trên PXK là **giá xuất kho (giá vốn)** do kế toán tính, không phải giá bán → DEC-12.
Miền — lỗi kinh điển: con tra giá lại theo ngày lập (BG 2.565.000 thành HĐ 2.700.000) · DNTT gõ tay lệch HĐ · hai HĐ từ một BG · DNTT cho HĐ đã hủy · duyệt BG coi như duyệt HĐ (I5) · dãy chung cho mọi loại làm BG ăn số HĐ.

## 2. Requirements
- [FR-1] Tài liệu có `type` ∈ {`quote` BG · `contract` HD · `payment_request` DNTT · `delivery_note` PXK}; loại lấy từ mẫu được chọn, không đổi sau khi tạo → OUT-2, PRB-2
- [FR-2] Phát hành cấp số `{PREFIX}-{YYYY}-{NNN}` theo dãy **riêng từng loại, từng năm** (năm = ngày phát hành giờ VN), từ 001, liên tục, không trùng; nháp/từ chối/xóa không ăn số; hủy giữ số (I1, I6) → OUT-2
- [FR-3] Mọi loại cùng vòng đời hiện có: nháp → gửi duyệt → duyệt (không tự duyệt, mỗi bước một người, I9) → phát hành (số + bản in đóng băng, PDF) → hủy giữ số; rút lại, xóa nháp, sao chép bản từ chối/hủy; luật duyệt lấy từ phiên bản mẫu của loại (DEC-9) → OUT-3
- [FR-4] Lập con từ cha **đã phát hành**: HĐ từ BG, DNTT từ HĐ; cặp khác → 422; cha chưa phát hành/đã hủy → 409; nháp con điền sẵn khách + dòng + giá + giảm giá **chép đóng băng từ snapshot cha** (không tra giá lại) và trường "căn cứ" (số + ngày cha) → OUT-1, PRB-1
- [FR-5] HĐ từ BG: dòng + `unit_price_ex_vat` + `vat_rate_bps` + `discount_bps` của BG; tiền tính lại bằng cùng hàm thuần trên giá đóng băng → `total` HĐ = `total` BG; dòng phải hợp luật HĐ (SPEC-08 DEC-10) → 422; BG quá hạn → DEC-5 → OUT-1, Q-5
- [FR-6] DNTT từ HĐ: chép dòng + khối tiền nguyên văn từ HĐ; **số tiền đề nghị = `total` HĐ** (100%, INTENT §4); hạn thanh toán = ngày lập + 7 (Cookbook); nội dung CK "NM {số DNTT}"; tài khoản theo box → OUT-1, PRB-1
- [FR-7] Dòng + giảm giá của con **khóa** (DEC-6): sửa nháp con chỉ đổi trường nhập tay; gửi `lines`/`giam_gia` → 422 `lines-locked`; sao chép con bị từ chối/hủy giữ cha + giá đóng băng → OUT-1
- [FR-8] Số con: mỗi (cha, loại con) tối đa 1 con chưa chết (nháp/chờ/đã duyệt/phát hành) — DB bảo đảm; con bị từ chối/hủy/xóa → lập lại được (DEC-4) → Q-6
- [FR-9] Hủy cha khi còn con chưa chết → 409 `has-children` nêu số/trạng thái con (DEC-11) → OUT-3, OUT-4
- [FR-10] Drawer + API hiện cha (loại, số, trạng thái) và con; danh sách lọc theo loại; nút "Lập hợp đồng" (BG phát hành) / "Lập đề nghị thanh toán" (HĐ phát hành) có 🔒 + lý do khi không được → OUT-4
- [FR-11] BG: dòng tự do 1–50 (dịch vụ + hàng hóa, DEC-7), hiệu lực đến `doc_date + 15` (DEC-5) in "đến hết ngày …"; phát hành BG đã quá hạn → 409 `quote-expired` → OUT-3, Q-5
- [FR-12] PXK lập độc lập (không cha): 1–50 dòng **hàng hóa** (`kind=goods`), không giảm giá; in theo bố cục 02-VT (DEMO, DEC-12/13) → OUT-5, PRB-3
- [FR-13] Mẫu mỗi loại: seed mẫu BG v1, DNTT v1, PXK v1 (DEMO) + HĐ v3 (trường căn cứ báo giá lấy từ cha); `POST /templates` nhận `type`; tạo tài liệu chỉ từ mẫu đúng loại → OUT-3, OUT-5
- [FR-14] Quyền theo DEC-10; nhật ký: mọi chuyển trạng thái như hôm nay + `metadata.type`; tạo con ghi `contract.created {to:"draft", type, parent_id, parent_number}` cùng batch → OUT-3

## 3. Design
### 3.1 Data — mô hình (DEC-1 A: giữ bảng `contracts`, "tài liệu" = một dòng có `type`)
- `contracts.type` CHECK IN (`contract`,`quote`,`payment_request`,`delivery_note`).
- `parent_id TEXT NULL` (DEC-3) — cha theo chuỗi nghiệp vụ; khác `source_contract_id` (nguồn sao chép). CHECK `parent_id IS NULL OR parent_id <> id`. Index `(parent_id)`.
- Partial UNIQUE `uq_contracts_parent_child_live (parent_id, type) WHERE parent_id IS NOT NULL AND status IN ('draft','pending','approved','issued')` → FR-8 race-proof (không check-then-write).
- `valid_until TEXT NULL` (YYYY-MM-DD) — chỉ BG; chép từ snapshot để CAS dùng trực tiếp; CHECK `type = 'quote' OR valid_until IS NULL`.
- Không bao giờ ghi đè: `type`, `parent_id`, `snapshot` sau nháp, `seq/number/rendered_*`.
- Dãy số (DEC-2 A): `SERIES = { contract: HD, quote: BG, payment_request: DNTT, delivery_note: PXK }`, pad 3, quá 999 thì dài ra (printf không cắt). UNIQUE `(type, series_year, seq)` đã đúng theo loại.
- Quyền (nếu DEC-10 B): + `quote:write`, `payment_request:write`, `delivery_note:write` → catalog + seed `nhan_vien`, `quan_ly`, `giam_doc` (ai đang có `contract:write`), `INSERT OR IGNORE`.
- Mẫu seed (append-only, migration thêm): BG v1 · DNTT v1 · PXK v1 (DEMO) · HĐ v3 (= v2, `so_bao_gia`=`parent:number`, `ngay_bao_gia`=`parent:doc_date`, không còn `manual`/all_or_none).

### 3.2 Migration — expand/contract (mức spec; số file = kế tiếp lúc build)
| Bước | Nội dung | PR | Vì sao |
|---|---|---|---|
| E1 | Dựng lại `contracts` (`__new_contracts` → chép mọi dòng, `type` giữ `contract`, `parent_id`/`valid_until` NULL → DROP → RENAME) với CHECK mới + 3 cột/index trên; dựng lại mọi index/UNIQUE cũ | **PR riêng, chỉ migration** (có `DROP TABLE` → lint) | SQLite không sửa CHECK; code cũ chạy y nguyên trên bảng mới (chỉ thêm cột NULL, CHECK rộng hơn) |
| E2 | Thêm quyền (DEC-10), mẫu BG/DNTT/PXK v1, HĐ v3 | PR code (chỉ `INSERT`) | additive |
| C | Không có bước contract trong row này (không đổi tên bảng — DEC-1). `source_contract_id` giữ nghĩa sao chép | — | — |
Thứ tự: E1 merge + `db:migrate:local` trước mọi card code. Kiểm E1: đếm dòng trước/sau bằng nhau, `PRAGMA index_list(contracts)` đủ index cũ.

### 3.3 Snapshot theo loại (tài liệu mới; demo cũ wipe)
- Chung (SPEC-08 §3.2): `lines[]`, `vat_groups`, `subtotal_ex_vat`, `discount_bps`, `discount_amount`, `total_ex_vat`, `vat_total`, `total`, `total_words`, `inputs`, + `type`, + `parent: {id, type, number, doc_date, total} | null` (chép lúc tạo con).
- BG: `dates.valid_until = doc_date + 15` (DEC-5); `creator_name` (Nhân viên phụ trách). Không có `contract_end`.
- HĐ từ BG: `inputs.lines` = dòng đóng băng của BG (kèm giá, thuế suất, `price_from`) + cờ `frozen_from: parent_id`; dựng KHÔNG gọi `resolveLines`. HĐ độc lập (DEC-14 A) như hôm nay.
- DNTT: chép nguyên `lines`, `vat_groups`, các tổng, `discount_bps` từ HĐ (không tính lại); `amount_requested = parent.total`; `dates.payment_due = doc_date + 7`.
- PXK: `lines` hàng hóa (mã, tên, ĐVT, `qty`); không giá nếu DEC-12 A (`total = 0`, không bằng chữ); `discount_bps = 0`.
- Nguồn trường mới: `parent:number`, `parent:doc_date`, `derived:valid_until`, `derived:payment_due`, `derived:amount_requested`, `derived:amount_requested_in_words`, `creator:name`. Bảng PXK: `derived:goods_table` (renderer dựng bảng 02-VT, escape từng ô).

### 3.4 Luồng
1. **Tạo BG**: "+ Tạo" → chọn loại Báo giá → mẫu BG → khách + dòng (combobox như SPEC-08) + giảm giá → ô tổng (`/pricing/preview`) → Lưu nháp → gửi duyệt (QL; >10% thêm GĐ) → phát hành **BG-2026-001** (chặn nếu quá hạn).
2. **HĐ từ BG**: drawer BG đã phát hành → "Lập hợp đồng" → `POST /contracts/{bg}/children {type:"contract"}` → nháp HĐ: khách, dòng, giá, giảm giá khóa (🔒 "Giữ giá báo giá BG-2026-001"), "Căn cứ báo giá số BG-2026-001 ngày …" tự điền; người lập điền chức vụ người ký, ngày bắt đầu → duyệt **riêng** (I5; >10% → GĐ lại) → **HD-2026-00n**.
3. **DNTT từ HĐ**: drawer HĐ phát hành → "Lập đề nghị thanh toán" → nháp DNTT số tiền = tổng HĐ, hạn = hôm nay + 7 → duyệt → **DNTT-2026-001**; bản in có tài khoản box + "NM DNTT-2026-001".
4. **PXK**: "+ Tạo" → Phiếu xuất kho → khách (người nhận) + dòng hàng hóa + lý do xuất, kho (tay) → duyệt → **PXK-2026-001**; in 02-VT.
5. **Hủy**: cha có con chưa chết → 409 nêu con; hủy con trước (hoặc xóa nháp/từ chối) rồi hủy cha. Con bị hủy → "Sao chép" (thay thế, giữ cha) hoặc lập con mới từ cha.
- Rỗng/lỗi: tab loại rỗng "Chưa có báo giá nào — Tạo báo giá"; lỗi Problem+JSON hiện câu tiếng Việt (`problem-messages.ts`).

### 3.5 Màn hình (DESIGN.md: bảng 44px, tiền mono phải, ngăn 560px, 🔒 + lý do)
- Danh sách "Tài liệu": tab Tất cả · Báo giá · Hợp đồng · Đề nghị TT · Phiếu xuất kho (+ bộ lọc trạng thái hiện có); cột Loại (pill) + Số ("Nháp · chưa có số").
- "+ Tạo": chọn loại (BG · HĐ · PXK; DNTT không có — "Lập từ hợp đồng đã phát hành"). Form theo loại: BG/HĐ như SPEC-08; PXK chỉ hàng hóa, không giảm giá, thêm Lý do xuất kho / Xuất tại kho / Địa điểm.
- Drawer: khối **"Tài liệu liên quan"** (cha ↑, con ↓: loại · số · trạng thái · tổng, bấm mở); BG hiện "Hiệu lực đến dd/mm/yyyy" + nhãn "Hết hạn". Nút lập con + 🔒 lý do: "Báo giá đã hết hạn ngày …", "Đã có hợp đồng HD-2026-004 (Chờ duyệt)", "Chỉ lập từ tài liệu đã phát hành".
- Nhật ký: câu theo loại ("lập hợp đồng từ báo giá BG-2026-001").

### 3.6 API (contract-first; ghi cần `Origin`=`APP_ORIGIN` + `X-Requested-With: fetch`; Problem+JSON; `.strict()`; giữ path `/contracts` — DEC-1)
| Method + path | Quyền | Request → Response | Lỗi |
|---|---|---|---|
| `GET /contracts?type&status&…` | `contract:read` | + lọc `type`; item + `type`, `parent_id`, `valid_until` | 422 type lạ |
| `GET /contracts/{id}` | `contract:read` | `ContractDto` + `type`, `valid_until\|null`, `parent: Ref\|null`, `children: Ref[]`, `can.create_child: {type, allowed, reason_code\|null}[]`; `Ref = {id, type, number\|null, status, total, doc_date}` | 404 |
| `POST /contracts` (+`Idempotency-Key`) | write theo loại của mẫu (DEC-10) | như cũ; loại = `templates.type`; PXK: dòng chỉ hàng hóa, không `giam_gia` | 422 `parent-required` (mẫu DNTT) · 422 `lines` (PXK có dịch vụ) · 403 |
| `POST /contracts/{id}/children` (+`Idempotency-Key`) **mới** | `contract:read` + write của loại con | `{type: "contract"\|"payment_request", template_id?, values?}` → 201 `ContractDto` (nháp) | 404 · 409 `parent-not-issued` · 409 `child-exists` (+`existing_id`) · 409 `quote-expired` · 422 `child-type` · 422 `lines` (BG không hợp luật HĐ) · 422 `missing-fields` · 422 `template-type` |
| `PATCH /contracts/{id}` | như cũ | con: chỉ `values` tay | + 422 `lines-locked` |
| `POST /contracts/{id}/issue` | `contract:issue` | CAS thêm: dãy theo `type` của dòng; BG: `valid_until >= hôm nay VN`; con: cha còn `issued` | + 409 `quote-expired` · 409 `parent-not-issued` |
| `POST /contracts/{id}/void` | `contract:issue` | CAS thêm `NOT EXISTS` con chưa chết | + 409 `has-children` (+`children[]`) |
| `POST /contracts/{id}/copy` | write theo loại | con: giữ `parent_id` + giá đóng băng; BG: giá hôm nay | + 409 `child-exists` · 409 `quote-expired` (DEC-5) |
| `GET /templates?type` · `POST /templates` | như cũ | + `type` (enum 4 loại, bắt buộc khi tạo) | 422 |
| `GET /approvals/mine` | như cũ | item + `type` | |
- Tạo con = một `db.batch`: `INSERT … SELECT … WHERE EXISTS(cha issued [+ valid_until ≥ hôm nay nếu BG])` + audit guard `changes()`; 0 dòng → chẩn đoán sau (404/409 parent-not-issued/quote-expired); vi phạm UNIQUE live → 409 `child-exists`.
- Slug mới: `parent-not-issued`, `child-exists`, `quote-expired`, `child-type`, `lines-locked`, `has-children`, `parent-required`, `template-type`. OpenAPI + `pnpm client:generate` cùng commit.

## 4. Edge cases — đề xuất; bạn chốt now · later · n/a
| Category | Case here | Decision (đề xuất) |
|---|---|---|
| Input | `type` lạ; cặp cha–con sai (DNTT từ BG, HĐ từ PXK, BG từ HĐ); PXK có dòng dịch vụ/giảm giá; DNTT tạo thẳng qua `POST /contracts`; mẫu khác loại; gửi `lines`/`total`/`amount` khi sửa con | now → 422 đúng slug |
| Duplicates & identity | 2 HĐ từ 1 BG (bấm 2 lần cùng key → 1 bản; 2 người khác key → 1×201, 1×409 `child-exists`); DNTT lần 2 cho 1 HĐ → 409; sao chép HĐ con bị từ chối khi đã có HĐ con khác chưa chết → 409 | now (DEC-4) |
| Two people at once | tạo HĐ từ BG ‖ hủy BG → đúng 1 thắng (CAS hai phía); phát hành BG ‖ HĐ cùng lúc → 2 dãy độc lập; 10 phát hành song song lẫn 2 loại → mỗi dãy 001..n liên tục | now |
| Failure & retry | batch tạo con lỗi → không dòng, không audit; retry `Idempotency-Key` trả bản cũ; vi phạm UNIQUE số → thử lại (như nay) | now |
| Permissions | không đăng nhập 401; NV không có write loại X → 403 + `permission.denied`; người lập con ≠ người lập cha được (đội); người lập cha **được** duyệt con (I5 theo từng tài liệu) | now (DEC-10) |
| Lifecycle | hủy cha có con chưa chết → 409 `has-children`; cha hủy sau khi con đã hủy → được; xóa nháp con → lập lại được; con của cha chưa phát hành → 409 | now (DEC-11) |
| Money — BG hết hạn (Q-5) | lập HĐ từ BG quá `valid_until` → 409 `quote-expired`, gợi ý "Sao chép báo giá" (giá hôm nay, số mới); phát hành BG quá hạn → 409 | now (DEC-5) |
| Money — đóng băng | giá sản phẩm đổi sau BG → HĐ vẫn giá BG; HĐ `total` = BG `total`; DNTT `amount` = HĐ `total` đúng từng đồng; giảm 15% ở BG → HĐ vẫn cần GĐ | now (FR-5/6, DEC-9) |
| Money — 0đ | DNTT cho HĐ tổng 0đ (giảm 100%) | now → 422 `nothing-to-pay` (đề xuất) |
| Money — cha hủy | DNTT cho HĐ đã hủy | now → chặn (409 `parent-not-issued`; DEC-11 bảo đảm không còn DNTT sống khi HĐ hủy) |
| Time / dates | năm mới (00:05 01/01 giờ VN) → BG-2027-001, HD-2027-001… mỗi loại reset riêng; HĐ 2027 con của BG 2026 hợp lệ; `valid_until` tính theo ngày VN, "đến hết ngày" (hôm nay = valid_until vẫn lập được); DNTT hạn +7 qua năm | now |
| Q-6 lập lại sau hủy | HĐ hủy → lập HĐ mới từ cùng BG (nếu BG còn hạn) hoặc Sao chép HĐ hủy (thay thế, giữ cha) | now (DEC-4/5) |
| Nhiều đợt thanh toán, thu tiền, tồn kho, PXK từ HĐ, gửi khách | | later (INTENT §4 / Parked) |
| Đổi tên bảng → `documents` | | later (DEC-1) |

## 5. Security
- Ai làm gì: đọc mọi loại = `contract:read`; lập theo DEC-10; gửi/duyệt/phát hành/hủy dùng `contract:submit/approve/issue` chung; SoD không tự duyệt áp từng tài liệu (con không thừa hưởng duyệt của cha — I5). API quyết định; 🔒 UI chỉ gợi ý.
- Tiền luôn từ server: con chép từ snapshot cha phía server; client không gửi giá/tổng/số tiền đề nghị (422 nếu gửi). Tài khoản ngân hàng nằm trong thân mẫu DNTT (dữ liệu mẫu, append-only), không nhận từ request.
- Dữ liệu cá nhân: snapshot chép tên/ĐT/email khách như hôm nay; audit chỉ id/số/loại, không PII.
- Abuse: đoán id cha (ULID, 404); lập con từ cha của người khác (được — cùng đội, có `contract:read`); đổi `type` khi sửa (422); spam con (UNIQUE live chặn); tạo DNTT số tiền tùy ý (không thể — chép HĐ); né GĐ bằng cách lập HĐ từ BG đã duyệt (DEC-9: HĐ duyệt lại); tên sản phẩm `<script>` trong bảng 02-VT (escape từng ô).

## 6. Decisions (bạn chốt) — ★ = load-bearing
- [DEC-1] ★ identity/data · Mô hình tài liệu · options: **A** giữ bảng `contracts` + path `/contracts`, thêm loại vào `type` · **B** đổi tên `documents` + `/documents` (rename bảng/cột = PR contract riêng, client + web đổi toàn bộ) · recommended: **A** (E1 đã phải dựng lại bảng vì CHECK; đổi tên chỉ là chữ, tốn 2 PR + toàn bộ client; UI vẫn gọi "Tài liệu"; đổi tên để later) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-2] Tiền tố + dãy · options: **A** hằng số trong code (4 loại đóng, khớp CHECK), `{PREFIX}-{YYYY}-{NNN}`, năm theo ngày phát hành VN · **B** bảng `document_types` sửa được trên UI · recommended: **A** (Cookbook mặc định; loại mới = migration + mẫu; row 5 chỉ nhập mẫu cho loại có sẵn) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-3] ★ identity · Liên kết cha–con · options: **A** cột mới `parent_id` (chuỗi nghiệp vụ), `source_contract_id` giữ nghĩa sao chép · **B** dùng lại `source_contract_id` · recommended: **A** (HĐ sao chép từ HĐ bị từ chối cần cả hai: nguồn = HĐ cũ, cha = BG) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-4] ★ guard · Số con mỗi cha (Q-6) · options: **A** ≤1 con chưa chết mỗi (cha, loại) — partial UNIQUE; từ chối/hủy/xóa → lập lại được · **B** không giới hạn (vd. 1 BG → nhiều HĐ chi nhánh) · **C** đúng 1 con suốt đời · recommended: **A** (chặn trùng HĐ/DNTT bằng DB; INTENT §4 "mỗi HĐ một DNTT"; vẫn sửa sai được) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-5] ★ money · BG hết hạn (Q-5) · options: **A** chặn lập HĐ (cả sao chép HĐ con) + chặn phát hành BG quá hạn; muốn tiếp → Sao chép BG (giá hôm nay) · **B** cảnh báo, vẫn lấy giá BG · **C** cho lập, tra giá hiện hành · **A'** như A nhưng Sao chép HĐ con bị hủy/từ chối được miễn kiểm hạn · recommended: **A** (giấy in "hiệu lực 15 ngày" là cam kết giá; C phá FR-5) · decided: **A** (hạn = `doc_date + 15` theo Cookbook §172) — driver chốt theo pattern bạn ủy quyền · kèm: hạn = `doc_date + 15`, tính "đến hết ngày" (Cookbook `validUntil = doc_date + 15`; nếu bạn hiểu "15 ngày" gồm ngày lập thì +14) — chốt cùng
- [DEC-6] ★ money · Dòng của con · options: **A** khóa dòng + giảm giá (HĐ từ BG, DNTT); đổi phạm vi → BG mới · **B** HĐ sửa được SL/bớt dòng, giá vẫn đóng băng · recommended: **A** ("giữ nguyên dòng + giá của BG" — OUT-1; B làm HĐ khác BG đã gửi khách) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-7] Luật dòng BG · options: **A** tự do 1–50 dòng; lập HĐ từ BG kiểm luật HĐ (1 dịch vụ tháng + n hàng hóa) → 422 nêu lý do · **B** BG cùng luật HĐ ngay khi lập · recommended: **A** (BG chỉ bán hàng hóa vẫn hợp lệ, đi PXK không cần HĐ) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-8] ★ money · Nội dung DNTT · options: **A** bảng dòng HĐ + khối tiền chép nguyên, "Số tiền đề nghị thanh toán" = tổng HĐ · **B** một dòng "Thanh toán 100% hợp đồng số …" + số tiền · recommended: **A** (khách thấy trả cho gì, khớp HĐ; mẫu box có cột Nội dung theo gói) · decided: **A** — driver chốt theo pattern bạn ủy quyền · DNTT chỉ lập từ HĐ (không độc lập) — kèm
- [DEC-9] ★ guard · Luật duyệt từng loại (dữ liệu mẫu) · options: **A** cả 4 loại: QL duyệt + GĐ nếu giảm >10% (OUT-3 nguyên văn; DNTT mang giảm giá HĐ → GĐ duyệt lại; PXK giảm 0 → chỉ QL) · **B** BG/HĐ như A; DNTT, PXK chỉ QL · recommended: **A** (đúng INTENT; đổi sau = phiên bản mẫu mới, không đổi code) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-10] ★ security · Quyền theo loại · options: **A** dùng chung 5 mã `contract:*` cho mọi loại (đổi nhãn "tài liệu") · **B** quyền **lập** theo loại: `quote:write`, `payment_request:write`, `delivery_note:write` (+ `contract:write` cho HĐ); đọc/gửi/duyệt/phát hành dùng chung · **C** đủ 5 mã × 4 loại (20 mã) · recommended: **B** (ROADMAP row 4 "needs #2 gán quyền loại mới": vd. vai trò Kế toán chỉ lập DNTT, Thủ kho chỉ lập PXK; duyệt/phát hành giữ một chỗ để SoD + I9 không nhân 4) · decided: **B** — driver chốt theo pattern bạn ủy quyền
- [DEC-11] ★ guard/money · Hủy cha còn con · options: **A** chặn 409 `has-children` tới khi con bị hủy/xóa/từ chối · **B** cho hủy, con giữ nguyên + nhãn "cha đã hủy" · recommended: **A** (không bao giờ có DNTT sống đòi tiền HĐ đã hủy) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-12] ★ money · Giá trên PXK · options: **A** để trống Đơn giá, Thành tiền, Cộng, bằng chữ, Thực xuất (kế toán/thủ kho ghi tay — app không có giá vốn, tồn kho ngoài phạm vi) · **B** in giá bán chưa VAT theo ngày lập, nhãn DEMO · recommended: **A** (cột 3–4 của 02-VT là giá xuất kho, in giá bán là sai nghiệp vụ) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-13] PXK theo thông tư nào · options: **A** dòng "Kèm theo Thông tư 99/2025/TT-BTC" (hiện hành, thay TT 200) · **B** TT 133/2016 (DNNVV vẫn dùng) · recommended: **A**, nhãn DEMO; **TODO hỏi: Nhật Minh áp chế độ kế toán TT 99 hay TT 133?** (bố cục như nhau, chỉ khác dòng ban hành) · decided: **A** — driver chốt theo pattern bạn ủy quyền
- [DEC-14] HĐ có bắt buộc từ BG · options: **A** không — HĐ độc lập vẫn lập được như nay · **B** bắt buộc · recommended: **A** (không phá luồng đang chạy; chuỗi BG→HĐ là lối tắt) · decided: **A** — driver chốt theo pattern bạn ủy quyền

## 7. Acceptance
- [AC-1] Sau E1: số dòng `contracts` trước = sau; mọi index cũ còn; `INSERT type='invoice'` → lỗi CHECK; code cũ (trước E2) chạy suite contracts xanh — §3.2, DEC-1
- [AC-2] Phát hành lần lượt BG, HĐ, BG, DNTT, PXK → `BG-2026-001`, `HD-2026-001`, `BG-2026-002`, `DNTT-2026-001`, `PXK-2026-001`; BG bị từ chối ở giữa không ăn số; phát hành với `now` = 2027-01-01 00:05 VN → `BG-2027-001` — FR-2, §4 Time
- [AC-3] Đua: 10 BG + 10 HĐ đã duyệt, 20 phát hành song song → mỗi loại `COUNT=10, DISTINCT=10, MIN=1, MAX=10`; 5 phát hành song song 1 BG → tăng đúng 1 — FR-2, §4 Two people
- [AC-4] BG `[G6×1]` giảm 5% → phát hành; đổi giá G6 lên mức mới hôm nay; `POST /contracts/{bg}/children {type:"contract"}` → nháp HĐ `total` 2.565.000 = BG, `unit_price_ex_vat` 2.700.000, `snapshot.parent.number` = số BG, bản in có "Căn cứ báo giá số BG-2026-001"; `PATCH` gửi `lines` → 422 `lines-locked` — FR-4, FR-5, FR-7, DEC-6
- [AC-5] HĐ từ BG giảm 15% → gửi duyệt sinh bước "Giám đốc duyệt" (dù BG đã được GĐ duyệt); người lập BG duyệt được HĐ do người khác lập; người lập HĐ duyệt HĐ → 403 + `permission.denied` — FR-3, DEC-9, I5
- [AC-6] HĐ phát hành → lập DNTT → `amount_requested` = HĐ `total`, `payment_due` = hôm nay + 7, bản in có "Căn cứ hợp đồng số HD-…", tài khoản 0071 0004 58213 Vietcombank, sau phát hành "NM DNTT-2026-001"; `POST /contracts` với mẫu DNTT → 422 `parent-required` — FR-6, DEC-8
- [AC-7] Hai `POST …/children` song song (khác key) cùng BG → 1×201, 1×409 `child-exists`; cùng key → 1 bản; DNTT lần 2 cho cùng HĐ → 409; từ chối HĐ con → lập HĐ mới từ BG được — FR-8, DEC-4, §4 Duplicates
- [AC-8] Lập con từ BG nháp/đã duyệt → 409 `parent-not-issued`; DNTT từ BG → 422 `child-type`; BG `valid_until` = hôm qua (đặt `now`) → lập HĐ 409 `quote-expired`, phát hành BG 409 `quote-expired`; `valid_until` = hôm nay → được — FR-4, FR-11, DEC-5
- [AC-9] Hủy BG có HĐ con chờ duyệt → 409 `has-children` liệt kê HĐ; xóa nháp/hủy con rồi hủy BG → 200; tạo con ‖ hủy cha song song → đúng 1 thắng, trạng thái nhất quán — FR-9, DEC-11, §4 Lifecycle
- [AC-10] PXK `[DEMO-MIN-01×2, DEMO-GIAY-01×5]` → phát hành `PXK-2026-001`; bản in có "PHIẾU XUẤT KHO", "Mẫu số 02 - VT", các cột A–D/1–4, 5 chỗ ký, nhãn DEMO; dòng dịch vụ G6 → 422 `lines`; tên sản phẩm `<b>x</b>` in thành chữ — FR-12, DEC-12, DEC-13
- [AC-11] Quyền (DEC-10 B): user chỉ có `payment_request:write` lập DNTT được, lập BG → 403 + `permission.denied`; không đăng nhập → 401; `GET /me` NV/QL/GĐ có 3 mã mới; catalog +3 — FR-14, §4 Permissions
- [AC-12] Drawer HĐ hiện cha BG + con DNTT (số, trạng thái); nút "Lập hợp đồng" trên BG hết hạn có 🔒 "Báo giá đã hết hạn ngày …"; tab "Báo giá" chỉ hiện BG (e2e 1 spec desktop ở PROOF: BG → HĐ → DNTT → PXK) — FR-10, FR-13
- [AC-13] Nhật ký: tạo HĐ từ BG → 1 dòng `contract.created` có `type`, `parent_id`; chuỗi tạo→gửi→duyệt→phát hành mỗi loại = đủ dòng, mỗi dòng có số khi có — FR-14, I7

## 8. Rủi ro (đưa vào PLAN)
- R-1 E1 dựng lại bảng: quên index/UNIQUE cũ = mất guard số → AC-1 kiểm `PRAGMA index_list`; chạy E1 trên bản sao state local trước.
- R-2 `issueCas`, `voidCas`, `copy-service`, `snapshot-builder` đang cứng `contract`/`HD` + tra giá lại → sửa tập trung; test hiện có dựa `HD-2026-00n` giữ xanh.
- R-3 Lint expand/contract: E1 phải là commit/PR chỉ có migration (+ snapshot meta), không file `apps/api/src/**/*.ts`.
- R-4 Facts thiếu (TODO): kho xuất/ngăn lô/địa điểm, "Bộ phận" trên PXK, chế độ kế toán TT 99 hay 133; mẫu BG box ghi "đã gồm VAT" — BG v1 dùng khối tiền SPEC-08 (trước thuế + thuế theo nhóm), như HĐ v2.
- R-5 Wipe local: `mv apps/api/.wrangler/state …` + migrate + `dev:seed-team` + `dev:seed-products`.

## 9. Tách card gợi ý (file scope rời nhau)
| Card | Phạm vi | Phụ thuộc | Xong khi |
|---|---|---|---|
| C-09-001 E1 migration-only | `db/schema.ts`?* + migration dựng lại + meta | — | AC-1 (*schema.ts là code → nếu lint bắt, tách: migration viết tay PR riêng, `schema.ts` theo PR E2) |
| C-09-002 OpenAPI + client | `dto/contracts.ts`, `dto/templates.ts`, `dto/error.ts`, routes (501 cho `/children`), client | 001 | client sạch |
| C-09-003 dãy số theo loại + quyền + mẫu seed | `domain/contract/number.ts`, `dao/contract-issue-dao.ts`, `catalog.ts`, migration E2 | 001 | AC-2, AC-3, AC-11 |
| C-09-004 tạo con + khóa dòng + hủy cha | `services/contract/{children,copy,update,snapshot-builder}`, `dao/contract-write-dao.ts`, `domain/template-sources.ts`, render | 002, 003 | AC-4..AC-9, AC-13 |
| C-09-005 PXK + bảng 02-VT | `domain/contract/render.ts` (goods_table), mẫu PXK | 003 | AC-10 |
| C-09-006 web | `apps/web/src/features/contracts/**`, `problem-messages.ts`, `audit-sentence.ts`, `permission-labels.ts` | 004, 005 | AC-12 |
| C-09-007 e2e + PROOF | `apps/web/e2e/**`, PLAN PROOF log | 001–006 | AC-12 |

## 10. Trace check (trước STOP)
- [x] FR → OUT/PRB: FR-1 OUT-2 · FR-2 OUT-2 · FR-3 OUT-3 · FR-4 OUT-1 · FR-5 OUT-1/Q-5 · FR-6 OUT-1 · FR-7 OUT-1 · FR-8 Q-6 · FR-9 OUT-3/4 · FR-10 OUT-4 · FR-11 OUT-3/Q-5 · FR-12 OUT-5/PRB-3 · FR-13 OUT-3/5 · FR-14 OUT-3; PRB-1 → FR-4/5/6 · PRB-2 → FR-1/2/3/10 · PRB-3 → FR-12
- [x] AC → FR/edge/DEC: AC-1 DEC-1 · AC-2 FR-2, Time · AC-3 Two people · AC-4 FR-4/5/7, DEC-6 · AC-5 FR-3, DEC-9 · AC-6 FR-6, DEC-8 · AC-7 FR-8, DEC-4, Duplicates · AC-8 FR-4/11, DEC-5, Money BG · AC-9 FR-9, DEC-11, Lifecycle · AC-10 FR-12, DEC-12/13 · AC-11 FR-14, DEC-10, Permissions · AC-12 FR-10/13 · AC-13 FR-14 · DEC-2 → AC-2 · DEC-3 → AC-4/AC-7 · DEC-7 → AC-4 (luật HĐ trên BG, thêm ca 422 ở test card 004) · DEC-14 → suite HĐ độc lập hiện có
- [ ] edge "now" có AC: đủ trừ "Money — 0đ" (`nothing-to-pay`) → thêm ca vào test card 004 khi bạn chốt
- [ ] DEC-1..14 chốt · [ ] SPEC duyệt
