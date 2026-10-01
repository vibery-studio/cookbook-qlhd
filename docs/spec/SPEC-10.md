# SPEC-10: Nhập mẫu từ Word (.docx) — đọc `{{placeholder}}`, đặt nhãn/kiểu/bắt buộc, lưu thành mẫu hoặc phiên bản mới

Status: Approved 2026-10-01 (driver chốt theo pattern bạn ủy quyền)
Intent: docs/intent/INTENT-10.md · Roadmap: ROADMAP-02 row 5 · **Chạy song song row 4 (SPEC-09)**: chỉ có một chỗ nối với row 4 là "loại của mẫu" (DEC-12, card C-10-005). Mọi card khác bắt đầu được trước khi row 4 xong (§9).

## 1. Research (2026-10-01)
Code (đã kiểm):
- `templates(id, type, name, name_norm UNIQUE, subject_type, current_version_id, active, …)`. `type` hôm nay luôn là `"contract"` (`db/schema.ts:356`). `CreateTemplateBody.type = z.literal("contract")` (`dto/templates.ts`). `template_versions` append-only (trigger `0012`), UNIQUE `(template_id, version_no)`.
- Đường ghi: `POST /templates` (v1, 409 `duplicate` theo tên) · `POST /templates/{id}/versions` (`expected_version_no` CAS, 409 `stale`). Cả hai đi qua `bodyLimit → requireAuth → requirePerm("template:write") → withIdempotency` và chạy `checkTemplate` **trước** khi ghi (`services/template-write-service.ts`). `template:write` chỉ seed cho `giam_doc` (`0010_seed_foundation.sql:29`).
- `checkTemplate` (`domain/template-check.ts`): thẻ cho phép `p h1 h2 h3 br strong em ul ol li table tr td th div span`, chỉ một thuộc tính `class` ∈ `center right b sig`; chặn `javascript:`; key `[a-z][a-z0-9_]*`; `{{#if k}}…{{/if}}`; ghi chú nội bộ (`ghi chu noi bo`, `xoa truoc khi gui khach`, so sau khi bỏ dấu); `required` mà không có `source` thì lỗi; nguồn tra `SOURCE_REGISTRY` (`template-sources.ts`); `lines` ⇔ `derived:lines_table`; `LIMITS` body 64 KB, 60 trường, 10 bước.
- Trộn tài liệu: trường `manual` do người lập nhập (`domain/contract/snapshot.ts:152`), giá trị được escape HTML. Web dựng form theo `version.fields` nên dùng chung được cho mọi mẫu (`contract-form-modal.tsx:82`). Bản in hiển thị trong iframe sandbox (`paper-overlay.tsx:63`). Màn "Mẫu hợp đồng" hôm nay chỉ để xem (`features/templates/templates-screen.tsx`).
Box (`07_Mau_Tai_Lieu/*.docx`, đã mở `word/document.xml` bằng `unzip -p`):
- 3 file, mỗi file khoảng 37 KB. Giải nén ra khoảng 830 KB, trong đó `styles.xml` 349 KB và `stylesWithEffects.xml` 438 KB; riêng `document.xml` chỉ 3–6 KB. Không có ảnh, đầu/chân trang, macro hay liên kết ngoài. Rels chỉ trỏ tới styles/settings/fontTable/theme/numbering/customXml.
- Mỗi `{{key}}` nằm trọn trong một `<w:t>` (file sinh bằng máy: **không có placeholder nào bị tách run**). Word thật khi người dùng sửa và lưu lại thì hay tách một chuỗi thành nhiều `<w:r>` (theo rsid, `w:proofErr`, đổi định dạng giữa chừng) — Microsoft "Splitting Runs in Open XML…" (learn.microsoft.com/archive/blogs/ericwhite) · docxtemplater "Deep dive" (docxtemplater.com/docs/deep-dive-into-docxtemplater-internals). Vì vậy fixture test phải tự dựng trường hợp tách run.
- `Bao_Gia.docx`: 15 trường (`so_bao_gia ngay_bao_gia ten_khach ten_cua_hang sdt email ten_goi so_cua_hang don_gia giam_gia thanh_tien tong_tien tong_tien_bang_chu hieu_luc_den nv_phu_trach`). Có một bảng 6 cột; dòng 2 chứa `ten_goi so_cua_hang don_gia giam_gia thanh_tien` (đây là bảng dòng hàng). Có 1 `Heading1`.
- `Hop_Dong_Dich_Vu.docx`: 16 trường. Đoạn đầu là "Ghi chú nội bộ (xóa trước khi gửi khách)…". Có `Heading1`, 7 `Heading2` và một bảng chữ ký 2×2.
- `De_Nghi_Thanh_Toan.docx`: 11 trường, trong đó `so_de_nghi` xuất hiện 2 lần. Có bảng 2 cột, một ô ghi `{{ten_goi}} × {{so_cua_hang}} cửa hàng`.
Stack (tài liệu chính thức, đọc 2026-10-01):
- Workers **không có `DOMParser`** (community.cloudflare.com/t/domparser-in-worker/169917 · github.com/aws/aws-sdk-js-v3/issues/7375). `DecompressionStream` có hỗ trợ `deflate-raw` (developers.cloudflare.com/workers/runtime-apis/web-standards/).
- Giới hạn của Workers: 128 MB bộ nhớ cho mỗi isolate · CPU 10 ms/request ở gói Free, mặc định 5 phút ở gói Paid · body request tối đa 100 MB ở Free/Pro (developers.cloudflare.com/workers/platform/limits/).
- **fflate**: `unzipSync(data, { filter })` cho xem `file.name` và `file.originalSize` trước khi giải nén, nên bỏ qua được các phần không cần (styles 349 KB…). Phần unzip khoảng 5 kB minified. Tài liệu ghi chú "File sizes are sometimes not set" (github.com/101arrowz/fflate). Tài liệu không nói gì về zip bomb, nên phải tự đếm số byte thật sau khi giải nén.
- **fast-xml-parser**: JS thuần, `preserveOrder: true` giữ đúng thứ tự các nút (cần cho văn bản trộn lẫn thẻ). `processEntities` có giới hạn mở rộng chống billion-laughs, và đặt `false` thì tắt hẳn (context7 `/naturalintelligence/fast-xml-parser`, configuration.md · errors.md).
- **mammoth.js**: có bản cho trình duyệt (`mammoth.browser.js`), ảnh mặc định nhúng base64. README viết: "Mammoth performs no sanitisation of the source document, and should therefore be used extremely carefully with untrusted user input" (github.com/mwilliamson/mammoth.js).
- `.docm` (có macro): content type của phần chính là `application/vnd.ms-word.document.macroEnabled.main+xml`, kèm `word/vbaProject.bin` (learn.microsoft.com MS-OFFMACRO2 "Main Document"). Phần chính của `.docx` thường có content type `…wordprocessingml.document.main+xml`, đọc trong `[Content_Types].xml`.
Miền (lỗi kinh điển khi nhập mẫu): placeholder bị tách run nên "biến mất" · ghi chú nội bộ lọt lên giấy gửi khách · trường mẫu cần mà app không có nguồn, lần lập đầu in ô trống (workbook §2c) · HTML/script lọt vào từ nội dung file · zip/XML bomb · nhập đè làm đổi tài liệu đã phát hành.

## 2. Requirements
- [FR-1] `POST /templates/import/preview` nhận một file `.docx` (≤ 2 MB). Server đọc file trong bộ nhớ và trả về: chữ mẫu HTML thuộc tập thẻ `checkTemplate` cho phép · danh sách trường (key, tên gốc, số lần, gợi ý) · các bảng có chứa trường · phần đã bỏ và cảnh báo · lỗi `checkTemplate` chạy thử với gợi ý. **Không ghi gì** vào D1/KV → OUT-1, OUT-3
- [FR-2] Đọc `{{…}}` theo **chữ của cả đoạn**: ghép mọi `<w:t>` trong một `<w:p>` hay một ô bảng rồi mới quét, nên placeholder bị tách thành nhiều run vẫn ra đúng một trường. Placeholder luôn được in ra dạng chữ thường `{{key}}`, bỏ định dạng của các run mà nó trải qua → OUT-1
- [FR-3] Tên trường được chuẩn hóa (DEC-3): bỏ khoảng trắng hai đầu · `#if k` / `/if` giữ cú pháp · tên tiếng Việt/hoa/khoảng trắng/gạch ngang đổi thành slug `[a-z][a-z0-9_]*`, nhãn gợi ý = tên gốc, kèm cảnh báo "đã đổi". Slug rỗng hoặc bắt đầu bằng số thì báo lỗi nêu tên gốc. Trùng tên thì gộp làm một trường và ghi số lần → OUT-1, OUT-3
- [FR-4] Gợi ý cho từng trường (DEC-5): nếu nhập làm phiên bản mới thì lấy trường cùng key ở phiên bản hiện tại của mẫu đó; nếu không có thì lấy trường cùng key ở phiên bản hiện tại của mẫu khác (mẫu mới nhất thắng); nếu vẫn không có thì `{label: tên gốc, type: text, required: true, source: manual}`. Trường `manual` được đánh dấu "người lập nhập tay" (workbook §2c) → OUT-2
- [FR-5] Bảng dòng hàng (DEC-4): khi gọi kèm `lines_table=<index>`, bảng thứ `index` được thay bằng `{{bang_hang}}` (kiểu `lines`, nguồn `derived:lines_table`). Các trường chỉ nằm trong bảng đó bị bỏ khỏi danh sách, **trừ `giam_gia`** (giảm giá cả tài liệu, luật duyệt >10% cần nó): giữ làm trường thường và chèn `<p>Giảm giá: {{giam_gia}}%</p>` ngay sau `{{bang_hang}}` (P-7, driver chốt theo pattern: giữ chốt duyệt) → OUT-2, OUT-4
- [FR-6] Ghi chú nội bộ: đoạn nào chứa cụm `checkTemplate` coi là ghi chú nội bộ thì bị bỏ khỏi chữ mẫu và trả trong `removed[]` (DEC-8) → OUT-3
- [FR-7] Phần không chuyển được (ảnh, đầu/chân trang, hộp chữ, chú thích cuối trang, bình luận, ô gộp, bảng lồng, màu/font/cỡ chữ, ngắt trang, kiểu đánh số) bị bỏ hoặc làm phẳng, mỗi loại có **một cảnh báo** kèm số lần. Đầu/chân trang có `{{` thì cảnh báo riêng (DEC-7) → OUT-3
- [FR-8] File bị từ chối với 422 `docx-invalid` nêu `reason` trong các trường hợp: không phải zip/docx · `.docm`/có macro · thiếu `word/document.xml` · XML hỏng hoặc có `<!DOCTYPE` · vượt giới hạn giải nén · quá nhiều mục. Không bao giờ tải tài nguyên ngoài, không chạy macro, không đọc phần không cần (DEC-9) → OUT-3
- [FR-9] Màn "Nhập từ Word" trong "Mẫu hợp đồng" (chỉ người có `template:write`): chọn **mẫu mới** (tên + loại) hoặc **phiên bản mới của mẫu X** → tải file → xem trước (iframe sandbox) + bảng trường (nhãn · kiểu · bắt buộc · nguồn · lựa chọn khi kiểu `choice`) + cảnh báo/phần đã bỏ + nút "Bảng này là bảng dòng hàng" → **Lưu**. Lưu gọi `POST /templates` hoặc `POST /templates/{id}/versions` **hiện có**, lỗi 422/409 hiện ngay cạnh trường bị lỗi → OUT-1, OUT-2, OUT-3
- [FR-10] Lưu (DEC-6): phiên bản mới chép `approval_policy`, `default_line_items`, `default_clauses` của phiên bản hiện tại, và `field_rules` nào còn đủ key (rule bị bỏ thì có cảnh báo). Mẫu mới nhận quy trình mặc định của box (Quản lý duyệt; giảm > 10% thêm Giám đốc) và để `[]` cho phần còn lại. `note` = "Nhập từ <tên file>" → OUT-2
- [FR-11] Loại của mẫu (DEC-12): mẫu mới mang khóa loại của row 4 trên `templates.type`. Trước khi row 4 xong chỉ có `contract` (hiện là "Hợp đồng"). Sau khi row 4 xong, danh sách loại lấy từ nguồn của row 4 (C-10-005) → OUT-2, OUT-4

## 3. Design
### 3.1 Data
- **Không có bảng hay migration mới.** Ghi qua đường `insertTemplateWithV1` / `insertNextVersionCas` hiện có (append-only, CAS, audit `template.created`/`template.version_created` trong cùng batch).
- File `.docx` không lưu ở đâu cả (DEC-10). Dấu vết nằm ở `template_versions.note` = "Nhập từ Bao_Gia.docx".

### 3.2 Chuyển docx → chữ mẫu (domain thuần, `domain/docx/*`, không import Hono/DB)
1. **Kiểm gói**: 4 byte đầu phải là `PK\x03\x04`, nếu không thì `not_docx` (gồm cả `.doc` cũ và docx có mật khẩu — hai loại này là file OLE, không phải zip). `unzipSync` với `filter` chỉ nhận `[Content_Types].xml`, `word/document.xml`, `word/_rels/document.xml.rels`, và tên các phần `word/header*.xml`/`footer*.xml` (chỉ để dò `{{`). Số mục trong zip > 1000 thì `too_many_entries`. `originalSize` khai > 2 MB, hoặc không khai, thì `too_large_inflated`. Sau khi giải nén, đếm byte thật; > 2 MB thì `too_large_inflated`.
2. **Content type**: trong `[Content_Types].xml`, phần chính có `macroEnabled` hoặc gói có `word/vbaProject.bin` thì `macro_enabled`. Không có phần chính `wordprocessingml.document.main+xml` thì `not_docx`.
3. **XML**: chuỗi có `<!DOCTYPE` thì `xml_invalid`. Dùng fast-xml-parser với `preserveOrder: true, ignoreAttributes: false, processEntities: false`; tự giải mã 5 entity chuẩn và `&#…;`. Parse lỗi thì `xml_invalid`.
4. **Đi cây `w:body`**:
   - `w:p` → `<p>`. `pStyle` Title/Heading1 → `<h1>`, Heading2 → `<h2>`, Heading3–9 → `<h3>`. `w:jc` center → `class="center"`, right/end → `class="right"`.
   - Run có `w:b` → `<strong>`, `w:i` → `<em>`. Các run liền nhau cùng định dạng được gộp lại.
   - `w:br` → `<br>` (ngắt trang thì bỏ). `w:tab` → khoảng trắng.
   - Đoạn có `numPr` liền nhau → `<ul><li>` (bỏ kiểu đánh số).
   - `w:tbl` → `<table><tr><td>`. Ô gộp (`gridSpan`/`vMerge`) và bảng lồng được làm phẳng, kèm cảnh báo.
   - `w:hyperlink`, `w:sdt`, `w:smartTag`, `w:ins` → lấy nội dung bên trong (bỏ URL). `w:del`, `w:instrText`, `w:drawing`/`w:pict`/`w:object`, `w:txbxContent`, mốc footnote/comment, `w:altChunk` → bỏ, kèm cảnh báo.
   - **Mọi chữ đều được escape** `& < > "`.
5. **Placeholder**: quét chữ đã ghép của từng đoạn/ô bằng `\{\{([\s\S]*?)\}\}`, chuẩn hóa theo FR-3, rồi chèn lại thành `{{key}}` trơn. Đoạn còn `{{` thiếu `}}` thì giữ nguyên chữ để `checkTemplate` báo `placeholder_without_field` (lỗi chặn lưu).
6. **Ghi chú nội bộ**: dùng chung hàm `fold` + `INTERNAL_NOTE_PHRASES` của `template-check.ts` (export ra, không chép lại). Đoạn trùng cụm thì bỏ và đưa vào `removed[]`.
7. Kết quả: `{ body, placeholders[], tables[], removed[], warnings[] }`. Hàm thuần không bao giờ ném lỗi ra ngoài; lỗi gói/XML trả `{ error: reason }`.

### 3.3 Screens / flow (DESIGN.md: màn "Mẫu hợp đồng" — "🔒 only Giám đốc edits")
- Danh sách mẫu có nút "Nhập từ Word". Người không có `template:write` thấy 🔒 kèm lý do (LockedNote). Chi tiết mẫu có nút "Nhập phiên bản mới từ Word".
- **Bước 1**: chọn file (`accept=.docx`). Với mẫu mới: nhập tên (gợi ý từ tên file, `_` đổi thành khoảng trắng) và chọn loại. Bấm "Đọc file" → đang tải (skeleton) → lỗi 413/415/422 `docx-invalid` hiện câu tiếng Việt theo `reason`.
- **Bước 2**:
  - Trái: bản xem trước (iframe `sandbox` không có `allow-scripts`, `srcdoc` = body đã highlight `{{…}}`).
  - Phải: bảng trường gồm key · số lần · nhãn · kiểu · bắt buộc · nguồn (danh sách `sources[]` từ API) · lựa chọn (khi `choice`), cộng nhãn "gợi ý từ: phiên bản hiện tại / mẫu khác / mới".
  - Phía trên: ô "Đã bỏ" (ghi chú nội bộ) và "Cảnh báo". Bảng có trường → nút "Đây là bảng dòng hàng" (đọc lại file với `lines_table`).
  - `check_errors` hiện cạnh trường; còn lỗi thì nút "Lưu" bị tắt.
- **Bước 3 (Lưu)**: `POST /templates` hoặc `/versions` kèm `Idempotency-Key`.
  - 201 → mở chi tiết mẫu ở phiên bản mới, toast "Đã lưu phiên bản N".
  - 409 `duplicate` → "Tên mẫu đã có", kèm link tới mẫu đó.
  - 409 `stale` → "Mẫu vừa có phiên bản mới, đọc lại" (giữ phần đã điền, gọi lại preview với `template_id`).
  - 422 `template-check-failed` → gắn lỗi vào từng trường.
- Trạng thái rỗng: file không có `{{…}}` → "File không có trường nào" (vẫn lưu được nếu `checkTemplate` cho qua).

### 3.4 API (contract-first; build cập nhật OpenAPI + `pnpm client:generate` ở C-10-001)
- `POST /templates/import/preview?template_id=<ULID>&lines_table=<int ≥0>` — tag `templates`, security cookie.
  - Middleware: `bodyLimit(2 MB) → requireAuth → requirePerm("template:write")`. Không dùng `withIdempotency` (không ghi). Origin + `X-Requested-With: fetch` như mọi POST.
  - Request: body nhị phân, `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DEC-13).
  - 200 `TemplateImportPreview`:
    `{ body: string, placeholders: [{ key, original, count, table_index: int|null, suggested: TemplateField, suggestion_from: "current_version"|"other_template"|"none" }], tables: [{ index, rows, cols, placeholder_keys: string[] }], removed: [{ kind: "internal_note", text }], warnings: [{ code, message, count }], sources: string[], base: { template_id: ULID|null, version_no: int|null, approval_policy, field_rules, default_line_items, default_clauses }, check_errors: CheckFailedItem[], stats: { body_bytes, fields } }`
  - Lỗi (Problem+JSON):
    - 401
    - 403 (kèm audit `permission.denied` như hiện có)
    - 404 `template_id` không tồn tại
    - 413 file > 2 MB
    - 415 sai content type
    - 422 `validation` (`lines_table` vượt số bảng)
    - 422 `docx-invalid` `{ reason: not_docx | macro_enabled | no_document | xml_invalid | too_large_inflated | too_many_entries }`
- **Không đổi**: `POST /templates`, `POST /templates/{id}/versions`, `GET /templates*`. Riêng `CreateTemplateBody.type` sẽ được **row 4** nới ra (C-10-005 chỉ nối danh sách).
- `ProblemType` thêm `DocxInvalid: "docx-invalid"`. `problem-messages.ts` (web) thêm câu cho từng `reason`.

## 4. Edge cases — chốt theo pattern bạn ủy quyền
| Category | Case here | Decision |
|---|---|---|
| Input | Placeholder bị tách thành nhiều run (rsid, `proofErr`, đổi đậm giữa chừng) | **now** — ghép chữ cả đoạn (FR-2), fixture tự dựng |
| Input | Placeholder vắt qua hai đoạn hoặc hai ô | **now** — giữ chữ; `checkTemplate` báo `{{` thiếu `}}`, chặn lưu |
| Input | Tên trường tiếng Việt / hoa / có khoảng trắng (`{{Tên khách}}`) | **now** — slug + nhãn gốc + cảnh báo (DEC-3) |
| Input | Tên sai cú pháp (`{{1abc}}`, `{{}}`, `{{a-b}}`) | **now** — slug được thì đổi; rỗng/bắt đầu bằng số thì báo lỗi nêu tên gốc |
| Input | `{{#if k}}…{{/if}}` trong Word | **now** — giữ cú pháp, `checkTemplate` kiểm đóng/mở |
| Input | File không có `{{…}}` | **now** — báo "không có trường", vẫn lưu được |
| Input | Tên trường có trong file nhưng không có nguồn tương ứng trong app | **now** — gợi ý `manual`, nhãn "người lập nhập tay" (workbook §2c) |
| Input | Trường tiền (`tong_tien`) để `manual` | **now** — chỉ cảnh báo trên UI (badge); luật server giữ như hôm nay |
| Input | Bảng · ảnh · đầu/chân trang · hộp chữ · footnote | bảng **now** (`table/tr/td`, gộp ô thì làm phẳng) · ảnh, đầu/chân trang, hộp chữ, footnote **later** (bỏ + cảnh báo; header có `{{` thì cảnh báo riêng) — vì phải mở rộng tập thẻ và khuôn in |
| Input | Kiểu đánh số Word, font/màu/cỡ chữ | **later** — `ul/li` + khuôn in A4 hiện có |
| Input | Tracked changes (`w:ins`/`w:del`) | **now** — coi như đã chấp nhận hết, kèm cảnh báo |
| Input | Ghi chú nội bộ trong file | **now** — tự bỏ + liệt kê (DEC-8) |
| Input | File quá to (> 2 MB) | **now** — 413 |
| Input | Không phải docx (pdf, `.doc` cũ, docx có mật khẩu, zip thường) | **now** — 422 `docx-invalid not_docx` |
| Input | `.docm` / có macro / liên kết ngoài / altChunk | **now** — macro thì từ chối; liên kết ngoài không bao giờ tải; altChunk bỏ + cảnh báo |
| Input | Zip bomb / XML bomb | **now** — chỉ giải nén phần cần, trần 2 MB đếm byte thật, ≤ 1000 mục; có `<!DOCTYPE` thì từ chối, không mở entity |
| Input | Kết quả > 64 KB hoặc > 60 trường | **now** — `check_errors` `too_large` ngay ở bước xem trước |
| Security | XSS từ nội dung file (`<script>` trong chữ, URL `javascript:`) | **now** — escape mọi chữ, chỉ thẻ do converter sinh, bỏ URL; lưu thì chạy lại `checkTemplate`; xem trước trong iframe sandbox không có script |
| Duplicates | Cùng placeholder nhiều lần (`so_de_nghi` ×2) | **now** — một trường, `count` = 2 |
| Duplicates | Hai tên khác nhau cho ra cùng slug | **now** — gộp làm một trường + cảnh báo |
| Duplicates | Tên mẫu mới trùng mẫu đã có | **now** — 409 `duplicate` (hiện có) |
| Duplicates | Nhập lại đúng file cũ làm phiên bản mới | **now** cho phép (append-only, vô hại); báo "giống phiên bản hiện tại" **later** |
| Two people | Hai người cùng nhập phiên bản mới cho một mẫu | **now** — `expected_version_no` CAS → 409 `stale` (hiện có) |
| Two people | Cùng tạo mẫu mới trùng tên | **now** — UNIQUE `name_norm` → một bên 409 |
| Failure & retry | Bấm Lưu hai lần hoặc mạng rớt | **now** — `Idempotency-Key` (hiện có); xem trước không ghi gì nên gọi lại thoải mái |
| Failure & retry | CPU 10 ms ở gói Free | **later** — đo ở PROOF (box: `document.xml` 3–6 KB, bỏ qua styles); TODO: bạn cho biết gói Workers khi deploy |
| Permissions | NV/QL gọi preview · chưa đăng nhập | **now** — 403 + `permission.denied` / 401 |
| Lifecycle | Phiên bản mới không đổi tài liệu đã phát hành; nháp vẫn giữ phiên bản cũ | **now** — có sẵn (append-only, snapshot); AC-6 chứng minh lại |
| Lifecycle | Xóa mẫu / hoàn tác phiên bản | n/a — không xóa; muốn quay lại thì nhập lại file cũ thành phiên bản mới |
| Money | — | n/a (mẫu không chứa tiền; tiền vẫn do server tính theo SPEC-08) |
| Time / dates | — | n/a |

## 5. Security
- Ai làm gì: xem trước và lưu chỉ cho `template:write` (Giám đốc). Đọc mẫu giữ nguyên `contract:read`. Không thêm mã quyền.
- Dữ liệu cá nhân: không có, vì file mẫu chỉ chứa chỗ trống. Nội dung file không ghi log, không lưu, không đưa vào audit (audit chỉ ghi `template.version_created` như hiện có).
- Kẻ tấn công thử:
  - Script/HTML trong chữ, URL `javascript:` → bị escape, URL bị bỏ, `checkTemplate` chặn lần hai.
  - Zip/XML bomb → trần byte thật, không mở entity, từ chối DOCTYPE.
  - Macro / liên kết ngoài → từ chối hoặc không bao giờ tải.
  - Đường dẫn zip `../` → chỉ đọc theo tên cố định, không ghi file.
  - File khổng lồ → 413 trước khi parse.
  - Gọi khi không có quyền → 403 + audit.
  - Sửa body giữa lúc xem trước và lúc lưu → không thêm quyền gì, vì lưu vẫn qua `checkTemplate` + `template:write` như gọi API hôm nay.

## 6. Decisions (driver chốt theo pattern bạn ủy quyền)
- [DEC-1] Cách đọc docx · options: **A** mammoth (bản browser) rồi lọc HTML · **B** fflate (unzip) + fast-xml-parser + bộ đi cây WordprocessingML tự viết trong Worker · **C** đọc ở SPA, server chỉ chạy `checkTemplate` · recommended: **B** — Workers không có DOMParser. mammoth "performs no sanitisation", sinh HTML rộng hơn tập thẻ cho phép (ảnh base64, link), và có thể cắt placeholder khi định dạng run khác nhau. B nhỏ (unzip khoảng 5 kB), `filter` bỏ qua styles 349 KB nên đỡ CPU, là hàm thuần test được trong pool Workers, và một nơi duy nhất quyết định tập thẻ. C để luật nằm ở client · decided: **B** (driver chốt theo pattern bạn ủy quyền)
- [DEC-2] Đường lưu · options: **A** xem trước không trạng thái, client gửi body + fields vào `POST /templates` · `/versions` hiện có · **B** phiên nhập lưu ở KV/D1 + endpoint commit · **C** một endpoint multipart vừa tải vừa tạo · recommended: **A** — dùng lại nguyên đường ghi, CAS, idempotency, audit và `checkTemplate`; không có trạng thái mới; không mở thêm quyền vì `template:write` đã gửi được body bất kỳ hôm nay · decided: **A** (driver chốt theo pattern bạn ủy quyền)
- [DEC-3] Tên trường không đúng `[a-z][a-z0-9_]*` · options: **A** từ chối, bắt sửa trong Word · **B** tự đổi thành slug, nhãn = tên gốc, kèm cảnh báo · recommended: **B** — chủ doanh nghiệp người Việt sẽ gõ `{{Tên khách}}`; đổi tên là tất định và có hiển thị; key vẫn qua luật hiện có · decided: **B** (driver chốt theo pattern bạn ủy quyền)
- [DEC-4] Bảng dòng hàng trong file (`Bao_Gia.docx` có dòng `ten_goi…thanh_tien`) · options: **A** bắt Giám đốc sửa Word, đặt `{{bang_hang}}` · **B** nút "Đây là bảng dòng hàng": server thay bảng đó bằng `{{bang_hang}}` (`lines`) · **C** vòng lặp `{{#each}}` · recommended: **B** — dùng lại bảng dòng hàng của SPEC-08 DEC-7 (server dựng bảng, tiền do server tính), không cần cú pháp mới, đạt done-check với file box nguyên trạng · decided: **B** (driver chốt theo pattern bạn ủy quyền)
- [DEC-5] Gợi ý nhãn/kiểu/nguồn · options: **A** để trống · **B** lấy theo key từ phiên bản hiện tại (mẫu đích, rồi tới các mẫu khác) · **C** bảng gợi ý viết cứng · recommended: **B** — gợi ý lấy từ dữ liệu, không thêm bảng nào; mẫu seed v2 đã có `ten_khach`→`subject:contact_person`, `so_hop_dong`→`issue:number`…; row 4 seed mẫu BG/DNTT thì gợi ý tự có thêm · decided: **B** (driver chốt theo pattern bạn ủy quyền)
- [DEC-6] Quy trình duyệt, field_rules, mặc định khi lưu · options: **A** phiên bản mới chép từ phiên bản hiện tại; mẫu mới dùng quy trình mặc định của box · **B** thêm màn sửa quy trình · recommended: **A** — đúng luật box ("giảm giá trên 10% cần Giám đốc duyệt", INTENT-09 Q-3 áp cho mọi loại); màn sửa quy trình để sau · decided: **A** (driver chốt theo pattern bạn ủy quyền)
- [DEC-7] Giữ gì từ Word · options: **A** chỉ tập thẻ `checkTemplate` (đoạn, tiêu đề 1–3, đậm/nghiêng, căn giữa/phải, bảng, danh sách, xuống dòng); phần còn lại bỏ kèm cảnh báo · **B** mở rộng tập thẻ (ảnh, colspan, style) · recommended: **A** — không nới luật an toàn, khuôn in giữ nguyên; ảnh/đầu trang để sau · decided: **A** (driver chốt theo pattern bạn ủy quyền)
- [DEC-8] Ghi chú nội bộ · options: **A** tự bỏ + liệt kê · **B** chặn, bắt sửa file · recommended: **A** — workbook §2c ("removed from the body at import"), hiển thị rõ chứ không bỏ ngầm · decided: **A** (driver chốt theo pattern bạn ủy quyền)
- [DEC-9] Giới hạn · options: file 2 MB · giải nén 2 MB đếm byte thật · ≤ 1000 mục · body 64 KB + 60 trường (giữ `LIMITS`) · recommended: như trên — file box khoảng 37 KB, `document.xml` ≤ 6 KB, nên trần dư khoảng 50 lần mà vẫn xa giới hạn 128 MB của Workers · decided: **như trên** (driver chốt theo pattern bạn ủy quyền)
- [DEC-10] Lưu file gốc · options: **A** không lưu, `note` = "Nhập từ <tên file>" · **B** lưu R2 để tải lại · recommended: **A** — không cần tài nguyên Cloudflare mới (deploy do bạn làm); Giám đốc vẫn giữ file Word gốc · decided: **A** (driver chốt theo pattern bạn ủy quyền)
- [DEC-11] Ai được nhập · options: **A** `template:write` (hôm nay là Giám đốc) · **B** mã mới `template:import` · recommended: **A** — nhập mẫu cũng chỉ là ghi mẫu; không thêm mã vào catalog để khỏi đụng row 4 · decided: **A** (driver chốt theo pattern bạn ủy quyền)
- [DEC-12] Loại của mẫu (chỗ nối với row 4) · options: **A** chờ row 4 xong mới làm row 5 · **B** dùng khóa loại của row 4 trên `templates.type`; trước khi row 4 xong chỉ có `contract` (= HD); C-10-005 nối danh sách loại sau · recommended: **B** — 5/6 card làm ngay được; chỗ nối chỉ là một ô chọn + giá trị `type` gửi vào `POST /templates`. Nếu row 4 đổi tên cột hay giá trị (vd. `doc_type`, `HD`), chỉ C-10-005 phải theo · decided: **B** (driver chốt theo pattern bạn ủy quyền)
- [DEC-13] Định dạng request · options: **A** body nhị phân + query · **B** multipart · recommended: **A** — một file, không cần parser multipart; `bodyLimit` đếm thẳng; OpenAPI `format: binary` · decided: **A** (driver chốt theo pattern bạn ủy quyền)

## 7. Acceptance
- [AC-1] GĐ `POST /templates/import/preview` gửi `Bao_Gia.docx` → 200. `placeholders` có đúng 15 key của §1, `tables` có 1 bảng (index 0) với `placeholder_keys` = `ten_goi so_cua_hang don_gia giam_gia thanh_tien`, D1 không thêm dòng nào. Gọi lại với `lines_table=0` → body có `{{bang_hang}}` thay cho bảng, còn 12 trường (11 + `giam_gia` giữ lại, P-7), `bang_hang` gợi ý `lines`/`derived:lines_table`, `check_errors` rỗng sau khi để mặc định `manual` — FR-1, FR-5, DEC-2, DEC-4
- [AC-2] Fixture tự dựng: `{{ten_` (đậm) + `<w:proofErr/>` + `khach}}` (thường) trong một đoạn, `{{Tên khách}}`, `{{so_de_nghi}}` ×2, `{{ten` ở cuối đoạn này và `khach}}` ở đầu đoạn sau. Kết quả: `ten_khach` một trường (count 2, `original` gồm cả "Tên khách", có cảnh báo "đã đổi"); `so_de_nghi` count 2; `{{` vắt hai đoạn → `check_errors` có `placeholder_without_field` — FR-2, FR-3, §4 Input/Duplicates
- [AC-3] Phiên bản mới: GĐ gọi preview `Hop_Dong_Dich_Vu.docx` + `template_id` của mẫu seed → `removed` có 1 ghi chú nội bộ, body không còn "Ghi chú nội bộ"; `ten_khach`, `so_hop_dong`… có `suggestion_from: current_version` với đúng nguồn của v2; `base.version_no` = số hiện tại. Lưu `POST /templates/{id}/versions` → 201 phiên bản N+1, `note` "Nhập từ Hop_Dong_Dich_Vu.docx"; lưu lại với `expected_version_no` cũ → 409 `stale` — FR-4, FR-6, FR-10, DEC-5, DEC-6, DEC-8, §4 Two people
- [AC-4] Từ chối (mỗi trường hợp không ghi gì): file PDF → 422 `docx-invalid` `not_docx` · `.docm` (content type macroEnabled) → `macro_enabled` · zip có `document.xml` khai/giải nén > 2 MB → `too_large_inflated` · `document.xml` có `<!DOCTYPE` với entity lồng → `xml_invalid` · body 3 MB → 413 · `Content-Type: text/plain` → 415 · `lines_table=5` → 422 `validation` — FR-8, DEC-9, §4 Input
- [AC-5] XSS: docx có chữ `<script>alert(1)</script>` và hyperlink `javascript:alert(1)` → body chứa `&lt;script&gt;`, không có thẻ `<a>` hay URL. Docx có ảnh, header chứa `{{x}}`, ô gộp → mỗi loại một `warnings[]`, ảnh không có trong body. Lưu body đã sửa tay thêm `<img>` → 422 `template-check-failed` `html_not_allowed` — FR-7, §4 Security, DEC-7
- [AC-6] Lifecycle: có HĐ đã phát hành từ v2 + một nháp v2 → nhập phiên bản mới (AC-3) → `GET /contracts/{issued}/render` giống hệt từng byte trước khi nhập, nháp vẫn `template_version_id` v2 — §4 Lifecycle, OUT-2
- [AC-7] Quyền: NV và QL gọi preview → 403 + một dòng `permission.denied`; không cookie → 401; GĐ thiếu `X-Requested-With` → bị chặn như các POST khác — DEC-11, §4 Permissions, §5
- [AC-8] Done-check (e2e, 1 spec desktop ở PROOF): GĐ mở "Mẫu hợp đồng" → "Nhập từ Word" → `Bao_Gia.docx` → thấy 15 trường → "Đây là bảng dòng hàng" → đặt `tong_tien`=`derived:total`, `so_bao_gia`=`issue:number` → Lưu → mẫu mới hiện trong danh sách → NV "Tạo … từ mẫu này" chọn khách + 1 dòng G6 → tạo được nháp, bản in có bảng dòng hàng. **Trước khi row 4 xong**: loại = Hợp đồng. **Sau C-10-005**: loại = Báo giá, số in dạng BG-YYYY-NNN khi phát hành. NV mở màn nhập → 🔒 — FR-9, FR-11, OUT-4, DEC-12

## 8. Rủi ro (đưa vào PLAN)
- R-1 Va chạm với row 4 ở file sinh/chung: `packages/client` + `dist/openapi.json`, `dto/error.ts` (ProblemType), `routes/index.ts`, `lib/problem-messages.ts`, `features/templates/templates-screen.tsx` (nếu row 4 đổi màn mẫu). Ai merge sau thì rebase rồi chạy `pnpm openapi:export && pnpm client:generate`. Row 5 **không** có migration hay đổi catalog, nên không đụng journal.
- R-2 Row 4 đổi `templates.type`/`CreateTemplateBody.type` (giá trị, tên cột) → chỉ C-10-005 phải theo. C-10-003 đọc `type` dạng chuỗi, không ràng giá trị.
- R-3 `INTERNAL_NOTE_PHRASES`/`fold` phải export từ `template-check.ts` (C-10-002). Không đổi hành vi, test `template-check` hiện có vẫn phải xanh.
- R-4 Thêm 2 thư viện (`fflate`, `fast-xml-parser`) → lúc build đọc lại tài liệu chính thức để chốt phiên bản, ghim cố định (như các dependency hiện có), kiểm bundle trong `wrangler deploy --dry-run`.
- R-5 CPU ở gói Free (10 ms): đo thời gian preview với 3 file box ở PROOF. TODO: bạn xác nhận gói Workers khi deploy.

## 9. Tách card gợi ý (file scope rời nhau) — cột "row 4" = có cần row 4 xong trước không
| Card | Phạm vi file | Phụ thuộc | Cần row 4? | Xong khi |
|---|---|---|---|---|
| **C-10-001** hợp đồng OpenAPI | `dto/template-import.ts` (mới), `routes/template-import.routes.ts` (501), `routes/index.ts`, `dto/error.ts` (`DocxInvalid`), OpenAPI + client | — | **không** (client sinh: ai merge sau thì generate lại, R-1) | client sạch, `/docs` thấy route |
| **C-10-002** converter thuần | `domain/docx/{unzip,xml,to-html,placeholders}.ts` (mới), export `fold`/`INTERNAL_NOTE_PHRASES` ở `domain/template-check.ts`, `apps/api/package.json` (+2 dep), `test/domain/docx-*.test.ts` + `test/fixtures/docx/*` (3 file box + fixture tự dựng: tách run, docm, bomb, doctype, ảnh/header/ô gộp, XSS) | — (∥ 001) | **không** | phần domain của AC-2, AC-4, AC-5 xanh |
| **C-10-003** API preview | `services/template-import-service.ts` (mới, đọc gợi ý qua `template-dao`), route 001 (thay 501), `test/integration/template-import.test.ts` | 001, 002 | **không** | AC-1, AC-3, AC-4, AC-5, AC-6, AC-7 |
| **C-10-004** web nhập mẫu | `apps/web/src/features/templates/import/**` (mới), nút ở `templates-screen.tsx`, `lib/problem-messages.ts` | 003 | **không** (ô loại chỉ có "Hợp đồng") | luồng 3 bước chạy, test web |
| **C-10-005** nối loại tài liệu | ô chọn loại ở `features/templates/import/**` lấy danh sách từ nguồn row 4; nếu row 4 chưa nới `CreateTemplateBody.type` thì nới ở đây | 004 + **row 4 có khóa loại trên templates** | **có** | mẫu nhập chọn được BG/HD/DNTT/PXK |
| **C-10-006** e2e + PROOF | `apps/web/e2e/**`, PLAN PROOF log, `DESIGN.md` (dòng "Nhập từ Word" — bạn duyệt) | 004 (phần BG sau 005) | phần HD: không · phần BG: **có** | AC-8 |
Thứ tự: 001 ∥ 002 → 003 → 004 → (row 4 xong) 005 → 006. Không đụng `db/schema.ts`, migrations, catalog. API suite và e2e không chạy cùng lúc.

## 10. Trace check (trước STOP)
- [x] FR → OUT: FR-1 OUT-1/3 · FR-2 OUT-1 · FR-3 OUT-1/3 · FR-4 OUT-2 · FR-5 OUT-2/4 · FR-6 OUT-3 · FR-7 OUT-3 · FR-8 OUT-3 · FR-9 OUT-1/2/3 · FR-10 OUT-2 · FR-11 OUT-2/4
- [x] AC → FR/edge/DEC: AC-1 FR-1,5 DEC-2,4 · AC-2 FR-2,3 DEC-3 · AC-3 FR-4,6,10 DEC-5,6,8 · AC-4 FR-8 DEC-9 · AC-5 FR-7 DEC-7 · AC-6 Lifecycle · AC-7 DEC-11 · AC-8 FR-9,11 DEC-12 · DEC-1 → AC-1..5 (converter B) · DEC-10 → AC-3 (`note`) · DEC-13 → AC-4 (415)
- [x] edge "now" có AC: tách run/vắt đoạn/tiếng Việt/trùng AC-2 · bảng/ảnh/header/XSS AC-5 · ghi chú nội bộ AC-3 · quá to/không phải docx/macro/bomb AC-4 · > 64 KB → `check_errors` (unit test ở C-10-002) · không có trường, manual, tiền manual → test web C-10-004 · trùng tên mẫu, hai người AC-3 + 409 hiện có · retry → idempotency hiện có · quyền AC-7 · lifecycle AC-6
- [x] DEC-1..13 chốt · [x] SPEC duyệt 2026-10-01 (driver chốt theo pattern bạn ủy quyền)
