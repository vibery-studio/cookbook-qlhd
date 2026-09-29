# FIX-01: Swagger `/docs` trắng trang vì CSP

Status: Fixed 2026-09-29
Reported by: bạn (console trình duyệt khi mở http://localhost:8787/docs)

## Steps to reproduce
`pnpm dev` → mở `/docs` → console: "Loading the stylesheet 'https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css' violates … default-src 'self'" → trang trắng.

## Expected vs actual
Mong đợi: Swagger UI hiện đủ (WORKFLOW PROOF dùng `/docs`). Thực tế: CSP toàn cục `default-src 'self'` (RUNWAY `security-headers.ts`) chặn CSS/JS từ CDN và script khởi tạo inline của `@hono/swagger-ui`.

## Cause
Một CSP duy nhất cho mọi response; `/docs` là trang HTML duy nhất và cần CDN + inline script.

## Fix
Chỉ riêng `/docs` (đã tắt ở production) nhận CSP rộng hơn cho `cdn.jsdelivr.net` + inline; mọi route API giữ nguyên CSP chặt.
Test: `test/observability/security-headers.test.ts` › "/docs (dev only) lets Swagger UI load its CDN assets…" — đỏ trên code cũ, xanh sau sửa.
