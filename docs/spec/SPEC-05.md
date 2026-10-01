# SPEC-05: Xuất PDF tài liệu đã phát hành

Status: Approved 2026-10-01 (driver chốt — bạn ủy quyền "chạy tiếp theo quy trình" 2026-10-01)
Intent: docs/intent/INTENT-05.md
Phụ thuộc: SPEC-03 (phát hành, `rendered_html` lưu một lần, `contract.issued`) · SPEC-04b (ngăn chi tiết, bản in, `problem-messages`).

## 0. Sửa đổi 2026-10-01 (bạn chốt: "PDF chỉ tạo khi nhấn nút") — thắng mọi dòng cũ bên dưới
- Bỏ hàng đợi `contract-pdf`, cron bù, gửi việc lúc phát hành, cột `pdf_attempts`/`pdf_failed_at`, trạng thái `failed`, Problem `pdf-not-ready`. Phát hành không đổi gì so với SPEC-03.
- FR-2'/FR-3': `GET /contracts/{id}/pdf` — chưa có file → render ngay (renderer theo `PDF_RENDERER`: `browser` | `fake` (vitest) | `off`) → R2 + CAS + audit (như FR-1/FR-7) → trả file; đã có → trả file lưu. Hai lần bấm cùng lúc: CAS giữ một file, cả hai nhận cùng bytes.
- Renderer lỗi / `off` → **503** Problem `service-unavailable` ("dùng In"); hợp đồng không bị chạm. Bấm lại sẽ thử lại.
- FR-6': `pdf_status` = `none` | `pending` (chưa tạo — tạo khi bấm) | `ready`.
- FR-8': hợp đồng `issued`/`voided` luôn có link "Tải PDF" (ngăn chi tiết + bản in); không có trạng thái 🔒.
- AC-2' renderer lỗi → lỗi, hợp đồng vẫn `issued`, không object R2; lần bấm sau 200 · AC-3' hai lần bấm đồng thời → 1 key, 1 audit, 1 object · AC-4 (cron) bỏ · AC-7' issued/voided có link, nháp không.
- Hạ tầng: chỉ `[browser]` + R2 `FILES`; không queue.

## 1. Research (nguồn + ngày, đọc 2026-10-01)
- Browser Rendering ("Browser Run"): binding `[browser] binding = "BROWSER"`; `@cloudflare/puppeteer` 1.4.0 `puppeteer.launch(env.BROWSER)` → `page.setContent` → `page.pdf`. `wrangler dev` chạy Chrome headless cục bộ (changelog 2025-07-22); `quickAction()` cần `--remote` → **không dùng**. Giới hạn Free: 3 trình duyệt đồng thời, **10 phút/ngày**, 1 trình duyệt mới/20s; Paid: 10 giờ/tháng kèm gói. Hết hạn mức → 429 (`Retry-After`; hết 10 phút/ngày thì chỉ hết vào hôm sau). Font: chỉ "bộ font cài sẵn chuẩn", không cam kết tiếng Việt → nhúng `@font-face` data URI. — developers.cloudflare.com/browser-rendering/{workers-bindings,puppeteer,limits,pricing,features/custom-fonts}/, changelog/2025-07-22-br-local-dev/
- R2: `[[r2_buckets]] binding/bucket_name`; `put(key, bytes, {httpMetadata})`, `get(key)` → `body` stream + `writeHttpMetadata`; miniflare/vitest-pool-workers giả lập R2 cục bộ. — developers.cloudflare.com/r2/api/workers/workers-api-usage/
- Queues: `msg.attempts`, `msg.retry({delaySeconds})`, `max_retries` (mặc định 3), DLQ tùy chọn. — developers.cloudflare.com/queues/configuration/batching-retries/
- **Spike 2026-10-01** (`/tmp/pdfspike`, wrangler 4.135.0 như repo): `wrangler dev` + binding → PDF A4 1 trang; lần đầu 91s (tải Chrome), sau đó ~1,2s; nhúng Arimo (`@fontsource/arimo` 5.3.0, subset latin+latin-ext+vietnamese 400/700 = 144 KB) đặt tên `Arial` → `pdffonts`: Arimo-Regular/Bold nhúng, dấu tiếng Việt đúng (đã xem ảnh trang). Hai lần render cùng HTML cho **byte khác nhau** (dấu thời gian PDF) → phải tạo một lần và lưu.
- **Spike Forme 2026-10-01** (`@formepdf/html` 0.26.0, WASM, bạn hỏi): bản in HD-2026-014 → PDF đúng dấu với Liberation Sans đặt tên `Arial`; ~100–260ms CPU/PDF (vượt 10ms CPU gói Free), wasm 7,75 MB (3,45 MB nén, vượt 3 MB gói Free), CSS một phần (`transform`/`opacity`/`position: fixed` → cảnh báo), 0.x, một người duy trì. → giữ Browser Rendering (bạn chốt); Forme là adapter dự phòng sau `PdfRenderer` nếu lên gói Paid.
- Nội bộ: `render-service.ts` (bản in đã phát hành = `rendered_html` lưu một lần bằng CAS; đã hủy = cùng bytes + dải "ĐÃ HỦY" thêm lúc đọc) · `issue-service.ts` (render sau phát hành, lỗi render không hoàn tác) · `events/contract-events.ts` · `index.ts` (`queue()` chỉ một consumer; `scheduled()` bảng cron) · bản in dùng `font-family: Arial, sans-serif`, CSP `default-src 'none'` (không tải gì từ ngoài).
- Miền: workbook §"Output format" + adapter: "renderer outage leaves the document issued and its HTML downloadable — never un-issues it".

## 2. Requirements
- [FR-1] Mỗi hợp đồng đã phát hành có **đúng một** file PDF lưu ở R2, tạo từ `rendered_html` đã đóng băng (không dải "ĐÃ HỦY", không dấu "NHÁP"); đã lưu thì không bao giờ tạo lại/ghi đè → OUT-2 OUT-3
- [FR-2] Tạo PDF **sau** phát hành, ngoài request phát hành: phát hành gửi việc vào hàng đợi `contract-pdf`; gửi lỗi chỉ ghi log — phát hành vẫn 200, số vẫn giữ → OUT-3
- [FR-3] Tự phục hồi: hàng đợi thử lại 3 lần (30s, 60s, 90s); hết lượt → ghi `pdf_failed_at`. Cron 5 phút gom ≤ 20 hợp đồng đã phát hành/đã hủy chưa có PDF mà (chưa thử và phát hành > 5 phút trước) hoặc (lỗi lần cuối > 1 giờ trước) → gửi lại hàng đợi. Phủ cả hợp đồng phát hành trước khi có tính năng này → OUT-3
- [FR-4] PDF A4 đúng `@page` của bản in, `printBackground`, không header/footer trình duyệt; font Arimo (metric như Arial, giấy phép SIL OFL-1.1, file LICENSE đi kèm) nhúng dưới tên `Arial` chỉ lúc in PDF — `rendered_html` và `rendered_hash` không đổi → OUT-2
- [FR-5] `GET /contracts/{id}/pdf` (cần `contract:read`): đã có PDF → 200 `application/pdf`, `Content-Disposition: attachment; filename="HD-2026-001.pdf"`, `ETag` = sha256 của file, `Cache-Control: private, no-cache`; hợp đồng đã hủy vẫn trả file gốc (Q-2) → OUT-1 OUT-4
- [FR-6] `Contract` (chi tiết) thêm `pdf_status`: `none` (chưa phát hành) · `pending` (đang chờ tạo) · `ready` · `failed` (lần thử cuối lỗi, hệ thống sẽ thử lại) → OUT-1 OUT-3
- [FR-7] Tạo xong ghi nhật ký `contract.pdf_generated` (actor = hệ thống, target = id hợp đồng, metadata `{ size }` — không PII); câu nhật ký tiếng Việt "Hệ thống đã tạo PDF cho hợp đồng …" → OUT-4
- [FR-8] Giao diện: nút **"Tải PDF"** ở ngăn chi tiết và ở lớp bản in, chỉ với hợp đồng đã phát hành/đã hủy. `ready` → tải file (link `GET …/pdf`, thuộc tính `download`). `pending` → nút 🔒 "Đang tạo PDF — thử lại sau ít phút; cần ngay thì dùng In". `failed` → 🔒 "Chưa tạo được PDF, hệ thống sẽ tự thử lại — tạm thời dùng In". Lấy lại `pdf_status` khi cửa sổ có focus lại (không polling) → OUT-1

## 3. Design

### 3.1 Dữ liệu — migration expand (cột mới nullable trên `contracts`, không đụng cột cũ)
| Cột | Ý nghĩa | Ghi một lần? |
|---|---|---|
| `pdf_key` TEXT | khóa R2 `contracts/{id}/{ulid}.pdf` | có — CAS `WHERE pdf_key IS NULL` |
| `pdf_hash` TEXT | sha256 hex của file | có |
| `pdf_size` INTEGER | byte | có |
| `pdf_at` INTEGER | unix giây tạo xong | có |
| `pdf_attempts` INTEGER NOT NULL DEFAULT 0 | số lần hết lượt hàng đợi | tăng |
| `pdf_failed_at` INTEGER | lần hết lượt gần nhất | cập nhật |
- `pdf_status` suy ra: không `issued`/`voided` → `none`; `pdf_key` ≠ NULL → `ready`; `pdf_failed_at` ≠ NULL → `failed`; còn lại → `pending`.
- Khóa R2 mỗi lần thử là ULID riêng: hai consumer cùng lúc → cả hai `put`, CAS chọn một, bên thua `delete` object của mình → hash trong DB luôn khớp đúng object.
- Index `idx_contracts_pdf_sweep` trên `(pdf_key, status)` cho cron.

### 3.2 Luồng tạo
1. `issueContract` thắng CAS → render + lưu `rendered_html` (như cũ) → `CONTRACT_PDF_QUEUE.send({ contract_id })` (try/catch, log `contract.pdf.enqueue_failed`) → event.
2. Consumer `contract-pdf` (mỗi message): đọc hợp đồng; không `issued`/`voided` hoặc đã có `pdf_key` → ack. `rendered_html` NULL → gọi `renderContract` (lưu một lần). `PdfRenderer.render(html)` → bytes → `put` R2 (`contentType application/pdf`) → CAS ghi `pdf_*` + `auditInsert(contract.pdf_generated)` trong **một `db.batch`** (CAS 0 dòng → `delete` object vừa put). Lỗi → `msg.attempts < 3` ? `retry({delaySeconds: 30 × attempts})` : ghi `pdf_attempts + 1`, `pdf_failed_at = now`, log `contract.pdf.failed` (không PII), ack.
3. Cron `*/5` (cùng lịch với verify sweeper, thêm vào dispatch): truy vấn FR-3 → `sendBatch`.
- Port `PdfRenderer { render(html: string): Promise<Uint8Array> }` (thư mục `ports/`); adapter `pdf-browser.ts` (puppeteer: `setContent(waitUntil:'load')` → `addStyleTag(font CSS)` → `document.fonts.ready` → `pdf({format:'A4', preferCSSPageSize:true, printBackground:true, displayHeaderFooter:false})` → `close()` trong `finally`; timeout 30s). Font: 6 file woff2 trong `apps/api/src/assets/fonts/` (import qua `[[rules]] type="Data"`), CSS dựng một lần/isolate. Test dùng renderer giả (bytes `%PDF-` cố định) truyền qua tham số — không gọi trình duyệt thật trong vitest.

### 3.3 Hạ tầng (wrangler, mirror dev/preview/production)
- `[browser] binding = "BROWSER"` · `[[r2_buckets]] binding = "FILES"`, `bucket_name` = `hopdong-files-dev` / `-preview` / `-prod` · queue `contract-pdf`: producer `CONTRACT_PDF_QUEUE` + consumer (`max_batch_size = 1`, `max_retries = 3`) · `[[rules]] type = "Data", globs = ["**/*.woff2"]`. `queue()` dispatch theo `batch.queue`.
- Bạn tạo khi deploy (ghi vào `docs/deploy.md`): `wrangler r2 bucket create hopdong-files-prod`, `wrangler queues create contract-pdf`. Local: miniflare tự giả lập R2 + queue; Chrome tải lần đầu ~90s.

### 3.4 API (contract-first; OpenAPI + client cập nhật ở card đầu)
- `GET /contracts/{id}/pdf` → 200 `application/pdf` (binary) · 401 · 403 (thiếu `contract:read`) · 404 · 409 `state-conflict` (`current_status`, chưa phát hành) · 409 `pdf-not-ready` (`pdf_status`: `pending`|`failed`, header `Retry-After: 60`).
- `Contract` += `pdf_status: "none"|"pending"|"ready"|"failed"`, `pdf_size: integer|null`. `ContractListItem` không đổi.
- `run_worker_first` đã có `/contracts/*` → không đổi.

## 4. Edge cases (driver chốt — bạn ủy quyền 2026-10-01)
| Category | Case here | Decision |
|---|---|---|
| Input | HTML bản in tiếng Việt đủ dấu, ký tự `₫` | now — font nhúng (AC-6) |
| Duplicates & identity | 2 message cùng hợp đồng / cron gửi lại khi đang chạy | now — CAS + khóa ULID, object thua bị xóa (AC-3) |
| Two people at once | nhiều người tải cùng lúc | now — chỉ đọc R2, cùng bytes |
| Failure & retry | trình duyệt lỗi/429/hết 10 phút/ngày; gửi hàng đợi lỗi lúc phát hành | now — phát hành không bị ảnh hưởng, thử lại + cron (AC-2 AC-4) |
| Permissions / not logged in | không đăng nhập, thiếu quyền, đoán id | now (AC-5) |
| Lifecycle | hủy hợp đồng trước/sau khi có PDF | now — vẫn tạo/giữ file gốc (AC-1) · xóa PDF: n/a (hợp đồng không bao giờ xóa) |
| Money | tổng tiền trong PDF | n/a — lấy nguyên từ bản in đã đóng băng |
| Time / dates | tên file theo số, không theo ngày tải | now (AC-1) |
| Bản in phát hành trước khi có tính năng | hợp đồng `HD-2026-00x` cũ | now — cron bù (AC-4) |

## 5. Security
- Chỉ người có `contract:read` (như bản in). Không URL công khai/ký sẵn R2; file đi qua Worker sau khi kiểm quyền. Không log/không audit nội dung, tên khách, SĐT — chỉ id + size.
- Không tải tài nguyên ngoài khi render (font nhúng; HTML không có script/ảnh ngoài) → không SSRF qua trình duyệt.
- Hạn mức trình duyệt: mỗi hợp đồng tạo một lần; cron giới hạn 20/lượt, 1 giờ/lần cho hợp đồng lỗi → không đốt hạn mức.

## 6. Decisions (driver chốt — bạn ủy quyền 2026-10-01)
- [DEC-1] Engine: Browser Rendering + R2 (INTENT Q-1 A — bạn chốt).
- [DEC-2] Lưu trạng thái PDF bằng cột trên `contracts` (cạnh `rendered_*`) thay vì bảng file riêng: một hợp đồng một file, đọc chung một dòng; row 3 tổng quát hóa cả bảng.
- [DEC-3] Font Arimo nhúng tên `Arial` chỉ lúc in PDF — bản in và hash không đổi.
- [DEC-4] Không có nút "tạo lại PDF" thủ công: cron tự thử lại mỗi giờ (phủ cả trường hợp hết hạn mức ngày). Thêm nút khi có nhu cầu thật.
- [DEC-5] Không audit lượt tải (đọc hợp đồng/bản in cũng không audit); chỉ audit lần tạo.

## 7. Acceptance
- [AC-1] Phát hành → chạy job (renderer giả) → `GET /contracts/{id}` `pdf_status = ready`; `GET …/pdf` → 200, `application/pdf`, `attachment; filename="HD-2026-001.pdf"`, body bắt đầu `%PDF-`, `ETag` = sha256 body; hủy hợp đồng → vẫn 200 cùng bytes — proves FR-1 FR-5 FR-6
- [AC-2] Renderer ném lỗi → phát hành vẫn 200 + có số; job hết lượt → `pdf_status = failed`, `GET …/pdf` → 409 `pdf-not-ready`; nháp/chờ duyệt → 409 `state-conflict` — proves FR-2 FR-3 FR-6
- [AC-3] Chạy job 2 lần cho cùng hợp đồng → một `pdf_key`, một dòng `contract.pdf_generated`, R2 chỉ còn 1 object dưới `contracts/{id}/` — proves FR-1 FR-7 §4 duplicates
- [AC-4] Hợp đồng phát hành không qua hàng đợi (`pdf_*` NULL, phát hành > 5 phút) → cron gửi việc; hợp đồng `failed` < 1 giờ không bị gửi lại — proves FR-3
- [AC-5] Không đăng nhập → 401; user không có `contract:read` → 403 + dòng `permission.denied`; id không tồn tại → 404 — proves §5
- [AC-6] (PROOF, `wrangler dev` + Chrome thật) phát hành trên giao diện → "Tải PDF" → file `HD-2026-00x.pdf`, `pdffonts` có Arimo nhúng, ảnh trang đúng dấu tiếng Việt, khớp bản in — proves FR-4 FR-8
- [AC-7] (web) ngăn chi tiết: `ready` → link tải; `pending`/`failed` → 🔒 đúng câu; nháp → không có nút — proves FR-8

## 8. Trace check
- [x] mọi FR trỏ về OUT · mọi AC chứng minh FR / edge "now" / DEC · mọi edge "now" có AC (đồng thời tải: chỉ đọc, phủ bởi AC-1)
