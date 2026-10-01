# PLAN-05: Xuất PDF tài liệu đã phát hành

Status: Approved 2026-10-01 (driver chốt — bạn ủy quyền)
Spec: docs/spec/SPEC-05.md

## 1. Acceptance tests — written first, seen failing
| AC | How it's proven | Fails now? (real output) |
|---|---|---|
| AC-1 | `apps/api/test/integration/contracts-pdf-acceptance.test.ts` "AC-1" | × — `TypeError: Cannot read properties of undefined (reading 'list')` (chưa có binding `FILES`) |
| AC-2 | cùng file "AC-2" | × (cùng lỗi) |
| AC-3 | cùng file "AC-3" | × (cùng lỗi) |
| AC-4 | cùng file "AC-4" | × (cùng lỗi; `contract-pdf-sweeper` chưa có) |
| AC-5 | cùng file "AC-5" | × (cùng lỗi) |
| AC-6 | e2e `apps/web/e2e/contracts.spec.ts` (đợi "Tải PDF" → tải `HD-YYYY-001.pdf`, `%PDF-`) + PROOF: `pdffonts` + ảnh trang | chạy ở PROOF (e2e-kit: một lần đỏ ở PROOF không bắt buộc — spec viết trước, chạy một lần) |
| AC-7 | `apps/web/src/features/contracts/contract-drawer.test.tsx` "SPEC-05 AC-7" | × — `Unable to find role="link" name "Tải PDF"` |

## 2. Files that change
| File | New / Modify | Why (FR) |
|---|---|---|
| `apps/api/wrangler.toml` | M | `[browser]`, `[[r2_buckets]] FILES`, queue `contract-pdf`, `[[rules]]` woff2, var `PDF_RENDERER` — mirror 3 env (FR-2 FR-3) |
| `apps/api/src/env.ts` · `apps/api/vitest.config.ts` · `apps/api/test/env.d.ts` | M | bindings + `PDF_RENDERER` (`browser`\|`off`); test = `off` |
| `apps/api/src/db/schema.ts` + `migrations/0015_*.sql` | M/N | cột `pdf_*` + index (§3.1) |
| `apps/api/src/dto/contracts.ts` · `services/contract/read-service.ts` · `dao/contract-read-dao.ts` | M | `pdf_status`, `pdf_size` (FR-6) |
| `apps/api/src/routes/contracts.routes.ts` | M | route def `GET /contracts/{id}/pdf` (C-001) + handler (C-003) (FR-5) |
| `apps/api/src/ports/pdf-renderer-port.ts` · `adapters/pdf-browser.ts` · `adapters/pdf-fonts.ts` · `src/assets/fonts/*` | N | renderer + font Arimo (FR-4) |
| `apps/api/src/dao/contract-pdf-dao.ts` · `services/contract/pdf-service.ts` · `queues/contract-pdf-consumer.ts` · `crons/contract-pdf-sweeper.ts` | N | job, CAS + audit, thử lại, cron (FR-1 FR-3 FR-7) |
| `apps/api/src/index.ts` · `services/contract/issue-service.ts` | M | dispatch queue/cron; gửi việc sau phát hành (FR-2) |
| `apps/api/package.json` · `pnpm-lock.yaml` | M | `@cloudflare/puppeteer` 1.4.0 |
| `packages/client/**` · `dist/openapi.json` | M | `pnpm openapi:export && pnpm client:generate` |
| `apps/web/src/features/contracts/contract-drawer.tsx` · `paper-overlay.tsx` · `lock-reasons.ts` · `features/audit/audit-sentence.ts` | M | nút Tải PDF + câu nhật ký (FR-7 FR-8) |
| `docs/deploy.md` · `docs/architecture.md` (1 dòng) | M | tạo bucket/queue khi deploy; hạn mức Browser Rendering |

## 3. Cards
- [C-05-001] Nền: hạ tầng wrangler + env + migration + DTO `pdf_status` + OpenAPI route def + client → unblocks AC-1..AC-7
- [C-05-002] Job PDF: port + adapter trình duyệt + font, DAO, service, consumer, cron, enqueue sau phát hành → AC-1 AC-2 AC-3 AC-4 · depends C-05-001
- [C-05-003] Handler `GET /contracts/{id}/pdf` → AC-1 AC-2 AC-5 · depends C-05-002 (dùng `contract-pdf-dao`)
- [C-05-004] Web: Tải PDF (ngăn + bản in) + câu nhật ký → AC-7 · depends C-05-001 · song song C-05-002/003 (file rời)
- [C-05-005] Deploy doc + PROOF (suite + e2e một lần + Chrome thật + attack) → AC-6 + tất cả

## 4. Risks
- R-1 `@cloudflare/vitest-pool-workers` 0.9.9 có thể không khởi động khi wrangler.toml có `[browser]` → C-05-001 kiểm ngay; nếu lỗi: override binding trong `vitest.config.ts` (miniflare) thay vì bỏ khỏi wrangler.
- R-2 Free plan 10 phút/ngày: ~1–3s/PDF → vài trăm PDF/ngày; hết hạn mức → `failed`, cron thử lại mỗi giờ (đúng thiết kế). Ghi vào deploy.md.
- R-3 Lần đầu chạy Chrome cục bộ ~90s (tải trình duyệt) → e2e timeout 240s cho spec desktop.
- R-4 Queue miniflare tự giao message trong vitest → `PDF_RENDERER=off` làm consumer ack không làm gì (và cron không chạy) để test gọi trực tiếp không bị đua.
- ENGINEERING.md: không xung đột — adapter qua port, DAO thuần, CAS + `db.batch`, bindings mirror mọi env, migration chỉ thêm cột (expand).

## 5. Trace check
- [x] mọi FR có AC (FR-1 AC-1/3 · FR-2 AC-2 · FR-3 AC-2/4 · FR-4 AC-6 · FR-5 AC-1/5 · FR-6 AC-1/2 · FR-7 AC-3 · FR-8 AC-6/7) · mọi AC có dòng §1 · mọi AC có card · mọi edge "now" có AC

## 6. PROOF log
(điền ở C-05-005)
