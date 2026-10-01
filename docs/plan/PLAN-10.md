# PLAN-10: Nhập mẫu từ Word (.docx) — xem trước không lưu trạng thái, lưu qua /templates hiện có

Status: Approved 2026-10-01 (driver chốt theo pattern bạn ủy quyền)
Spec: docs/spec/SPEC-10.md (Approved 2026-10-01) · Intent: docs/intent/INTENT-10.md · Roadmap: ROADMAP-02 row 5
**Chạy song song row 4 (PLAN-09).** Code mới của row 5 nằm trong file mới (`domain/docx/*`, `domain/template-import/*`,
`dao/template-suggest-dao.ts`, `services/template-import-service.ts`, `routes/templates-import.routes.ts`, `dto/template-import.ts`,
web `features/templates/import/*`). File dùng chung với row 4 ở §4 R-1 — driver xếp thứ tự. Row 5 không có migration, không đổi catalog.

## 0. Đối chiếu SPEC với code hôm nay (đã đọc)
| SPEC chỗ | Code thật | Kết luận PLAN |
|---|---|---|
| §3.4 413 · 415 "Problem+JSON" | `hono/body-limit` mặc định trả text 413; chưa có slug 413/415; `ProblemDto` chưa có `reason` | P-2: `bodyLimit({maxSize, onError})` trả Problem slug `payload-too-large`; 415 slug `unsupported-media-type`; `ProblemDto.reason?: string` (C-10-001) |
| §3.4 `placeholders[].original: string` | AC-2 "`original` gồm cả 'Tên khách'" (nhiều tên gốc) | P-1: domain trả `originals[]`; API `original` = các tên gốc khác nhau nối ", " theo thứ tự xuất hiện |
| FR-10 `note` = "Nhập từ <tên file>" | preview nhận body nhị phân, không có tên file; lưu là `POST /templates*` hiện có | P-3: web đặt `note` lúc Lưu (test web C-10-004); API test gửi `note` và kiểm nó được lưu |
| §3.2 `tables[]` "các bảng có chứa trường" | `Hop_Dong` có bảng chữ ký 2×2 không có trường | P-5: `index` = vị trí trong MỌI `w:tbl` cấp 1 của `w:body`; `tables[]` chỉ liệt kê bảng có trường |
| FR-3 "số lần" | `{{#if k}}` cũng cần trường `k` | P-6: `count` đếm mọi tham chiếu, kể cả `{{#if k}}` |
| FR-5 `bang_hang` kiểu `lines` | seed v2 đã có `bang_hang` (`lines`/`derived:lines_table`) | P-8: service luôn ép `bang_hang` = `{type:"lines", source:"derived:lines_table", required:true}`; nhãn lấy theo DEC-5 nếu có, không thì "Bảng hàng hóa, dịch vụ" |
| FR-10 field_rules "rule bị bỏ thì có cảnh báo" | cảnh báo phải tới được UI | P-9: preview trả `base.field_rules` đã lọc + `warnings[{code:"field_rule_dropped"}]` |
| `Bao_Gia` dòng hàng | dòng 2 của bảng có cả `{{giam_gia}}%` | **P-7 — driver chốt: GIỮ `giam_gia`** (trường thường + `<p>Giảm giá: {{giam_gia}}%</p>` sau `{{bang_hang}}`; SPEC FR-5/AC-1 đã sửa; card C-10-002/003 + test AC-1 theo) · ghi chú cũ: `lines_table=0` bỏ luôn `giam_gia` (chỉ nằm trong bảng, đúng FR-5) → mẫu BG nhập kiểu này không có ô giảm giá, luật "giảm > 10% thêm GĐ" không bao giờ kích. Giữ đúng SPEC; nếu bạn muốn giữ ô giảm giá → đổi FR-5 (giữ trường tiền/phần trăm của bảng lại làm trường thường) |
| `wrangler.toml` `run_worker_first` | đã có `/templates/*` × 3 block | không đổi wrangler |
| SPEC §9 tên file | `routes/template-import.routes.ts`, `test/integration/template-import.test.ts`, `test/domain/docx-*.test.ts` | P-11: dùng `routes/templates-import.routes.ts` (theo `templates-write.routes.ts`), `templates-import-acceptance.test.ts`, một file `docx-convert.test.ts` |
| CPU 10 ms (§4 Failure, R-5) | gói Workers chưa biết | P-12: mục tiêu gói Free 10 ms. `performance.now()` trong Workers đứng yên khi chạy CPU → đo bằng `scripts/bench-docx-import.ts` (Node, cùng hàm thuần) ở C-10-002: trung vị 3 file box ≤ 5 ms; PROOF ghi lại; bạn xác nhận gói khi deploy |

## 1. Acceptance tests — written first, seen failing
Files (viết ở PLAN; `pnpm --filter @runway/api typecheck` → 0 lỗi; eslint 3 file API → 0 lỗi; e2e compile sạch với tsconfig tạm, chỉ còn 2 lỗi cũ của `global-setup.ts`):
- `apps/api/test/integration/templates-import-acceptance.test.ts` — 7 test = AC-1..AC-7, gọi API đúng SPEC §3.4 (body nhị phân, `Content-Type` docx, query `template_id`/`lines_table`). Một kịch bản mỗi AC, nhiều assert.
- `apps/api/test/domain/docx-convert.test.ts` — 26 test hàm thuần (dynamic import `src/domain/docx/index`): chỉ phần API không thấy — ánh xạ cấu trúc, bảng slug, zip khai sai kích thước, 1001 mục, XML hỏng, thiếu `document.xml`, zip thường, OLE/rỗng/cụt, De_Nghi + Hop_Dong, 64 KB qua `checkTemplate`.
- `apps/api/test/fixtures/docx/` — 3 file box nguyên bản + `build-fixtures.mjs` (không dependency, zip writer tự viết, tất định) sinh 14 fixture + `fixtures.generated.ts` (base64, vì pool Workers không có `node:fs`). Chạy lại: `node apps/api/test/fixtures/docx/build-fixtures.mjs` → git sạch.
- `apps/web/e2e/templates-import.spec.ts` — 1 spec desktop (AC-8), hợp đồng UI ở đầu file. Không chạy ở PLAN.

Red run (2026-10-01, sau khi `pgrep -f "vitest run"` trống): `CI=true pnpm --filter @runway/api exec vitest run test/integration/templates-import-acceptance.test.ts test/domain/docx-convert.test.ts`
```
× AC-1 … → Bao_Gia.docx {}: expected 404 to be 200
× AC-2 … → split-run.docx {}: expected 404 to be 200
× AC-3 … → Hop_Dong_Dich_Vu.docx {"template_id":"01K6C0NTRACT000000000TP001"}: expected 404 to be 200
× AC-4 … → not-a-docx.pdf: expected 404 to be 422
× AC-5 … → xss-and-drops.docx {}: expected 404 to be 200
× AC-6 … → Hop_Dong_Dich_Vu.docx {"template_id":"01K6C0NTRACT000000000TP001"}: expected 404 to be 200
× AC-7 … → khanh@nhatminh.vn: expected 404 to be 403
Unhandled Error: Failed to load url ../../src/domain/docx/index (resolved id: ../../src/domain/docx/index) in …/test/domain/docx-convert.test.ts. Does the file exist?
Test Files  1 failed (2) · Tests  7 failed (33) · Duration 4.97s · exit 1
```
Đúng kỳ vọng: route chưa có (404), module converter chưa có.
Sau lần đỏ này (không chạy lại — ngân sách 1 lần): test được làm bền với row 4 (R-10) — reset chỉ xóa dòng `created_by IS NOT NULL`, AC-3/AC-6 đọc số phiên bản hiện tại thay vì hằng 2, `base` so với bản hiện tại; `split-run.docx` thêm `{{Mã nội bộ}}` (key không mẫu nào có → kiểm mặc định `manual` + nhãn = tên gốc). Lý do đỏ không đổi (route 404). typecheck/eslint chạy lại → 0.

| AC | Chứng minh bằng | Card xanh | Đỏ bây giờ? |
|---|---|---|---|
| AC-1 | API `AC-1` (15 key, count 1; `tables` = `[{0, 2, 6, [ten_goi so_cua_hang don_gia giam_gia thanh_tien]}]`; `table_index`; gợi ý `other_template` từ seed v2 + `none` mặc định; `<h1>BÁO GIÁ</h1>`; `base` mẫu mới = quy trình box + `[]`; `sources`; `stats`; `lines_table=0` → `{{bang_hang}}`, không còn `<table`, 11 trường, `check_errors` rỗng; dấu vết D1 không đổi) | 001 + 002 + 003 | [x] 404 |
| AC-2 | API `AC-2` (`split-run.docx`: `ten_khach` count 2 + `original` có "Tên khách" + `key_renamed`; `so_de_nghi` 2; `{{ten_khach}}` trơn ×2; vắt đoạn → `placeholder_without_field`) | 002 + 003 | [x] 404 |
| AC-3 | API `AC-3` (`removed` 1 ghi chú; 7 trường `current_version` = đúng field v2; `tong_tien` `none`; `base` v2 + rule `all_or_none` còn; lưu `/versions` → v3, `note`, body = preview; lưu lại → 409 `stale`; preview lại → `base.version_no` 3) | 003 | [x] 404 |
| AC-4 | API `AC-4` (pdf `not_docx` · docm `macro_enabled` · bomb `too_large_inflated` · DOCTYPE `xml_invalid` — 422 `docx-invalid` + `reason`; 3 MB 413; `text/plain` 415; `lines_table=5` 422 `validation`; `template_id` lạ 404; không ghi gì) + domain `rejections` (khai sai kích thước, 1001 mục, XML hỏng, thiếu document, zip thường, OLE/rỗng/cụt) | 001 + 002 + 003 | [x] 404 / load fail |
| AC-5 | API `AC-5` (`&lt;script&gt;`, không `<a`, không `javascript:`, chữ link giữ; không `<img`, không `{{x}}`; `image_dropped`/`header_footer_placeholder`/`merged_cells_flattened` mỗi mã 1 dòng; lưu thêm `<img>` → 422 `template-check-failed` `html_not_allowed`) + domain `structure mapping` | 002 + 003 | [x] 404 |
| AC-6 | API `AC-6` (HĐ phát hành từ v2 + nháp v2 → nhập v3 → `/render` cùng chuỗi; nháp `template_version_id` = v2) | 003 | [x] 404 |
| AC-7 | API `AC-7` (NV, QL 403 + đúng 1 `permission.denied` target `/templates/import/preview`; ẩn danh 401; GĐ thiếu `X-Requested-With` 403 `forbidden`) | 001 + 003 | [x] 404 |
| AC-8 | e2e `templates-import.spec.ts` (GĐ nhập Bao_Gia → 15 trường → bảng dòng hàng → 11 → nguồn → Lưu → v1 trong danh sách; NV 🔒; NV tạo nháp từ mẫu, bản in có `table.lines`) + human 390px | 006 (phần BG sau 005) | e2e chưa chạy (ngân sách 1 lần ở PROOF) |

Test đơn vị web (red-first trong card C-10-004): `features/templates/import/import-logic.test.ts` (payload Lưu = body + `suggested` đã sửa + `base` + `note` "Nhập từ <file>"; tên mẫu từ tên file; badge "Tiền nhập tay"; map 409/422 về hàng); `lib/problem-messages.test.ts` (6 `reason` + 413/415).

### 1b. Test đang có phải đổi
Không có. Row 5 không đổi hành vi hiện có (`checkTemplate` chỉ export thêm `fold`/`INTERNAL_NOTE_PHRASES`; `template-check.test.ts` phải giữ xanh — R-3). `templates-acceptance.test.ts` không đụng.

## 2. Files that change
| File | New / Modify | Why (FR) | Card |
|---|---|---|---|
| `api/src/dto/template-import.ts` · `api/src/routes/templates-import.routes.ts` (501) · `api/src/routes/index.ts` · `api/src/dto/error.ts` · `packages/client/src/generated/*` | N/M | hợp đồng §2b trước handler (FR-1, FR-8) | 001 |
| `api/src/domain/docx/{index,unzip,xml,walk,placeholders}.ts` · `api/src/domain/template-check.ts` (export) · `api/package.json` · `pnpm-lock.yaml` · `scripts/bench-docx-import.ts` | N/M | converter thuần (FR-2, FR-3, FR-5, FR-6, FR-7, FR-8, DEC-1, DEC-7, DEC-9) | 002 |
| `api/src/domain/template-import/{suggest,defaults}.ts` · `api/src/dao/template-suggest-dao.ts` · `api/src/services/template-import-service.ts` · `api/src/routes/templates-import.routes.ts` | N/M | preview: gợi ý, base, check_errors, lỗi (FR-1, FR-4, FR-5, FR-10, DEC-5, DEC-6, DEC-11) | 003 |
| `web/src/features/templates/import/**` · `web/src/features/templates/templates-screen.tsx` · `web/src/lib/problem-messages.ts` (+test) | N/M | màn 3 bước (FR-9, FR-10 note) | 004 |
| `web/src/features/templates/import/type-select.tsx` · (nếu row 4 chưa nới) `api/src/dto/templates.ts` + client · `web/e2e/templates-import.spec.ts` (khối ROW-4 SEAM) | M | loại tài liệu từ row 4 (FR-11, DEC-12) | 005 |
| `web/e2e/templates-import.spec.ts` (chỉ sửa nếu spec sai) · `docs/plan/PLAN-10.md` · `docs/roadmap/ROADMAP-02.md` · `docs/cookbook/design/DESIGN.md` (dòng "Nhập từ Word" — bạn duyệt) | M | PROOF (AC-8) | 006 |

### 2b. Hợp đồng (C-10-001 khóa API; C-10-002 khóa hàm thuần; card sau đổi → dừng, báo driver)
- `POST /templates/import/preview?template_id=<ULID>&lines_table=<int ≥0>` — tag `templates`, `security: cookieAuth`. Request body `content: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { schema: { type: string, format: binary } } }` (DEC-13). Middleware (route-scoped `app.on("post", "/templates/import/preview", …)`): `bodyLimit({ maxSize: 2 MB, onError → 413 payload-too-large })` → `requireAuth()` → `requirePerm("template:write")`. Không `withIdempotency`. Handler: `content-type` (bỏ tham số) ≠ docx → 415 `unsupported-media-type`; `c.req.arrayBuffer()` → service.
- 200 `TemplateImportPreview` đúng SPEC §3.4; `suggested` = `TemplateFieldSchema`; `check_errors` = `CheckFailedItem` (`{code, key?, source?, message}` như 422 `template-check-failed`); `stats.body_bytes` = byte UTF-8 của `body`.
- Lỗi: 401 · 403 (+ `permission.denied`) · 404 `not-found` (`template_id` lạ) · 413 `payload-too-large` · 415 `unsupported-media-type` · 422 `validation` (`lines_table` ≥ số bảng, hoặc query sai dạng; `errors[{path:"lines_table"}]`) · 422 `docx-invalid` + `reason`.
- `dto/error.ts`: `ProblemType` + `DocxInvalid: "docx-invalid"`, `PayloadTooLarge: "payload-too-large"`, `UnsupportedMediaType: "unsupported-media-type"`; `ProblemDto` + `reason: z.string().optional()`.
- Hàm thuần (`domain/docx/index.ts`, chữ ký cố định — đầu `test/domain/docx-convert.test.ts`): `convertDocx(bytes, { linesTable? }) → DocxConversion | { error: DocxErrorReason }` (không bao giờ ném) · `slugKey(original) → string | null` · `DOCX_LIMITS = { inflatedBytes: 2_097_152, entries: 1000 }`.
- Mã cảnh báo cố định (`warnings[].code`, tiếng Việt ở `message`): `key_renamed` · `key_merged` (hai tên gốc ra cùng slug) · `image_dropped` · `header_footer_dropped` · `header_footer_placeholder` · `textbox_dropped` · `footnote_dropped` · `comment_dropped` · `merged_cells_flattened` · `nested_table_flattened` · `numbering_flattened` · `page_break_dropped` · `tracked_changes_accepted` · `field_code_dropped` · `altchunk_dropped` · `field_rule_dropped` (service, P-9). Màu/font/cỡ chữ: bỏ im lặng (DEC-7, không cảnh báo — mọi file đều có).
- Gợi ý (`domain/template-import/suggest.ts`, thuần): `suggestFields(placeholders, target: VersionFields | null, others: VersionFields[] /* mới nhất trước */)` → mỗi key `{suggested, suggestion_from}`; `none` → `{key, label: original đầu tiên, type:"text", required:true, source:"manual"}`; P-8 cho `bang_hang`. `defaults.ts`: `BOX_APPROVAL_POLICY` (= shape quy trình seed) cho mẫu mới.
- DAO đọc (`dao/template-suggest-dao.ts`, file mới — không đụng `template-dao.ts` để khỏi va row 4): `currentVersionsForSuggest(db) → [{template_id, created_at, version_no, fields, field_rules, approval_policy, default_line_items, default_clauses}]` mọi mẫu `active`, mới nhất trước (một query JOIN `current_version_id`).

## 3. Cards — một việc nhỏ mỗi card (docs/plan/cards/C-10-NNN.md)
Thứ tự: 001 ∥ 002 → 003 → 004 → [row 4 có khóa loại trên `templates`] → 005 → 006. **001–004 không cần row 4** (bắt đầu ngay); 005 cần row 4; 006 phần HĐ chạy được trước 005, phần BG sau 005. API suite và e2e không chạy cùng lúc; driver chạy vitest tập trung.
1. **[C-10-001]** hợp đồng OpenAPI preview (501) + 3 slug + `reason` + client → nền AC-1, AC-4, AC-7, FR-1, FR-8 · không phụ thuộc · row 4: không (R-1 file chung)
2. **[C-10-002]** converter thuần + 2 thư viện + bench → AC-2, AC-4, AC-5 (phần domain), FR-2, FR-3, FR-5, FR-6, FR-7, FR-8, DEC-1, DEC-7, DEC-9 · không phụ thuộc (∥ 001) · row 4: không
3. **[C-10-003]** API preview: gợi ý, base, check_errors, lỗi → AC-1..AC-7, FR-1, FR-4, FR-5, FR-10, DEC-2, DEC-5, DEC-6, DEC-11 · sau 001, 002 · row 4: không
4. **[C-10-004]** web "Nhập từ Word" 3 bước → AC-8 (phần màn), FR-9, FR-10 · sau 003 · row 4: không (ô Loại chỉ "Hợp đồng")
5. **[C-10-005]** nối loại tài liệu của row 4 → AC-8 (phần BG), FR-11, DEC-12 · sau 004 + row 4 (C-09 khóa loại trên `templates`) · row 4: **có**
6. **[C-10-006]** e2e một lần + PROOF → AC-1..AC-8 · sau 004 (phần BG sau 005)

Điều phối: chỉ 001 sinh `packages/client` (005 sinh lại nếu nới `CreateTemplateBody.type`). `routes/templates-import.routes.ts` do 001 tạo, 003 thay handler. `features/templates/import/type-select.tsx` do 004 tạo (một component, chỉ "Hợp đồng"), 005 chỉ sửa file đó + khối SEAM của e2e.

## 4. Risks
- **R-1 File dùng chung với row 4 (driver xếp thứ tự; ai merge sau thì rebase rồi `pnpm openapi:export && pnpm client:generate`):**
  - `packages/client/src/generated/*` + `packages/contracts/dist/openapi.json` (001; 005 nếu nới type).
  - `apps/api/src/dto/error.ts` (001: 3 slug + `reason`) — row 4 có thể thêm slug số tài liệu.
  - `apps/api/src/routes/index.ts` (001: 1 dòng `templatesImportRoutes(app)` sau `templatesWriteRoutes`).
  - `apps/web/src/lib/problem-messages.ts` (+ test) (004).
  - `apps/web/src/features/templates/templates-screen.tsx` (004: nút "Nhập từ Word" + "Nhập phiên bản mới từ Word" + LockedNote) — row 4 có thể đổi nhãn/loại trên thẻ mẫu.
  - `apps/api/package.json` + `pnpm-lock.yaml` (002: `fflate` 0.8.3, `fast-xml-parser` 5.11.2 — npm 2026-10-01; ghim chính xác như các dep hiện có; cài bằng `pnpm --filter @runway/api add fflate@0.8.3 fast-xml-parser@5.11.2 --store-dir .pnpm-store/v10`).
  - `apps/api/src/domain/template-check.ts` (002: chỉ thêm `export` cho `fold`, `INTERNAL_NOTE_PHRASES`) — row 4 có thể sửa luật nguồn.
  - `apps/api/src/dto/templates.ts` (chỉ 005, nếu row 4 chưa nới `CreateTemplateBody.type`).
  - `wrangler.toml`: **không đổi** (`/templates/*` đã có trong `run_worker_first` × 3).
- R-2 Row 4 đổi `templates.type`/`CreateTemplateBody.type` → chỉ 005 theo; 003 đọc `type` dạng chuỗi, không ràng giá trị.
- R-3 Export `fold`/`INTERNAL_NOTE_PHRASES` không đổi hành vi: `template-check.test.ts` xanh nguyên trạng.
- R-4 `fast-xml-parser` 5.x kéo 6 dep phụ (`strnum`, `is-unsafe`, `xml-naming`, `fast-xml-builder`, `@nodable/entities`, `path-expression-matcher`) → C-10-002 kiểm `wrangler deploy --dry-run --outdir` (kích thước bundle trước/sau) và bench. Mặc định của thư viện có bẫy: `trimValues` (mặc định true) xóa khoảng trắng trong `w:t` → đặt `trimValues: false`, `parseTagValue: false`, `parseAttributeValue: false`, `preserveOrder: true`, `ignoreAttributes: false`, `processEntities: false`. Nếu bundle/CPU vượt (bench > 5 ms) → dừng, đề xuất tokenizer tự viết (đổi DEC-1).
- R-5 Zip bomb: `fflate.unzipSync` cấp bộ đệm theo `originalSize` khai trong header; tài liệu ghi "File sizes are sometimes not set" và không nói về bomb. → `filter` từ chối mục có `originalSize` > trần hoặc 0/không khai; mục được nhận thì giải nén bằng `Inflate` dạng luồng, đếm byte thật, cắt ở 2 MB (fixture `bomb-lying.docx` khai 4 KB, thật 3 MB). Đếm số mục trước khi giải nén (đọc End of Central Directory).
- R-6 CPU gói Free (P-12): `filter` bỏ `styles.xml` 349 KB + `stylesWithEffects.xml` 438 KB (≈ 95% gói); chỉ inflate `document.xml` (3–6 KB), rels, content types. Bench ở 002, ghi số ở PROOF. TODO bạn: gói Workers khi deploy.
- R-7 Gửi nhị phân từ web: client sinh có thể không hỗ trợ body `format: binary` → 004 gọi qua `lib/client.ts` (fetch + CSRF headers sẵn có), kiểu trả về lấy từ `packages/client` types.
- R-8 Nội dung file không vào log: logger request chỉ ghi method/path/status; service không log body/XML; Problem `detail` không chép chữ trong file.
- R-9 e2e để lại mẫu "Báo giá E2E" — các spec khác tìm mẫu theo tên nên không ảnh hưởng; `global-setup` không đổi. Thứ tự: sau `contracts.spec`, trước `shell.smoke`.
- R-10 Chung sống với row 4 trong test: row 4 seed thêm BG/DNTT/PXK + HĐ v3 (C-09-005, `created_by` NULL). `templates-import-acceptance` reset theo `created_by IS NOT NULL` và đọc phiên bản hiện tại động → không phá seed row 4, không phụ thuộc số phiên bản. Còn phụ thuộc: helper `draftOnSeed` (AC-6) gửi body `POST /contracts` kiểu SPEC-08; nếu row 4 đổi body tạo HĐ (vd. `type`/`parent_id` bắt buộc) → card merge sau sửa helper này (không đổi assert). AC-1 gợi ý `other_template` cho `ten_khach` vẫn đúng khi có thêm mẫu row 4 (cùng nguồn `subject:contact_person`); nếu row 4 đặt nguồn khác → assert theo mẫu mới nhất (DEC-5).
- ENGINEERING.md: không xung đột (route giữ `c`; service nhận `{db}` + bytes + query, không thấy `c`; DAO thuần trả DTO; ghi đi qua đường CAS + `db.batch` + audit hiện có; Problem+JSON mọi lỗi (P-2); POST cần Origin + `X-Requested-With`; không binding mới; không migration).

## 5. Trace check (trước STOP)
- [x] mọi FR có AC: FR-1→AC-1, AC-4 · FR-2→AC-2 · FR-3→AC-2 + domain slug · FR-4→AC-1, AC-3 · FR-5→AC-1 · FR-6→AC-3 · FR-7→AC-5 + domain structure · FR-8→AC-4 + domain rejections · FR-9→AC-8 · FR-10→AC-1 (base mẫu mới), AC-3 (base phiên bản, note) · FR-11→AC-8 (SEAM)
- [x] mọi AC có dòng §1 · mọi AC có card (`serves`) · DEC-1→AC-1..5 · DEC-2→AC-1 (không ghi), AC-3 · DEC-3→AC-2 · DEC-4→AC-1 · DEC-5→AC-1, AC-3 · DEC-6→AC-3 · DEC-7→AC-5 · DEC-8→AC-3 · DEC-9→AC-4 · DEC-10→AC-3 (`note`) · DEC-11→AC-7 · DEC-12→AC-8 · DEC-13→AC-4 (415)
- [x] edge "now" có AC: tách run/vắt đoạn/tiếng Việt/trùng/2 tên cùng slug AC-2 + domain · tên sai cú pháp, `#if` domain structure · không có trường domain `no-fields` + web · manual/tiền manual web C-10-004 · bảng/ảnh/header/ô gộp/XSS AC-5 · tracked changes domain · ghi chú nội bộ AC-3 · quá to/không phải docx/macro/bomb AC-4 · > 64 KB domain `big-body` · trùng tên mẫu 409 hiện có (`templates-acceptance`) · hai người AC-3 · retry: preview không ghi (AC-1, AC-4) + Idempotency hiện có · quyền AC-7 · lifecycle AC-6
- [x] red run API (output §1) · [x] P-7 driver chốt (giữ giam_gia)

## 6. PROOF log (step 5) — điền ở C-10-006
- Checks: `pnpm lint && pnpm typecheck && pnpm build` · `pnpm openapi:export && pnpm client:generate && git diff --exit-code packages/client` · `CI=true pnpm test` · `pnpm tsx scripts/bench-docx-import.ts` (trung vị ms × 3 file box) · `wrangler deploy --dry-run --outdir /tmp/w` (kích thước bundle trước/sau) · TUẦN TỰ sau đó `bash docs/cookbook/e2e-kit/free-ports.sh 8791` rồi `PROOF_SHOTS=1 CI=true pnpm --filter @runway/web e2e` (một lần).
- Swagger `/docs`: `POST /templates/import/preview` hiện body binary, 200 schema `TemplateImportPreview`, đủ mã lỗi.
- Human checklist (làm → phải thấy):
  - AC-1/AC-8: GĐ → "Mẫu hợp đồng" → "Nhập từ Word" → `Bao_Gia.docx` → "Đã có 15 trường", bản xem trước "BÁO GIÁ" → "Đây là bảng dòng hàng" → 11 trường, `bang_hang` kiểu bảng dòng → Lưu → "Đã lưu phiên bản 1", mẫu mới trong danh sách.
  - AC-2: file Word bạn tự sửa (gõ lại `{{ten_khach}}` có bôi đậm nửa chừng) → vẫn 1 trường; gõ `{{Tên khách}}` → key `ten_khach`, cảnh báo "đã đổi".
  - AC-3: chi tiết mẫu seed → "Nhập phiên bản mới từ Word" → `Hop_Dong_Dich_Vu.docx` → ô "Đã bỏ" có ghi chú nội bộ; trường cũ "gợi ý từ: phiên bản hiện tại" → Lưu → v3, ghi chú "Nhập từ Hop_Dong_Dich_Vu.docx". Mở 2 tab, lưu cả hai → tab sau "Mẫu vừa có phiên bản mới, đọc lại".
  - AC-4: chọn file PDF / `.docm` / file 3 MB → câu tiếng Việt, không mẫu nào được tạo.
  - AC-5: file có ảnh/logo, đầu trang có `{{x}}`, ô gộp → mỗi loại 1 dòng "Cảnh báo"; bản xem trước không có ảnh.
  - AC-6: HĐ đã phát hành trước khi nhập v3 → bản in không đổi; nháp cũ vẫn "v2".
  - AC-7: NV/QL mở "Mẫu hợp đồng" → không có nút, 🔒 "Chỉ Giám đốc nhập mẫu (cần quyền template:write)".
  - P-7: mẫu BG nhập kiểu bảng dòng hàng vẫn có ô "Giảm giá" (dưới bảng).
  - 390px: hộp thoại nhập thành trang toàn màn, bảng trường thành thẻ, không cuộn ngang.
- Attack: ẩn danh → 401 · NV/QL → 403 + `permission.denied` · thiếu `X-Requested-With`/Origin → 403 · `template_id` đoán bừa → 404 · `<script>`/`javascript:` trong file → chữ thường, không link · DOCTYPE/bomb/1001 mục → 422 không treo · file 3 MB → 413 trước khi parse · sửa body trước khi Lưu (thêm `<img>`) → 422 `html_not_allowed`.
- CPU: [số bench] · gói Workers: [bạn xác nhận].
- Result: [pass | what failed → back to the plan]
