# PLAN-08: Sản phẩm & giá — dịch vụ + hàng hóa, mức giá theo ngày (chưa VAT + thuế suất), dòng hàng trên tài liệu

Status: Approved 2026-10-01 (driver chốt — bạn ủy quyền; P-1..P-8 theo đề xuất §4)
Spec: docs/spec/SPEC-08.md (Approved 2026-10-01) · Intent: docs/intent/INTENT-08.md · Roadmap: ROADMAP-02 row 3
Chạy song song row 2b (PLAN-07). **C-08-001 chạy SAU C-07-001 + C-07-002** (chung `catalog.ts`, `schema.ts`, `migrations/meta/_journal.json`,
`data-inventory.ts`, `roles-acceptance`, `dto/error.ts`, `routes/index.ts`, `wrangler.toml`, `packages/client`). **2b merge trước → card 08 nào
đụng các file đó thì rebase, `pnpm db:generate` lại (đổi số migration), `pnpm openapi:export && pnpm client:generate` lại.**

## 0. Đối chiếu SPEC với code hôm nay (đã đọc)
| SPEC chỗ | Code thật | Kết luận PLAN |
|---|---|---|
| §3.1 "migration mới, số = kế tiếp" | 2b đã có `0019_eminent_flatman.sql` + `0020_seed_rbac_advanced.sql` | `0021_*` (drizzle: 2 bảng) · `0022_seed_products.sql` (custom: quyền + seed DEMO + trigger, trigger CUỐI) · `0023_seed_contract_template_v2.sql` (C-08-005). Số đổi nếu 2b thêm migration |
| §3.1 trigger so với `date('now','+7 hours')` | `vi.setSystemTime` chỉ đổi `Date` của JS, không đổi đồng hồ SQLite | test thêm mức giá chạy **đồng hồ thật** (P-4); `contracts-acceptance` (ghim 28/09/2026) không được thêm mức giá có ngày < hôm nay thật → AC-21 viết lại (C-08-005) |
| §3.3 `qty` 1–9.999 | `computeAmounts` (`pricing.ts`) `qty` 1–999, `so_cua_hang` 1–999 | hàm mới `domain/money/line-pricing.ts` (1–9.999); `pricing.ts` + `contract-pricing.test.ts` bị xóa ở C-08-005 (hết người dùng) |
| §3.4 bảng dòng an toàn | `mergeFields` escape mọi giá trị (`merge.ts:93`) | thêm kênh "HTML tin cậy" CHỈ cho trường kiểu `lines`: server dựng `<table>` từ `snapshot.lines`, escape từng ô bằng `escapeHtml`; giá trị người dùng không bao giờ vào kênh này |
| §3.5 "422 `lines`" | Problem 422 hiện có: `validation` + `errors[{path,message}]` (path nối bằng `.`) | P-2: luật tài liệu → `validation` `errors[{path:"lines"}]`; lỗi theo dòng → `errors[{path:"lines.<i>.product_id"}]` |
| §3.4 nguồn `price_list:*` | `SOURCE_REGISTRY.price_list`, `TemplateField.options_from`, `template-check.test` coi `price_list:unit_price` hợp lệ | bỏ ở C-08-005 cùng mẫu v2 (mẫu v1 vẫn lưu nguyên, không dựng lại được → không ai dùng v1 nữa: DEC-8 + Q-6 wipe demo) |
| `GET /price-list` bỏ | web `usePriceListCodes` (`features/contracts/api.ts`) gọi nó; client có kiểu `PriceList` | bỏ ở C-08-005 (cùng lúc snapshot thôi đọc `price_list`), kèm shim biên dịch web; UI thật ở C-08-008 |
| Privacy | `INVENTORY_EXEMPT_TABLES` phải đủ mọi bảng (privacy-flow kiểm) | `products`, `product_prices` = hồ sơ kinh doanh, không PII → C-08-001 thêm vào danh sách miễn |
| `run_worker_first` | có `/price-list`, kiểm bởi `web-shell-acceptance` | 003 thêm `/products`, `/products/*`, `/pricing/*` × 3 block; 005 bỏ `/price-list` |

## 1.
Red run (driver 2026-10-01): `products-acceptance` 9/9 đỏ (route 405/404, `/me` thiếu `price:write`); `line-pricing.test.ts` không nạp được module (`Failed to load url ../../src/domain/money/line-pricing`) — đúng kỳ vọng.
 Acceptance tests — written first, seen failing
Files (viết ở PLAN; `pnpm --filter @runway/api typecheck` → 0 lỗi; eslint 2 file API → 0 lỗi; e2e compile sạch với tsconfig tạm gồm `e2e/`):
- `apps/api/test/integration/products-acceptance.test.ts` — 9 test (AC-1..AC-8 + §5). Bảng mới chỉ chạm qua SQL thô trong từng assertion. Đồng hồ thật (P-4).
- `apps/api/test/domain/line-pricing.test.ts` — ~35 test hàm thuần (§3.3, DEC-2/3/4, FR-3), dynamic import `src/domain/money/{line-pricing,price-at}`.
- `apps/web/e2e/products.spec.ts` — 1 spec desktop (AC-10), hợp đồng UI ở đầu file. Không chạy ở PLAN.

Red run: driver chạy tuần tự `CI=true pnpm --filter @runway/api exec vitest run test/integration/products-acceptance.test.ts test/domain/line-pricing.test.ts` → [ ] (điền output thật; kỳ vọng: integration 9 failed (route 404, `/me` thiếu 2 mã); domain: lỗi import module chưa có).

| AC | Chứng minh bằng | Card xanh | Đỏ bây giờ? |
|---|---|---|---|
| AC-1 | API `AC-1` (`/me` QL+GĐ có `product:write`,`price:write`, NV/admin không; catalog chứa 2 mã; seed G3/G6/G12 KCT, DT14 ngừng bán, 2 hàng DEMO 10% tên chứa "DEMO"; `?date=2026-06-30` G6 2.400.000 + `effective_to` 30/06 + `next_price`; `2026-07-01` 2.700.000; 422 ngày giả; lọc `kind`/`active`/`q`) | 001 + 004 | [ ] |
| AC-2 | API `AC-2` (201 `MAY-IN-01`, gồm VAT 2.200.000; Idempotency replay; 1 `product.created` + 1 `price.added`; 409 `duplicate` khác hoa/cách; 15 input sai → 422; mức đầu hôm qua → `price-backdated`; PATCH `code`/`kind` 422; NV 403 + denied `product:write`; ẩn danh 401) | 004 | [ ] |
| AC-3 | API `AC-3` (hôm qua + hôm nay → `price-backdated` (DEC-5 B); 422 thuế 7%/giá âm/ngày giả; mai 1.100.000 8% → 201, gồm VAT 1.188.000; hôm nay giữ mức cũ + `next_price`; lịch sử `scheduled`/`current`; trùng ngày 409; DELETE mức mai 204 + `price.cancelled`, lần 2 404; DELETE mức đang áp dụng 409 `price-in-effect`; D1 thẳng: UPDATE/DELETE/INSERT lùi ngày → lỗi trigger) | 001 + 004 | [ ] |
| AC-4 | API `AC-4` (G6 −5% → 2.565.000, dòng snapshot đủ 14 trường, `vat_groups [{null,…,0}]`, không còn `package`/`gross`; G12×2 −15% 8.160.000; G6 + MIN → 3.800.000, 2 nhóm; G6 + GIẤY×3 −5% → 2.627.700; preview GIẤY×3 −5% → 62.700, không ghi gì; 9 kiểu gửi giá/tổng/`ma_goi`/qty sai → 422) + unit `line-pricing.test.ts` | 002 + 005 | [ ] |
| AC-5 | API `AC-5` (HĐ phát hành: đổi tên G6 + mức mai + ngừng bán → `/render` cùng byte, cùng ETag; nháp giữ `snapshot_hash`; sửa nháp → 422 `product-inactive` `lines.0.product_id`; bán lại → sửa được, tên mới, giá hôm nay; `product.updated {code, fields:["name"]}`, `product.deactivated`, `product.reactivated`) | 004 + 005 | [ ] |
| AC-6 | API `AC-6` (0 dòng, 51 dòng, 2 dịch vụ, chỉ hàng hóa, dịch vụ theo ngày → `validation` `lines`; DT14 → `product-inactive`; trùng → `lines.2.product_id`; chưa có giá / giá từ D+3 → `no-price` `lines.1.product_id`; id lạ → `validation`; 0 HĐ được tạo) | 005 | [ ] |
| AC-7 | API `AC-7` (mẫu v2 hiện hành, v1 giữ nguyên "đã gồm VAT"; trường v2 + nguồn `derived:*`, `bang_hang` kiểu `lines`; bản in có bảng 5 cột, "KCT", số tiền, bằng chữ; G6 + MIN → "KCT, 10%"; tên `<b>x</b>` in thành chữ) | 005 | [ ] |
| AC-8 | API `AC-8` (2 PATCH cùng version → [200, 409 `stale`], 1 `product.updated`; 2 mức cùng ngày song song → [201, 409], 1 dòng, 1 `price.added`) | 004 | [ ] |
| AC-9 | done-check C-08-006: `RUNWAY_LOCAL=1 pnpm dev:seed-products` ×2 → cùng `SELECT` · đổi giá trong JSON + `--replace` → giá mới, trigger còn đủ 3 · thiếu `RUNWAY_LOCAL` → exit ≠ 0 (không có harness test cho `scripts/`) | 006 | n/a (lệnh) |
| AC-10 | e2e `products.spec.ts` + human 390px (bảng → thẻ, ngăn toàn màn) | 009 | e2e chưa chạy (ngân sách 1 lần ở PROOF) |
| §5 | API `§5` (7 endpoint ẩn danh 401; NV đọc 200, 4 ghi → 403 + 1 denied mỗi lần; admin 403 ×3 + denied; `GET /price-list` 404) | 004 + 005 | [ ] |

Test đơn vị web (red-first trong card): `features/products/*.test.ts(x)` (gồm VAT hiển thị, nhãn trạng thái mức giá, 🔒) — 007; `permission-labels.test.ts` (2 mã), `audit-sentence.test.ts` (`product.*`, `price.*`), `problem-messages.test.ts` (4 slug + `lines.<i>.product_id`), `nav.test.ts` (thứ tự) — 007; `contracts-logic.test.ts` (dòng → body, parse snapshot mới), `contract-drawer.test.tsx` (bảng dòng + nhóm thuế) — 008.

### 1b. Test đang có phải đổi (SPEC R-3) — đúng card gây ra, không sửa cho xanh
| File | Đổi gì | Card |
|---|---|---|
| `api/test/integration/foundation-acceptance.test.ts` | AC-1: danh sách quyền GĐ + QL thêm `price:write`, `product:write` | 001 |
| `api/test/integration/roles-acceptance.test.ts` | `CATALOG` +2 mã; `SEED_GRANTS.giam_doc`, `.quan_ly` +2 mã | 001 |
| `api/test/integration/rbac-advanced-acceptance.test.ts` | `toHaveLength(18)` → 20; `SEED_GRANTS.giam_doc`, `.quan_ly` +2 mã (nếu không, `restoreSeedRoles` tước quyền mới) | 001 |
| `api/test/integration/web-shell-acceptance.test.ts` | `SPA_URLS` + `/san-pham` (không bị `/products*` nuốt) | 003 |
| `api/test/integration/foundation-acceptance.test.ts` | AC-7 (`GET /price-list`) xóa — thay bằng `products-acceptance` AC-1; AC-8 vòng 401: `/price-list` → `/products` | 005 |
| `api/test/integration/contracts-acceptance.test.ts` | `BASE_VALUES`/`WITHOUT_TITLE` → `lines:[{G6,1}]` + `values {giam_gia, chuc_vu_nguoi_ky}` (helper `g6Line()` đọc id qua `GET /products`); kiểu `Snapshot` mới; AC-6 (giá theo ngày: 30/06 → 2.400.000, 01/07 sửa nháp → 2.700.000 — mức seed, không chèn); AC-7 (`snapshot.lines` mới, `vat_groups`, `total_ex_vat`; DT14 → `product-inactive`; `so_cua_hang` 0/1000 → `qty` 0/10.000; "đã trừ giảm giá 5%" → chữ mẫu v2); AC-12/AC-11 (`ma_goi:"G12", so_cua_hang:2` → `lines:[{G12,2}]`); AC-17/AC-23 (body khác = `qty:2`); AC-21 (bỏ `UPDATE/INSERT price_list`; thay bằng đổi tên + ngừng bán G6 qua SQL thô `UPDATE products` và mức tương lai xa `2099-01-01` chèn SQL — trigger cho phép vì ≥ hôm nay thật); AC-24 (tamper: `unit_price` trong dòng + `total` → 422, `tong_tien` trong values → 422) | 005 |
| `api/test/integration/contracts-4b-acceptance.test.ts` · `contracts-delete.test.ts` · `contracts-withdraw.test.ts` · `contracts-pdf-acceptance.test.ts` | `WITHOUT_TITLE`/`values` → `lines` + values mới; kiểu `Snapshot` (bỏ `package`, `lines` cũ) | 005 |
| `api/test/integration/templates-acceptance.test.ts` | seed hiện hành = v2: AC-1 (`version_no` 2, versions [1,2], bỏ kỳ vọng `ma_goi.options`), AC-2 (`SEED_SOURCES` = placeholder + nguồn v2, số placeholder v2; thân không còn "đã gồm VAT"), AC-3/4/5/6/9/… `expected_version_no: 1` → `2`, bản tạo ra `version_no` 3, so byte bản 2; dòng 491/547 `toBe(1)` → `2` | 005 |
| `api/test/integration/template-seed-check.test.ts` | đọc bản hiện hành (v2): `checkTemplate` = [], số trường/placeholder v2, `bang_hang` kiểu `lines`; v1 vẫn còn + audit `template.created` v1 giữ; thêm 1 dòng `template.version_created` actor NULL `{version_no:2, fields:N}` | 005 |
| `api/test/domain/contract-snapshot.test.ts` | viết lại theo `buildSnapshot({…, lines})` (fixture: G6 + MIN, KCT + 10%) | 005 |
| `api/test/domain/template-check.test.ts` | `price_list:unit_price` → không hợp lệ; thêm `derived:lines_table` + kiểu `lines` hợp lệ; `lines` chỉ đi với `derived:lines_table` | 005 |
| `api/test/domain/contract-pricing.test.ts` | xóa cùng `domain/contract/pricing.ts` (thay bằng `line-pricing.test.ts`) | 005 |
| `api/test/events/contract-events.test.ts` | chỉ khi nó dựng snapshot v1 (kiểm lúc build) | 005 |
| `web/src/features/roles/permission-labels.test.ts` | `ALL_CODES` + 2 mã, nhãn "Sửa sản phẩm", "Đặt giá" | 007 |
| `web/src/app/nav.test.ts` | thứ tự nav + `/san-pham` sau `/khach-hang` | 007 |
| `web/src/lib/problem-messages.test.ts` | bỏ `values.ma_goi`/`values.so_cua_hang`; thêm `no-price`, `product-inactive`, `price-backdated`, `price-in-effect`, `lines.<i>.product_id` | 007 |
| `web/src/features/contracts/contracts-logic.test.ts` · `contract-drawer.test.tsx` | form dòng hàng, snapshot mới (bảng + nhóm thuế, "Tổng thanh toán"), bỏ "đã gồm VAT" | 008 |
| `web/e2e/contracts.spec.ts` | "Gói dịch vụ"/"Số cửa hàng" → khối dòng (`Sản phẩm dòng 1` = G6, `Số lượng dòng 1` = 1); 2.565.000 giữ (G6 KCT −5%); hợp đồng UI ở đầu file | 008 |
| `web/e2e/global-setup.ts` | `seedContracts()` → `GET /products` lấy id G6 → `lines:[{G6,1}]`, values bỏ `ma_goi`/`so_cua_hang` | 008 |

## 2. Files that change
| File | New / Modify | Why (FR) | Card |
|---|---|---|---|
| `api/src/db/schema.ts` · `migrations/0021_*.sql` (drizzle) · `migrations/0022_seed_products.sql` (custom) · `migrations/meta/*` | M/N | 2 bảng + CHECK + index; quyền + grant; seed DEMO; 3 trigger (§3.1) — FR-1/2/7/10 | 001 |
| `packages/rbac/src/catalog.ts` · `docs/rbac.md` · `api/src/privacy/data-inventory.ts` | M | 2 mã (FR-7); bảng mới miễn privacy | 001 |
| `api/src/domain/money/line-pricing.ts` · `price-at.ts` | N | hàm thuần dùng chung (FR-3, FR-11, §3.3) | 002 |
| `api/src/dto/products.ts` · `dto/error.ts` · `routes/products.routes.ts` · `routes/pricing.routes.ts` (501) · `routes/index.ts` · `wrangler.toml` · `packages/client/src/generated/*` | N/M | hợp đồng §2b trước handler (FR-1/2/4/7) | 003 |
| `api/src/dao/product-dao.ts` · `services/product-service.ts` · `routes/products.routes.ts` | N/M | CRUD sản phẩm + mức giá, CAS, trigger, audit (FR-1/2/3/8) | 004 |
| `api/src/domain/contract/{snapshot,types,merge,render}.ts` · xóa `pricing.ts` · `domain/template-sources.ts` · `domain/template-check.ts` · `dto/templates.ts` · `dto/contracts.ts` · `dao/product-pricing-dao.ts` (N, đọc) · `services/contract/{snapshot-builder,copy-service,create-service,update-service}.ts` · `routes/contracts.routes.ts` · `routes/pricing.routes.ts` · xóa `routes/price-list.routes.ts`, `dto/price-list.ts`, `dao/price-list-dao.ts` · `routes/index.ts` · `wrangler.toml` · `migrations/0023_seed_contract_template_v2.sql` + meta · client · shim web `features/contracts/{api,values,contract-form-modal}` | M/N/D | tài liệu dùng dòng + mẫu v2 + preview (FR-4/5/6/11, DEC-7/8/9/10/13) | 005 |
| `scripts/dev-seed-products.ts` · `scripts/data/products.demo.json` · `scripts/lib/dev-seed.ts` · `package.json` · `CLAUDE.md` (1 dòng Commands) | N/M | seeder DEMO (FR-10, DEC-12) | 006 |
| `web/src/features/products/**` · `app/{nav,router}.ts(x)` · `app/nav.test.ts` · `ui/icon.tsx` · `features/roles/permission-labels.ts` · `features/audit/audit-sentence.ts` · `lib/problem-messages.ts` (+test) | N/M | màn Sản phẩm & giá, nhãn, câu nhật ký, câu lỗi (FR-7/8/9) | 007 |
| `web/src/features/contracts/**` · `features/templates/templates-screen.tsx` (nhãn kiểu `lines`) · `web/e2e/{contracts.spec,global-setup}.ts` | M | form dòng hàng + ô tổng (preview) + drawer (FR-9, DEC-13) | 008 |
| `web/e2e/shots/*` · `docs/plan/PLAN-08.md` · `docs/roadmap/ROADMAP-02.md` · `docs/cookbook/design/DESIGN.md` (dòng màn mới — bạn duyệt) | M | PROOF | 009 |

### 2b. API contract (C-08-003 khóa; card sau đổi → dừng, báo driver)
- `Level {id, effective_from, effective_to: string|null (= ngày trước mức kế, tính khi đọc), unit_price_ex_vat, vat_rate_bps: 0|500|800|1000|null (null = KCT), unit_price_inc_vat (half-up, chỉ hiển thị)}`.
- `Product {id, kind: service|goods, code, name, unit, duration_value|null, duration_unit: day|month|null, active, version, price: Level|null (tại `date`), next_price: Level|null (mức đầu tiên sau `date`), can:{edit (= product:write), price (= price:write)}}`.
- `GET /products?date&kind&active&q&limit` (`contract:read`) → `{date, items}`; `date` mặc định hôm nay VN, sai → 422; `active` bỏ trống = tất cả (P-3); `q` khớp `code_norm` (q viết hoa) hoặc `lower(name)` (q viết thường, giữ dấu); `limit` 1–100 mặc định 100; thứ tự: dịch vụ trước, rồi `code`.
- `GET /products/{id}` (`contract:read`) → `Product & {prices: (Level & {status: past|current|scheduled, created_by_name})[]}` mới nhất trước; 404.
- `POST /products` (`product:write`; có `first_price` thì service kiểm thêm `price:write` → 403 + denied; `withIdempotency`) `{kind, code, name, unit, duration_value?, duration_unit?, first_price?: {unit_price_ex_vat, vat_rate_bps, effective_from}}.strict()` → 201 `Product`. `code` trim + upper, `[A-Z0-9._-]{1,32}`; tên 1–120; ĐVT 1–20; service ⇒ `month` 1–120 / `day` 1–3650; goods ⇒ không thời hạn. Thứ tự lỗi: 422 schema → 422 `price-backdated` (first_price < hôm nay) → 409 `duplicate` (UNIQUE `code_norm`) → 409 `product-limit` (≥ 500, P-6).
- `PATCH /products/{id}` (`product:write`) `{expected_version, name?, unit?, duration_value?, duration_unit?, active?}.strict()` (gửi `code`/`kind` → 422) → 200 `Product`; 404 · 409 `stale` (CAS `version`). Audit: đổi trường → `product.updated {code, fields}`; đổi `active` → `product.deactivated|reactivated {code}` (cùng request đổi cả hai → cả hai dòng). Thêm/hủy mức giá KHÔNG tăng `products.version`.
- `POST /products/{id}/prices` (`price:write`, `withIdempotency`) `{unit_price_ex_vat, vat_rate_bps, effective_from}.strict()` → 201 `Level`; 404 · 422 `price-backdated` (< mai khi đã có mức; < hôm nay khi là mức đầu) · 409 `duplicate` (UNIQUE `(product_id, effective_from)`). Không check-then-write: INSERT + bắt UNIQUE / RAISE.
- `DELETE /products/{id}/prices/{priceId}` (`price:write`) → 204; 404 · 409 `price-in-effect` (trigger RAISE hoặc `effective_from ≤ hôm nay`). Audit `price.cancelled`.
- `POST /pricing/preview` (`contract:write`) `{lines: [{product_id, qty}] (1–50), discount_bps 0–10000}.strict()` → 200 `{doc_date, lines: SnapshotLine[], vat_groups, subtotal_ex_vat, discount_amount, total_ex_vat, vat_total, total, total_words}`; chỉ luật chung (P-1): dòng tồn tại · đang bán · có giá hôm nay · không trùng; KHÔNG luật DEC-10. Không ghi gì.
- `POST /contracts` `{template_id, customer_id, lines: [{product_id: Ulid, qty: int 1–9999}.strict()] (min 1, max 50), values}`; `PATCH /contracts/{id}` + `lines?`; `ContractValues` = `{giam_gia?, chuc_vu_nguoi_ky?, ngay_bat_dau?, so_bao_gia?, ngay_bao_gia?}.strict()` (bỏ `ma_goi`, `so_cua_hang`). Thứ tự kiểm dòng (P-2): theo từng dòng i — id lạ → 422 `validation` `lines.i.product_id` · trùng → `validation` `lines.i.product_id` · ngừng bán → 422 `product-inactive` · không có giá ngày lập → 422 `no-price` (`errors[{path:"lines.i.product_id"}]`, mọi dòng lỗi cùng slug được liệt kê, slug = lỗi đầu tiên theo thứ tự này); rồi luật DEC-10 → `validation` `errors[{path:"lines"}]`.
- Slug mới (`dto/error.ts`): `price-backdated`, `price-in-effect`, `no-price`, `product-inactive`, `product-limit`.
- Snapshot (§3.2): `lines[{product_id, code, name, kind, unit, duration_value, duration_unit, qty, unit_price_ex_vat, vat_rate_bps, price_from, amount_ex_vat, discount_amount, net_ex_vat}]` · `vat_groups[{vat_rate_bps, base, vat}]` (KCT trước, rồi thuế suất tăng dần) · `subtotal_ex_vat` · `discount_bps` · `discount_amount` · `total_ex_vat` · `vat_total` · `total` · `total_words` · `inputs = {…values thủ công, lines:[{product_id, qty}]}` · bỏ `package`, `gross`.
- Mẫu v2 (`0023`, DEC-8): trường mới — `ten_goi` `derived:service_name` · `bang_hang` kiểu `lines` `derived:lines_table` · `tien_truoc_thue` `derived:subtotal_ex_vat` (money) · `tien_giam_gia` `derived:discount_amount` (money) · `thue_suat` `derived:vat_rates` (text: "KCT", "KCT, 10%", "8%, 10%") · `tien_thue` `derived:vat_total` (money) · `tong_thanh_toan` `derived:total` (money) · `tong_thanh_toan_bang_chu` `derived:total_in_words`; giữ các trường còn lại của v1 trừ `ma_goi`, `so_cua_hang`, `tong_tien`, `tong_tien_bang_chu`. Thân = v1, chỉ thay Điều 1–2 theo SPEC §3.4. Bảng: `<table class="lines">` STT · Tên · ĐVT · SL · Đơn giá chưa VAT · Thuế suất · Thành tiền chưa VAT.
- Hàm thuần (C-08-002, chữ ký cố định — 004/005 import): `priceLines(lines, discountBps)`, `unitPriceIncVat(price, rate)`, `vatRatesLabel(groups)` (`line-pricing.ts`); `levelAt(levels, date)`, `withEffectiveTo(levels)`, `levelStatus(level, levels, today)` (`price-at.ts`). Hình dạng: đầu `test/domain/line-pricing.test.ts`.
- Trigger (P-4, chữ RAISE cố định): `product_prices is append-only: UPDATE refused` · `product_prices: a price in effect cannot be deleted` · `product_prices: backdated price refused`.

## 3. Cards — một việc nhỏ mỗi card (docs/plan/cards/C-08-NNN.md)
Thứ tự: [C-07-001 + C-07-002 xong] → 001 ∥ 002 → 003 → 004 ∥ 005 ∥ 006 → 007 → 008 → 009. API suite và e2e không chạy cùng lúc; driver chạy vitest tập trung.
1. **[C-08-001]** dữ liệu + quyền + seed DEMO + trigger → AC-1, AC-3 (trigger), AC-9 (nền), FR-1, FR-2, FR-7, FR-10 · sau C-07-001, C-07-002
2. **[C-08-002]** tiền thuần + giá theo ngày → AC-4 (unit), FR-3, FR-11, DEC-2, DEC-3, DEC-4 · không phụ thuộc
3. **[C-08-003]** hợp đồng OpenAPI sản phẩm + preview (501) + slug + client → nền AC-1..AC-8 · sau 001, C-07-002
4. **[C-08-004]** API sản phẩm & giá → AC-1, AC-2, AC-3, AC-8, §5 (ghi) · sau 002, 003
5. **[C-08-005]** tài liệu dùng dòng + mẫu v2 + preview + bỏ `/price-list` → AC-4, AC-5, AC-6, AC-7, §5 (`/price-list`) · sau 002, 003 (∥ 004; AC-5 xanh khi có cả 004)
6. **[C-08-006]** seeder `dev:seed-products` → AC-9 · sau 001 (∥ 004/005)
7. **[C-08-007]** web Sản phẩm & giá + nhãn quyền + câu nhật ký + câu lỗi → AC-10 (phần màn), FR-8 UI, FR-9 · sau 004, C-07-007, C-07-008
8. **[C-08-008]** web form dòng hàng + ô tổng + drawer; e2e contracts/global-setup theo form mới → AC-10 (phần HĐ), DEC-13 · sau 005, 007
9. **[C-08-009]** e2e một lần + PROOF → AC-1..AC-10 · sau 001–008

Điều phối: 004 và 005 rời nhau — 004 sở hữu `dao/product-dao.ts`, `services/product-service.ts`, `routes/products.routes.ts`; 005 đọc giá qua DAO riêng `dao/product-pricing-dao.ts` (`linesAt(db, productIds, date)`), sở hữu `routes/pricing.routes.ts`. Chỉ 003 và 005 sinh `packages/client` (005 sau 003; 004 không đổi OpenAPI). `dto/products.ts` chỉ 003 sửa. 007 sở hữu `lib/problem-messages.ts` (kể cả câu lỗi dòng hàng 008 dùng) → 008 sau 007.

## 4. Risks
- R-1 (SPEC R-1) Va chạm row 2b: xem đầu file. 2b còn chạy song song: C-07-007/008 sửa `audit-sentence.ts`, `problem-messages.ts`, `permission-labels.ts`, `app/nav.ts`, `router.tsx`, `ui/icon.tsx` → C-08-007 đi sau chúng. `rbac-advanced-acceptance` (file PLAN của 2b) bị 001 sửa 2 hằng — báo driver 2b.
- R-2 Cửa sổ đỏ trong 005: snapshot, DTO, mẫu v2, test hợp đồng đổi CÙNG card (tách ra thì mẫu v1 không dựng được, mọi HĐ 422). Card lớn — chia commit nội bộ theo bước nhưng chỉ đóng card khi mọi suite hợp đồng xanh. Giữa 005 và 008 form web gửi `lines: []` (shim biên dịch) → tạo HĐ trên web lỗi; không demo trong khoảng này.
- R-3 Đồng hồ: trigger dùng đồng hồ SQLite (thật); test ghim `Date` không được chèn mức giá < hôm nay thật (P-4). `products-acceptance` dựa vào ngày thật ≥ 2026-07-01 (mức seed G6 2.700.000) — đúng mãi về sau.
- R-4 drizzle-kit: CHECK (`check()` của drizzle-orm 0.45) phải có trong SQL sinh ra — đọc `0021_*.sql`; thiếu → viết tay, giữ snapshot khớp (`db:generate` lần 2 → "No schema changes"). Trigger + seed chỉ ở `0022` custom. Seed chèn TRƯỚC trigger INSERT (mức 2025/2026 nằm trước hôm nay).
- R-5 Kênh HTML tin cậy cho `lines` là chỗ duy nhất bỏ qua escape tổng — `renderLinesTable` escape từng ô, test XSS ở AC-7 + unit `contract-merge.test.ts` (thêm 1 test). `template-check` chặn kiểu `lines` với nguồn khác `derived:lines_table`.
- R-6 Seeder `--replace` phải tạm bỏ trigger `product_prices` rồi tạo lại đúng SQL cũ trong cùng batch (mẫu `clearAuditEvents`); chỉ local (`RUNWAY_LOCAL`, `--local`). Sai → bảng mất khóa append-only: done-check đếm lại 3 trigger.
- R-7 (SPEC R-5) Wipe demo local khi build xong 005: `mv apps/api/.wrangler/state /tmp/state-…` → `pnpm db:migrate:local` → `RUNWAY_LOCAL=1 pnpm dev:seed-team` → `RUNWAY_LOCAL=1 pnpm dev:seed-products`.
- R-8 Phiên đang mở của QL/GĐ chỉ thấy 2 quyền mới sau khi cache phiên (60 s) hết hạn — local, chấp nhận.
- R-9 e2e: `products.spec.ts` chạy sau `contracts.spec.ts`, trước `rbac-advanced`/`roles`/`shell`; để lại KEP-E2E-01 + mức G6 từ mai — không đổi giá hôm nay. `global-setup` đổi ở 008.
- **Lỗi/thiếu của SPEC (bạn duyệt):**
  - P-1 AC-4 "DEMO-GIAY-01 × 3 −5% → 62.700" không thể là hợp đồng (DEC-10: HĐ phải có đúng 1 dịch vụ tháng; AC-6 "chỉ hàng hóa → 422"). PLAN: 62.700 chứng minh qua `POST /pricing/preview` (preview chỉ luật chung) + unit test; ca hợp đồng = G6 + GIẤY×3 −5% → 2.627.700.
  - P-2 "422 `lines`" không phải slug trong danh sách §3.5 → `validation` + `errors[].path` (xem §2b); thứ tự kiểm theo dòng trước luật tài liệu (DT14 → `product-inactive`).
  - P-3 `GET /products` thiếu nghĩa mặc định của `active` → bỏ trống = tất cả (tab "Tất cả").
  - P-4 SPEC không nói test thời gian với trigger D1 → đồng hồ thật + chữ RAISE cố định (§2b).
  - P-5 "Mọi dòng seed gắn nhãn DEMO" nhưng bảng không có cột ghi chú, và G3/G6/G12 in lên HĐ ("Gói 6 tháng") — PLAN: chỉ 2 hàng hóa có "(DEMO)" trong tên + mã `DEMO-*`; gói giữ tên (giá là giá thật, chỉ "KCT" là giả định) — nhãn DEMO của gói nằm ở comment migration + `products.demo.json` (`"demo": true`). Muốn nhãn DEMO hiện trên app cho gói → cần cột `note` (đổi SPEC).
  - P-6 §5 "trần 500 sản phẩm" không có lỗi trong bảng API → 409 `product-limit` (INSERT … WHERE (SELECT COUNT(*) FROM products) < 500, 0 dòng → 409). Không có AC (giữ như `role-limit` của 2a: test integration nhỏ trong 004).
  - P-7 Mẫu v2 bỏ "cho {{so_cua_hang}} cửa hàng" ở Điều 1 (số lượng nằm trong bảng) — câu chữ trên giấy đổi, bạn xem ở PROOF.
  - P-8 Dòng hợp đồng: SL của gói = số cửa hàng (1–9.999, trước đây 1–999) — nới theo §3.3.
- ENGINEERING.md: không xung đột (route giữ `c`; service không thấy `c`; DAO thuần; CAS `version` + `db.batch` thay đổi + audit; UNIQUE + trigger thay check-then-write; Problem+JSON; ghi cần Origin + `X-Requested-With`; `run_worker_first` mirror 3 block; không binding mới). Migration expand-only; `DROP price_list` ở PR sau (DEC-9).

## 5. Trace check (trước STOP)
- [x] mọi FR có AC: FR-1→AC-2 · FR-2→AC-3 · FR-3→AC-1, AC-3 · FR-4→AC-4, AC-6 · FR-5→AC-5 · FR-6→AC-7 · FR-7→AC-1, §5 · FR-8→AC-2, AC-3, AC-5, AC-8 · FR-9→AC-10 · FR-10→AC-1, AC-9 · FR-11→`line-pricing.test.ts` (C-08-002; module dưới `domain/money/`, không import `contract`)
- [x] mọi AC có dòng §1 · mọi AC có card (`serves`) · DEC-1→AC-3 · DEC-2/3/4→AC-4 + unit · DEC-5→AC-2, AC-3 · DEC-6→AC-3 · DEC-7/8→AC-7 · DEC-9→§5 (`/price-list` 404) · DEC-10→AC-6 · DEC-11→AC-1, §5 · DEC-12→AC-9 · DEC-13→AC-4 (preview), AC-10
- [x] edge "now" có AC: Input AC-2, AC-3, AC-4, AC-6 · Duplicates AC-2 (code + Idempotency), AC-3, AC-6, AC-8 · Two people AC-8 · Failure AC-8 (thua không audit) · Permissions AC-1, AC-2, §5, AC-10 · Lifecycle AC-5 · Money AC-4 + unit (KCT, nhiều thuế suất, half-up nhóm, 0đ, −100%, không float) · Time AC-1 (ngày VN), AC-3 (mai/hôm qua, trigger), AC-6 (giá từ D+3) · Thuế đổi AC-3 (mức 8% từ mai)
- [ ] red run API (driver) · [ ] bạn duyệt P-1..P-8 + PLAN

## 6. PROOF log (step 5) — điền ở C-08-009
- Checks: `pnpm lint && pnpm typecheck && pnpm build` · `pnpm openapi:export && pnpm client:generate && git diff --exit-code packages/client` · `CI=true pnpm test` · TUẦN TỰ sau đó `bash docs/cookbook/e2e-kit/free-ports.sh 8791` rồi `PROOF_SHOTS=1 CI=true pnpm --filter @runway/web e2e` (một lần).
- Human checklist (làm → phải thấy):
  - AC-1: QL → "Sản phẩm & giá": G3/G6/G12 "KCT", DT14 ở tab "Ngừng bán", 2 hàng "(DEMO)" 10%, cột "Giá gồm VAT" = 1.100.000 / 22.000.
  - AC-2: "+ Thêm sản phẩm" hàng hóa mã `may-in-01` → hiện `MAY-IN-01`; thêm lại `May-In-01` → "Mã này đã có"; bấm Lưu 2 lần nhanh → 1 dòng.
  - AC-3: ngăn DEMO-MIN-01 → "+ Thêm mức giá" (ngày nhỏ nhất = mai) 1.100.000 · 8% → "Sắp áp dụng", gồm VAT 1.188.000; "Hủy" → biến mất; mức "Đang áp dụng" không có nút Hủy.
  - AC-4: NV tạo HĐ G6 + DEMO-MIN-01 → ô tổng: trước thuế 3.700.000 · KCT 0 · Thuế GTGT 10% 100.000 · Tổng thanh toán 3.800.000; drawer + bản in cùng số.
  - AC-5: phát hành 1 HĐ G6 → đổi tên G6 + ngừng bán → bản in HĐ đó không đổi; nháp có G6 → sửa → lỗi nêu "dòng 1 · Gói 6 tháng đã ngừng bán".
  - AC-6: form không cho bỏ dòng gói; chọn 2 gói → lỗi "Hợp đồng cần đúng 1 gói dịch vụ theo tháng".
  - AC-7: bản in: bảng 7 cột, "Thuế GTGT (KCT)" hoặc "(KCT, 10%)", "Tổng thanh toán … (bằng chữ: …)", không còn "đã gồm VAT".
  - AC-9: `RUNWAY_LOCAL=1 pnpm dev:seed-products` 2 lần → cùng bảng; sửa giá trong `scripts/data/products.demo.json` + `--replace` → giá mới trên màn.
  - AC-10: e2e + 390px: bảng sản phẩm thành thẻ, ngăn/modal toàn màn, không cuộn ngang.
- Attack: ẩn danh mọi endpoint mới → 401; NV ghi → 403 + `permission.denied`; admin đọc/ghi sản phẩm → 403; gửi `unit_price`/`total` trong HĐ → 422; tên `<script>` trong bảng dòng → in thành chữ; đoán id → 404; SQL thẳng sửa/xóa mức đã hiệu lực → trigger chặn.
- Result: [ ]
