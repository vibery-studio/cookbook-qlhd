# FIX-02: Giấy hợp đồng (in/PDF) không định dạng class `center`, `b`, `sig`

Status: Fixed 2026-10-01

## 1. What happens vs what should
- Steps: tạo hợp đồng từ mẫu seed (migration 0013) → xem bản in trình duyệt hoặc Tải PDF.
- Actual: quốc hiệu + tiêu đề không căn giữa/đậm; khối chữ ký ĐẠI DIỆN BÊN A / BÊN B không chia 2 cột đều. `PRINT_CSS` (`apps/api/src/domain/contract/render.ts`) không có `.center`, `.b`, `.sig` mà thân mẫu dùng.
- Expected: bố cục hợp đồng chuẩn như mockup đã duyệt `docs/cookbook/mockup/index.html` (`.doc-gov/.doc-h1` căn giữa đậm, `.doc-sign` 2 cột) — agreed where: mockup `.doc-paper`.

## 2. Failing test — before touching the code
- `test/domain/contract-render-css.test.ts` → đỏ (3 failed | 1 passed):
  `AssertionError: expected '\n  @page { size: A4; margin: 20mm 18…' to match /\.sig(?![\w-])/` — tương tự cho `.center`, `.b` (test đọc class từ migration 0013 qua `env.TEST_MIGRATIONS`, so với `<style>` của `renderHtml`).

## 3. Cause
- Template seed dùng class `center`, `b`, `sig`; CSS in chỉ định nghĩa khung trang/watermark/void-band. Class không có luật → trình duyệt/PDF bỏ qua.

## 4. Fix + proof
- Changed: thêm `.center`, `.b`, `.sig` (+ `th/td` 50%) vào `PRINT_CSS`. Không đụng watermark/void-band.
- Phạm vi: hợp đồng đã phát hành giữ HTML đã đóng băng (SPEC-03, theo thiết kế) và PDF đã lưu — chỉ hợp đồng phát hành mới có bố cục sửa.
- Test: `Test Files 1 passed (1) · Tests 4 passed (4)` (`CI=true pnpm --filter @runway/api exec vitest run test/domain/contract-render-css.test.ts`).
- `pnpm --filter @runway/api typecheck` → `tsc --noEmit` không lỗi; `pnpm --filter @runway/api lint` → `eslint src test` không lỗi.
- Driver: `.sig td` thường + nghiêng ("(ký, ghi rõ họ tên)"), `.sig th` đậm; xem ảnh PDF Chrome (Playwright) 2 trang: quốc hiệu/tiêu đề căn giữa đậm, chữ ký 2 cột. `contract-render-css` + `contracts-acceptance` + `contracts-4b-acceptance` → 3 files, 50 tests passed.
