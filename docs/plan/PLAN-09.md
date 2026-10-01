# PLAN-09: Nhiều loại tài liệu — Báo giá → Hợp đồng → Đề nghị thanh toán, mỗi loại số riêng (+ Phiếu xuất kho DEMO)

Status: Approved 2026-10-01 (driver chốt theo pattern bạn ủy quyền)
Spec: docs/spec/SPEC-09.md (Approved 2026-10-01; DEC-10 = B, còn lại A) · Intent: docs/intent/INTENT-09.md · Roadmap: ROADMAP-02 row 4
Chạy song song row 5 (SPEC-10, nhập mẫu .docx). Chỗ nối duy nhất: `templates.type` + `CreateTemplateBody.type` (C-09-002 nới). File dùng chung → §4 R-6.
Repo commit thẳng `main`, không remote → `pnpm check:migrations` so `HEAD~1...HEAD` = **từng commit**. "PR riêng" của SPEC = **commit riêng**.

## 0. Đối chiếu SPEC với code hôm nay (đã đọc)
| SPEC chỗ | Code thật | Kết luận PLAN |
|---|---|---|
| §3.2 E1 "PR chỉ migration (+ snapshot meta)" | lint: `apps/api/src/**/*.ts` (trừ test) = code → `db/schema.ts` là code | C-09-001 = **2 commit**: (A) `0024_*.sql` + `meta/` · (B) `schema.ts` một mình. Giữa A và B code cũ chạy y nguyên (cột mới NULL, CHECK rộng hơn) |
| §3.2 số migration "kế tiếp" | journal tới `0023`; row 5 không có migration (SPEC-10 R-1) | `0024_<drizzle>.sql` (E1) · `0025_seed_doc_type_perms.sql` (002) · `0026_seed_doc_type_templates.sql` (005) |
| §3.6 `POST /contracts` "write theo loại của mẫu" | `routes/contracts.routes.ts:384` gate cứng `requirePerm("contract:write")`; `permission.denied` do middleware ghi | route gate = `contract:read`; service tra `templates.type` → `WRITE_PERM[type]`; route ghi `permission.denied {permission, method, path}` rồi 403 (P-3) |
| §3.6 `PATCH` "như cũ" | gate `contract:write` | không nhất quán với DEC-10 B (Kế toán không sửa được DNTT mình lập) → PATCH/DELETE/copy cũng theo loại (P-3) |
| §3.3 tạo con | `issueCas` cứng `TYPE='contract'`, `NUMBER_FORMAT` HD; `snapshot-builder` luôn `resolveLines` (tra giá hôm nay) | dãy theo `contracts.type` của dòng (`SERIES[type]` → `CASE type` trong SQL); con dựng bằng `buildChildSnapshot` thuần, không gọi `resolveLines` |
| §3.6 lỗi "422 `lines`" | 422 hiện có = `validation` + `errors[].path` (PLAN-08 P-2) | P-1 |
| §4 Money-0đ `nothing-to-pay` | không có trong bảng slug §3.6 | slug thứ 9 (P-4) |
| §2 FR-13 HĐ v3 | v2 có `so_bao_gia`/`ngay_bao_gia` `manual` + `{{#if so_bao_gia}}` | v3 = v2, 2 trường đổi nguồn `parent:number`/`parent:doc_date`, `{{#if}}` giữ → HĐ độc lập (DEC-14) in như cũ |
| §3.1 DEC-10 B | catalog 20 mã; `PermissionKeySchema = z.enum(PERMISSIONS)` → client drift | catalog + `0025` + client cùng C-09-002 |
| audit `metadata.type` (FR-14) | 8 chỗ ghi `contract.*`: `approval-dao`, `contract-{write,issue,withdraw,delete}-dao`, `submit/decide/void-service` | C-09-003 (vòng đời) + C-09-006 (`created/updated`, copy) + C-09-007 (`created` con) |

## 1. Acceptance tests — written first, seen failing
Files (viết ở PLAN; `pnpm --filter @runway/api typecheck` → 0 lỗi ở file này (3 lỗi còn lại thuộc `templates-import-acceptance.test.ts` của row 5); eslint → 0; e2e compile sạch với tsconfig tạm gồm `e2e/`, chỉ còn 2 lỗi TS5097 có sẵn của `global-setup.ts`):
- `apps/api/test/integration/doc-types-acceptance.test.ts` — 13 test (AC-1..AC-13, AC-12 phần API). Cột mới chỉ chạm qua SQL thô. Đồng hồ thật trừ AC-2 (ghim 28/09/2026 → 01/01/2027 00:05 VN).
- `apps/web/e2e/doc-types.spec.ts` — 1 spec desktop (AC-12 + đường người dùng AC-4/6/10), hợp đồng UI ở đầu file. Không chạy ở PLAN.

Red run (2026-10-01, sau khi `pgrep -f "vitest run"` trống): `CI=true pnpm --filter @runway/api exec vitest run test/integration/doc-types-acceptance.test.ts`
```
 FAIL  AC-1: E1 shape … → AssertionError: index uq_contracts_parent_child_live: expected [ 'idx_contracts_created_by', …(5) ] to include 'uq_contracts_parent_child_live'
 FAIL  AC-2 … AC-5, AC-7, AC-8, AC-9, AC-12, AC-13 → AssertionError: a template of type quote: expected 0 to be greater than 0
 FAIL  AC-6: DNTT from an issued HĐ … → AssertionError: POST /contracts/01M3VQNT49F05Y6DBM5EHHGR62/children payment_request: expected 404 to be 201
 FAIL  AC-10: PXK (DEMO 02-VT) … → AssertionError: a template of type delivery_note: expected 0 to be greater than 0
 FAIL  AC-11: DEC-10 B … → AssertionError: expected [ 'contract:read', …(2) ] to deeply equal ArrayContaining{…}
 Test Files  1 failed (1)
      Tests  13 failed (13)
   Duration  8.04s (transform 624ms, setup 3.09s, collect 59ms, tests 3.04s, environment 0ms, prepare 277ms)
```
Đúng kỳ vọng (index E1 chưa có · chưa có mẫu theo loại · route `/children` 404 · 3 mã chưa có). Sau red run thêm 2 khối assert (AC-7: sao chép HĐ con bị từ chối → 409 `child-exists` rồi 201 giữ cha; AC-8: sao chép HĐ con của BG quá hạn → 409 `quote-expired`) — đều nằm sau dòng đang đỏ, không chạy lại (ngân sách 1 lần).

| AC | Chứng minh bằng | Card xanh | Đỏ bây giờ? |
|---|---|---|---|
| AC-1 | API `AC-1` (`PRAGMA index_list` đủ 5 index cũ + `uq_contracts_parent_child_live` + `idx_contracts_parent`; cột mới; CHECK `invoice` lỗi, `valid_until` trên HĐ lỗi, `parent_id = id` lỗi; UNIQUE live: draft+pending cùng cha lỗi, rejected không tính) + done-check 001 (đếm dòng trước = sau trên bản sao state local) + driver: suite contracts cũ xanh giữa commit A và B | 001 | [x] đỏ |
| AC-2 | API `AC-2` (BG, HĐ, BG(từ chối), BG, DNTT, PXK → `BG-2026-001`, `HD-2026-001`, `BG-2026-002`, `DNTT-2026-001`, `PXK-2026-001`; 2027 → `BG-2027-001`, `HD-2027-001`) | 003 (+005, 006, 007) | [x] đỏ |
| AC-3 | API `AC-3` (20 phát hành song song BG+HĐ → mỗi dãy `{10,10,1,10}`; 5 song song 1 BG → `[200,409×4]`, số 011) | 003 (+005, 006) | [x] đỏ |
| AC-4 | API `AC-4` (BG G6 −5% 2.565.000, `valid_until` = +15; G6 mức 3.000.000 từ hôm nay (SQL thô) → HĐ con vẫn 2.700.000/2.565.000, `snapshot.parent`, `parent` ref, bản in "Căn cứ báo giá số …"; PATCH `lines`/`giam_gia` → `lines-locked`; PATCH chức vụ → 200 tổng giữ; `/children` gửi `giam_gia` → `lines-locked`; BG chỉ hàng hóa → HĐ 422 `validation` `lines` (DEC-7)) | 004, 006, 007 | [x] đỏ |
| AC-5 | API `AC-5` (HĐ con của BG 15% → bước ["Quản lý duyệt","Giám đốc duyệt"]; người lập BG duyệt HĐ được; người lập HĐ duyệt → 403 + 1 `permission.denied`) | 007 | [x] đỏ |
| AC-6 | API `AC-6` (DNTT: `total` = `amount_requested` = HĐ, `payment_due` = +7, dòng + nhóm thuế y hệt; bản in "Căn cứ hợp đồng số", "0071 0004 58213", "Vietcombank"; phát hành → "NM DNTT-…"; mẫu DNTT qua `POST /contracts` → `parent-required`; HĐ 0đ → `nothing-to-pay`) | 004, 005, 006, 007 | [x] đỏ |
| AC-7 | API `AC-7` (2 người song song → [201,409 `child-exists` + `existing_id`]; cùng key → cùng id, 1 dòng; DNTT lần 2 → 409; con bị từ chối → lập lại 201; sao chép con bị từ chối khi có con sống → 409, xóa con sống → sao chép 201 giữ `parent_id` + `source_contract_id` + tổng) | 006, 007 | [x] đỏ |
| AC-8 | API `AC-8` (cha nháp/đã duyệt → `parent-not-issued`; id lạ 404; DNTT từ BG, BG từ BG, HĐ từ PXK → `child-type`; `invoice` → 422; `valid_until` hôm qua → `quote-expired`, = hôm nay → 201; sao chép con của BG quá hạn → `quote-expired`; phát hành BG quá hạn → `quote-expired`, vẫn `approved`) | 003, 006, 007 | [x] đỏ |
| AC-9 | API `AC-9` (hủy BG có HĐ chờ duyệt → `has-children` + `children[]`; rút + xóa con → hủy 200; cha hủy → `parent-not-issued`; tạo con ‖ hủy cha → đúng 1 thắng, trạng thái nhất quán) | 003, 007 | [x] đỏ |
| AC-10 | API `AC-10` (PXK MIN×2 + GIẤY×5 → `total` 0, 1 bước QL, `PXK-YYYY-001`; bản in 02-VT 15 cụm chữ; G6 → `validation` `lines`; `giam_gia` → `validation` `values.giam_gia`; tên `<b>x</b>` in thành chữ) | 004, 005, 006 | [x] đỏ |
| AC-11 | API `AC-11` (`/me` NV/QL/GĐ có 3 mã, admin không; `catalog` có 3 mã; vai trò Kế toán DEMO chỉ `contract:read/submit` + `payment_request:write` → lập DNTT 201, BG/HĐ 403 + denied `quote:write`, `contract:write`; NV bị bỏ `payment_request:write` → `/children` DNTT 403; ẩn danh 401) | 002, 006, 007 | [x] đỏ |
| AC-12 | API `AC-12` (`parent`, `children`, `can.create_child` với `reason_code` `child-exists`/`quote-expired`/`parent-not-issued`/`[]`; `?type=` danh sách + mẫu; `invoice` 422; `/approvals/mine` có `type`) + e2e `doc-types.spec.ts` (tab loại, drawer liên quan, 🔒 lý do) | 002, 008, 009, 010 | [x] đỏ · e2e chưa chạy (ngân sách 1 lần ở PROOF) |
| AC-13 | API `AC-13` (HĐ con: 1 `contract.created {to, type, parent_id, parent_number}`; chuỗi created→submitted→approved→issued mỗi dòng `type`, issued có `number`; không PII) | 003, 006, 007 | [x] đỏ |

Test đơn vị (red-first trong card): `test/domain/doc-types.test.ts` (`CHILD_OF`, `childRules` thứ tự lý do) — 002 · `test/domain/child-snapshot.test.ts` (đóng băng, DEC-7, DNTT chép nguyên, `nothing-to-pay`, `payment_due` qua năm) + `contract-snapshot` (BG `valid_until`, PXK) + `contract-merge` (bảng 02-VT escape) + `template-check` (nguồn mới) — 004 · web `contracts-logic`, `contract-drawer`, `problem-messages`, `audit-sentence`, `permission-labels`, `nav` — 008/009.

### 1b. Test đang có phải đổi — đúng card gây ra, không sửa cho xanh
| File | Đổi gì | Card |
|---|---|---|
| `api/test/integration/foundation-acceptance.test.ts` | AC-1: GĐ, QL, NV + 3 mã | 002 |
| `api/test/integration/roles-acceptance.test.ts` | `CATALOG` +3; `SEED_GRANTS.giam_doc/quan_ly/nhan_vien` +3 | 002 |
| `api/test/integration/rbac-advanced-acceptance.test.ts` | `toHaveLength(20)` → 23; `SEED_GRANTS` +3 (nếu không, `restoreSeedRoles` tước mã mới) | 002 |
| `api/test/events/contract-events.test.ts` | chỉ nếu nó so khớp `metadata` nguyên văn (thêm `type`) | 003 |
| `api/test/integration/templates-acceptance.test.ts` | `SEED_V` 2 → 3; danh sách mẫu = 4 (BG, HĐ, DNTT, PXK) → lọc theo tên/loại; `POST /templates` vẫn `type:"contract"` | 005 |
| `api/test/integration/template-seed-check.test.ts` | bản hiện hành HĐ = v3 (`so_bao_gia`→`parent:number`); BG/DNTT/PXK v1 qua `checkTemplate` = []; audit `template.created` ×3 + `template.version_created {version_no:3}` actor NULL | 005 |
| `api/test/integration/contracts-acceptance.test.ts` (+ `contracts-4b`, `-delete`, `-withdraw`, `-pdf`) | chỉ nếu gửi `so_bao_gia`/`ngay_bao_gia` mà builder v3 từ chối; số `HD-2026-00n` giữ | 005 |
| `api/test/domain/{contract-snapshot,contract-merge,template-check}.test.ts` | ca mới theo loại, nguồn mới | 004 |
| `web/src/app/nav.test.ts` | "Hợp đồng" → "Tài liệu" | 008 |
| `web/src/features/{roles/permission-labels,audit/audit-sentence}.test.ts` · `lib/problem-messages.test.ts` | +3 mã; câu nhật ký theo loại; 9 slug mới | 008 |
| `web/src/features/contracts/contracts-logic.test.ts` | tab loại, form theo loại (PXK, BG) | 008 |
| `web/src/features/contracts/contract-drawer.test.tsx` | tên drawer theo loại, khối liên quan, nút lập con + 🔒 | 009 |
| `web/e2e/contracts.spec.ts` · `contracts.mobile.spec.ts` · `products.spec.ts` | sidebar "Tài liệu"; "+ Tạo hợp đồng" → "+ Tạo" + menuitem "Hợp đồng" (dialog "Tạo hợp đồng" giữ) | 008 |

## 2. Files that change
| File | New / Modify | Why (FR) | Card |
|---|---|---|---|
| `api/src/db/migrations/0024_*.sql` + `meta/` (commit A) · `api/src/db/schema.ts` (commit B) | N/M | dựng lại `contracts`: CHECK 4 loại, `parent_id`, `valid_until`, UNIQUE live, index cha (FR-1, FR-8, DEC-1/3/4) | 001 |
| `packages/rbac/src/catalog.ts` · `docs/rbac.md` · `migrations/0025_seed_doc_type_perms.sql` + meta | M/N | 3 mã + grant NV/QL/GĐ (FR-14, DEC-10) | 002 |
| `api/src/domain/contract/doc-types.ts` | N | `DOC_TYPES`, `CHILD_OF`, `WRITE_PERM`, `childRules()` thuần (FR-1, FR-4, FR-10) | 002 |
| `api/src/dto/{contracts,templates,error}.ts` · `routes/contract-children.routes.ts` (501) · `routes/index.ts` · `packages/client/src/generated/*` | M/N | hợp đồng §2b trước handler | 002 |
| `api/src/dao/contract-read-dao.ts` · `services/contract/read-service.ts` · `dao/approval-dao.ts` (chỉ hàm đọc hàng đợi) · `routes/contracts.routes.ts` (list query) · `routes/approvals.routes.ts` · `dao/template-dao.ts` + `services/template-read-service.ts` (`?type`) | M | đọc: `type`, `valid_until`, `parent`, `children`, `can.create_child`, lọc (FR-10, FR-13) | 002 |
| `web/src/features/contracts/doc-type-labels.ts` | N | nhãn loại dùng chung 008/009 (FR-10) | 002 |
| `api/src/domain/contract/number.ts` · `dao/contract-issue-dao.ts` · `services/contract/{issue,void,submit,decide}-service.ts` · `dao/{approval,contract-withdraw,contract-delete}-dao.ts` (audit) · `routes/contracts.routes.ts` (issue/void slug) | M | dãy theo loại, BG hạn, cha còn issued, `has-children`, audit `type` (FR-2, FR-3, FR-9, FR-11, FR-14) | 003 |
| `api/src/domain/contract/{types,snapshot,child-snapshot,render,merge,goods-table}.ts` · `domain/template-sources.ts` · `domain/template-check.ts` | M/N | snapshot theo loại, con đóng băng, bảng 02-VT, nguồn mới (FR-4..7, FR-11, FR-12) | 004 |
| `migrations/0026_seed_doc_type_templates.sql` + meta | N | mẫu BG v1, DNTT v1, PXK v1 (DEMO), HĐ v3 (FR-13, DEC-9) | 005 |
| `api/src/services/contract/{create-service,update-service,copy-service,delete-service,snapshot-builder,types}.ts` · `dao/contract-write-dao.ts` · `routes/contracts.routes.ts` (gate + slug) | M | tạo theo loại + DEC-10, khóa dòng, PXK, `parent-required`, sao chép con (FR-1, FR-7, FR-12, FR-13, FR-14) | 006 |
| `api/src/services/contract/children-service.ts` · `dao/contract-children-dao.ts` · `routes/contract-children.routes.ts` | N/M | `POST /contracts/{id}/children` CAS + audit (FR-4..8) | 007 |
| `web/src/features/contracts/{contracts-screen,contract-form-modal,line-items,values,list-params,api}.ts(x)` · `app/nav.ts` · `lib/problem-messages.ts` · `features/audit/audit-sentence.ts` · `features/roles/permission-labels.ts` (+ test) · `web/e2e/{contracts,contracts.mobile,products}.spec.ts` | M | tab loại, "+ Tạo" theo loại, form PXK/BG, nhãn (FR-10, FR-12) | 008 |
| `web/src/features/contracts/{contract-drawer,lock-reasons,flow,snapshot,paper-overlay}.ts(x)` · `children-api.ts` (N) · `related-docs.tsx` (N) · `child-form-modal.tsx` (N) · `features/templates/templates-screen.tsx` (1 nhãn) | M/N | drawer liên quan, lập con + 🔒 (FR-10) | 009 |
| `web/e2e/shots/*` · `docs/plan/PLAN-09.md` · `docs/roadmap/ROADMAP-02.md` | M | PROOF | 010 |

### 2b. API contract (C-09-002 khóa; card sau cần đổi → dừng, báo driver)
- `DocType = quote | contract | payment_request | delivery_note`; `SERIES = {contract: HD, quote: BG, payment_request: DNTT, delivery_note: PXK}`, pad 3; `CHILD_OF = {quote: [contract], contract: [payment_request], payment_request: [], delivery_note: []}`; `WRITE_PERM = {quote: quote:write, contract: contract:write, payment_request: payment_request:write, delivery_note: delivery_note:write}`.
- `Ref = {id, type, number|null, status, total, doc_date}`. `ContractDto` + `type: DocType`, `valid_until: string|null`, `parent: Ref|null`, `children: Ref[]` (cũ → mới), `can.create_child: {type, allowed, reason_code: "parent-not-issued"|"quote-expired"|"child-exists"|"forbidden"|null}[]` (một mục mỗi loại con trong `CHILD_OF[type]`; `[]` cho DNTT/PXK; thứ tự lý do: parent-not-issued → quote-expired → child-exists → forbidden).
- `ContractListQuery` + `type?: DocType` (lạ → 422); `ContractListItem` + `type`, `parent_id`, `valid_until`; `counts` theo bộ lọc `type`. `ApprovalQueueItem` + `type`. `TemplateListQuery` + `type?: DocType` (lạ → 422). `CreateTemplateBody.type: DocType` (bắt buộc). `FIELD_TYPES` + `goods` (bảng 02-VT).
- `ContractValues` + `ly_do_xuat_kho?`, `xuat_tai_kho?`, `dia_diem?` (string trim ≤ 200); giữ các khóa cũ.
- `POST /contracts/{id}/children` (route gate `requireAuth` + `requirePerm("contract:read")` + `withIdempotency()`) body `{type: DocType, template_id?: Ulid, values?: ContractValues}.strict()` → 201 `ContractDto`. Thứ tự lỗi (P-10): 422 schema → 404 → 422 `child-type` → 403 (`WRITE_PERM[type]`, denied) → 422 `lines-locked` (values có `giam_gia`) → 422 `template-type` → 409 `parent-not-issued` → 409 `quote-expired` → 422 `nothing-to-pay` → 422 `validation` `lines` (DEC-7) → 422 `missing-fields` → 409 `child-exists` (+`existing_id`, bắt UNIQUE live). `template_id` bỏ trống → mẫu seed của loại con (`created_at`, `id` nhỏ nhất) (P-5).
- `POST /contracts/{id}/void` 409 `has-children` + `children: Ref[]` (con sống). `POST /contracts/{id}/issue` + 409 `quote-expired`, 409 `parent-not-issued`. `PATCH` + 422 `lines-locked`. `POST /contracts` + 422 `parent-required`, 422 `template-type` (mẫu `active=0`/không tồn tại giữ lỗi cũ). `/copy` + 409 `child-exists`, 409 `quote-expired`.
- Slug mới (`dto/error.ts`): `parent-not-issued`, `child-exists`, `quote-expired`, `child-type`, `lines-locked`, `has-children`, `parent-required`, `template-type`, `nothing-to-pay`.
- Snapshot (P-8): chung + `type`, `parent {id,type,number,doc_date,total}|null`; BG `dates.valid_until` (= `doc_date` + 15), `creator_name`; DNTT `amount_requested` (= cha `total`), `dates.payment_due` (= `doc_date` + 7), dòng + nhóm thuế + tổng chép nguyên; PXK dòng hàng hóa `{product_id, code, name, unit, qty}` + tiền 0, `discount_bps` 0, không `total_words`. Con: `inputs.frozen_from = parent_id`.
- Nguồn trường mới (`template-sources.ts`): `parent:number`, `parent:doc_date`, `derived:valid_until`, `derived:payment_due`, `derived:amount_requested`, `derived:amount_requested_in_words`, `creator:name`, `derived:goods_table` (kiểu `goods`, kênh HTML tin cậy như `lines`; `template-check`: `goods` ⇔ `derived:goods_table`).
- CAS: tạo con = 1 `db.batch`: `INSERT … SELECT … WHERE EXISTS (cha status='issued' AND type IN CHILD_OF⁻¹ [AND valid_until >= :today])` + audit `INSERT…SELECT WHERE changes()=1`; `:today` = `todayInVN(now)` từ JS (P-6). Issue: `seq` = `MAX(seq)+1 WHERE type = contracts.type AND series_year`, `number = printf(CASE type …)`; điều kiện thêm `(type <> 'quote' OR valid_until >= :today)` và `(parent_id IS NULL OR EXISTS cha issued)`. Void: thêm `NOT EXISTS (con sống)`. 0 dòng → đọc lại chẩn đoán.
- Audit: mọi `contract.*` thêm `metadata.type`; `contract.created` của con = `{to:"draft", type, parent_id, parent_number}`; không PII.

## 3. Cards — một việc nhỏ mỗi card (docs/plan/cards/C-09-NNN.md)
Thứ tự + nhóm song song (touches rời nhau trong cùng nhóm; driver chạy vitest tập trung, API suite và e2e không cùng lúc):
- **G0** — 1. **[C-09-001]** E1 dựng lại `contracts` (commit A migration-only, commit B `schema.ts`) → AC-1, FR-1, FR-8 · depends: —
- **G1** — 2. **[C-09-002]** hợp đồng OpenAPI + 3 mã quyền + slug + phía đọc + client → AC-11, AC-12, FR-10, FR-13, FR-14 · depends: 001
- **G2** (song song: 003 ∥ 004 ∥ 005 ∥ 008 ∥ 009)
  3. **[C-09-003]** dãy số theo loại + CAS phát hành/hủy + audit `type` vòng đời → AC-2, AC-3, AC-8, AC-9, AC-13, FR-2, FR-3, FR-9, FR-11 · depends: 002
  4. **[C-09-004]** domain thuần: snapshot theo loại, con đóng băng, bảng 02-VT, nguồn mới → AC-4, AC-6, AC-10, FR-4..FR-7, FR-11, FR-12 · depends: 002
  5. **[C-09-005]** migration mẫu BG/DNTT/PXK v1 + HĐ v3 → AC-6, AC-10, FR-13 · depends: 002 (viết song song; **commit sau 004** vì `checkTemplate` cần nguồn mới)
  8. **[C-09-008]** web: tab loại, "+ Tạo" theo loại, form BG/PXK, nhãn + câu lỗi + câu nhật ký → AC-12, FR-10, FR-12 · depends: 002
  9. **[C-09-009]** web: drawer "Tài liệu liên quan", lập con + 🔒, bản in theo loại → AC-12, FR-10 · depends: 002
- **G3** (song song: 006 ∥ 007)
  6. **[C-09-006]** ghi: tạo theo loại + DEC-10, khóa dòng, PXK, `parent-required`, sao chép con → AC-4, AC-6, AC-7, AC-10, AC-11, AC-13, FR-1, FR-7, FR-12, FR-14 · depends: 003, 004, 005
  7. **[C-09-007]** `POST /contracts/{id}/children` → AC-4..AC-9, AC-11, AC-13, FR-4..FR-8 · depends: 003, 004, 005
- **G4** — 10. **[C-09-010]** e2e một lần + PROOF → AC-1..AC-13 · depends: 001–009

Điều phối: `routes/contracts.routes.ts` — 002 (list/detail) → 003 (issue/void) → 006 (gate, create/patch/copy) tuần tự. `contract-children.routes.ts` chỉ 002 (501) → 007. Chỉ 002 sinh `packages/client`; card sau thấy cần đổi OpenAPI → dừng. `meta/_journal.json`: 001 → 002 → 005. `snapshot.ts`/`template-*.ts` chỉ 004; 006/007 chỉ import. `contract-write-dao.ts` chỉ 006; 007 có DAO riêng. `lib/problem-messages.ts` chỉ 008 (cả câu cho slug drawer 009 dùng). `doc-type-labels.ts` chỉ 002. 009 mở form lập con từ trong drawer — nếu buộc phải nối ở `contracts-screen.tsx` (008) thì dừng, báo driver (009 chạy sau 008).

## 4. Risks
- R-1 (SPEC R-1) E1 dựng lại bảng: drizzle-kit sinh `__new_contracts` + `INSERT…SELECT` + `DROP` + `RENAME` + tạo lại index — đọc SQL, đủ 5 index cũ + 2 mới, partial `WHERE` giữ nguyên. `PRAGMA foreign_keys=OFF/ON` drizzle sinh ra là no-op trong transaction của D1 — vô hại vì không bảng nào FK tới `contracts`, không trigger. Chạy trước trên bản sao: `cp -R apps/api/.wrangler/state /tmp/state-e1-<giờ>`, đếm `SELECT COUNT(*), type FROM contracts` trước/sau bằng nhau.
- R-2 Kỷ luật commit E1: commit A chỉ `migrations/**` (lint `HEAD~1` → "0 code file(s)"); commit B chỉ `schema.ts`. Không gộp. Driver chạy suite contracts trên commit A (code cũ + bảng mới) — AC-1 "code cũ chạy y nguyên".
- R-3 (SPEC R-2) Chỗ cứng `contract`/`HD`: `issueCas` (`TYPE`, `NUMBER_FORMAT`), `copy-service`, `snapshot-builder` (`resolveLines`) → sửa tập trung ở 003/006; `HD-2026-00n` trong suite cũ phải giữ.
- R-4 Gate DEC-10: chuyển `POST /contracts` sang `contract:read` + kiểm loại trong service là cửa sổ hở nếu chỉ làm một nửa → route + service cùng commit ở 006; AC-11 bắt. `permission.denied` ghi ở route (route sở hữu `c`), service trả `{kind:"forbidden", permission}`.
- R-5 Đồng hồ: trigger `product_prices` dùng giờ SQLite thật; AC-4 chèn mức "từ hôm nay" thật (không ghim); hạn BG/CAS dùng `todayInVN` JS (ghim được, P-6). AC-2 ghim ngày → relogin sau khi nhảy năm.
- R-6 **File chung với row 5 (SPEC-10)** — driver xếp thứ tự, ai sau thì rebase:
  | File | Row 4 | Row 5 | Thứ tự đề xuất |
  |---|---|---|---|
  | `dto/templates.ts` (`CreateTemplateBody.type`, `TemplateListQuery`) | 002 nới enum + `?type` | C-10-005 chỉ đọc danh sách loại | 002 trước C-10-005 |
  | `dto/error.ts` · `routes/index.ts` · `packages/client` + `dist/openapi.json` | 002 (9 slug, route con) | C-10-001 (`DocxInvalid`, route import) | ai sau rebase + `openapi:export && client:generate` |
  | `domain/template-check.ts` | 004 (`goods` ⇔ `derived:goods_table`) | C-10-002 export `fold`/`INTERNAL_NOTE_PHRASES` | khác hàm, merge tay; chạy `test/domain/template-check` sau cả hai |
  | `domain/template-sources.ts` | 004 thêm 8 nguồn | C-10-003 đọc (gợi ý) | 004 trước C-10-003 nếu muốn gợi ý có nguồn mới |
  | `dao/template-dao.ts` · `services/template-read-service.ts` | 002 (`?type`) | C-10-003 đọc gợi ý qua `template-dao` | 002 trước C-10-003 |
  | migration `0026` (mẫu BG/DNTT/PXK + HĐ v3) | 005 | `templates-import-acceptance.test.ts` ghim `SEED_V = 2` + gợi ý "mẫu mới nhất thắng" | **005 làm đỏ test row 5** → khi 005 vào, row 5 đổi `SEED_V` = 3 + kỳ vọng gợi ý (báo driver row 5) |
  | `web/src/lib/problem-messages.ts` | 008 | C-10-004 | ai sau rebase |
  | `web/src/features/templates/templates-screen.tsx` | 009 (nút "Tạo <loại> từ mẫu này →" + pill loại) | C-10-004 (nút "Nhập từ Word") | khác chỗ; ai sau rebase |
  Row 4 KHÔNG chạm: `dto/template-import.ts`, `routes/template-import.routes.ts`, `services/template-import-service.ts`, `domain/docx/**`, `web/src/features/templates/import/**`, `test/fixtures/docx/**`.
- R-7 Danh sách mẫu thành 4 → form tạo web chọn mẫu theo loại (008); `templates-acceptance` (005) và e2e chọn mẫu theo tên/loại.
- R-8 (SPEC R-4) Facts thiếu → DEMO: kho xuất/ngăn lô/địa điểm, "Bộ phận", TT 99 hay 133 (DEC-13 TODO hỏi), BG box ghi "đã gồm VAT" (BG v1 dùng khối tiền SPEC-08). Nhãn 02-VT: TODO(build) đối chiếu Phụ lục I TT 99.
- R-9 (SPEC R-5) Wipe local sau 006/007: `mv apps/api/.wrangler/state /tmp/state-$(date +%H%M%S)` → `pnpm db:migrate:local` → `RUNWAY_LOCAL=1 pnpm dev:seed-team` → `RUNWAY_LOCAL=1 pnpm dev:seed-products`.
- R-10 Phiên đang mở chỉ thấy 3 mã mới sau khi cache principal (60 s) hết — local, chấp nhận.
- R-11 e2e: thứ tự file chữ cái → `doc-types.spec` chạy sau `contracts*.spec`, trước `products.spec`; để lại 1 BG/HĐ/DNTT/PXK đã phát hành của "Cửa hàng Seed" — `products.spec` không đếm tài liệu; `contracts.mobile` đã `.first()`.
- **Lỗi/thiếu của SPEC (driver chốt theo pattern):**
  - P-1 "422 `lines`" → `validation` + `errors[{path:"lines"}]` (BG→HĐ sai luật HĐ, PXK có dịch vụ); `giam_gia` trên PXK → `validation` `values.giam_gia`.
  - P-2 body `/children` `type` = enum 4 loại; cặp sai (kể cả BG từ HĐ) → 422 `child-type`, loại lạ → 422 `validation`.
  - P-3 DEC-10 B áp cả PATCH/DELETE/copy (theo loại của tài liệu) và `/children` (theo loại con); SPEC ghi PATCH "như cũ" — sửa cho nhất quán.
  - P-4 `nothing-to-pay` (§4 Money-0đ "now") thêm vào bảng slug.
  - P-5 `template_id` bỏ trống trên `/children` → mẫu seed của loại con; mẫu khác loại → `template-type`.
  - P-6 Hạn BG so với `todayInVN` của JS (bind vào CAS), không `date('now')` SQLite.
  - P-7 PXK: khóa `values` mới `ly_do_xuat_kho` (bắt buộc), `xuat_tai_kho`, `dia_diem`; không cần giá (không `no-price`), `total` 0.
  - P-8 Hình snapshot con/BG/DNTT/PXK như §2b.
  - P-9 `can.create_child.reason_code` thêm `forbidden` (thiếu quyền lập loại con) + thứ tự lý do §2b.
  - P-10 Thứ tự lỗi `/children` như §2b.
  - P-11 Web: sidebar "Tài liệu" (route giữ `/hop-dong`), "+ Tạo" → menu loại, tên drawer/bản in theo loại ("Chi tiết hợp đồng"/"Văn bản hợp đồng" giữ nguyên cho HĐ).
- ENGINEERING.md: không xung đột (route giữ `c`, service không thấy `c`; DAO thuần; CAS `INSERT…SELECT WHERE EXISTS` + UNIQUE partial + `db.batch`, không check-then-write; Problem+JSON; ghi cần Origin + `X-Requested-With`; không binding mới, `run_worker_first` đã có `/contracts/*`). Expand-only: E1 là rebuild (có `DROP TABLE`) → commit riêng (R-2); không bước contract trong row này.

## 5. Trace check (trước STOP)
- [x] mọi FR có AC: FR-1→AC-1, AC-2, AC-12 · FR-2→AC-2, AC-3 · FR-3→AC-5, AC-13 (+ suite cũ) · FR-4→AC-4, AC-8 · FR-5→AC-4 · FR-6→AC-6 · FR-7→AC-4, AC-7 (sao chép con) · FR-8→AC-1, AC-7 · FR-9→AC-9 · FR-10→AC-12 + e2e · FR-11→AC-4, AC-8 · FR-12→AC-10 · FR-13→AC-6 (`parent-required`), AC-12 (`?type`), `template-seed-check` (005) · FR-14→AC-11, AC-13
- [x] mọi AC có dòng §1 · mọi AC có card (`serves`) · DEC-1→AC-1 · DEC-2→AC-2 · DEC-3→AC-4, AC-7 · DEC-4→AC-1, AC-7 · DEC-5→AC-8 · DEC-6→AC-4 · DEC-7→AC-4 · DEC-8→AC-6 · DEC-9→AC-5, AC-10 (1 bước) · DEC-10→AC-11 · DEC-11→AC-9 · DEC-12/13→AC-10 · DEC-14→suite HĐ độc lập (`contracts-acceptance`)
- [x] edge "now" có AC: Input AC-6, AC-8, AC-10, AC-4 (lines-locked) · Duplicates AC-7 · Two people AC-3, AC-7, AC-9 · Failure AC-7 (replay, thua không dòng) · Permissions AC-5, AC-11 · Lifecycle AC-9 · Money BG hết hạn AC-8 · đóng băng AC-4, AC-6 · 0đ AC-6 (P-4) · cha hủy AC-9 · Time AC-2 (năm mới), AC-8 (hết ngày), AC-6 (+7) · Q-6 AC-7
- [x] red run API (2026-10-01, 13/13 đỏ đúng lý do) · [x] driver chốt P-1..P-11 + PLAN

## 6. PROOF log (step 5) — điền ở C-09-010
- Checks: `pnpm lint && pnpm typecheck && pnpm build` → [ ] · `pnpm check:migrations` trên commit E1 → [ ] · `pnpm openapi:export && pnpm client:generate && git diff --exit-code packages/client` → [ ] · `CI=true pnpm test` → [ ] · TUẦN TỰ sau đó `bash docs/cookbook/e2e-kit/free-ports.sh 8791` rồi `PROOF_SHOTS=1 CI=true pnpm --filter @runway/web e2e` (một lần) → [ ]
- `/docs`: `POST /contracts/{id}/children`, `GET /contracts?type=`, `GET /templates?type=` thử thật → [ ]
- Human checklist (làm → phải thấy):
  - AC-2: NV lập + QL phát hành BG, HĐ, DNTT, PXK → số `BG-…-001`, `HD-…-00n`, `DNTT-…-001`, `PXK-…-001`, mỗi loại dãy riêng.
  - AC-4: BG G6 −5% → "Lập hợp đồng" → dòng 🔒 "Giữ giá báo giá BG-…", tổng 2.565.000, bản in "Căn cứ báo giá số BG-…"; không có ô "Giảm giá (%)".
  - AC-5: BG giảm 15% → HĐ con vẫn có bước "Giám đốc duyệt".
  - AC-6: HĐ phát hành → "Lập đề nghị thanh toán" → số tiền = tổng HĐ, hạn = hôm nay + 7; bản in có 0071 0004 58213 · Vietcombank · "NM DNTT-…".
  - AC-7: bấm "Lập hợp đồng" lần 2 → 🔒 "Đã có hợp đồng … (Nháp)".
  - AC-8: BG quá hạn (SQL `UPDATE contracts SET valid_until=…`) → 🔒 "Báo giá đã hết hạn ngày …", nhãn "Hết hạn".
  - AC-9: hủy BG có HĐ chờ duyệt → lỗi nêu HĐ con.
  - AC-10: "+ Tạo" → "Phiếu xuất kho": chỉ hàng hóa, không giảm giá; bản in 02-VT, cột đơn giá trống, nhãn DEMO.
  - AC-12: tab "Báo giá" chỉ BG; drawer HĐ có "Tài liệu liên quan" ↑ BG ↓ DNTT; 390 px: tab cuộn được, không cuộn ngang.
- Attack: ẩn danh `/children` → 401 · Kế toán DEMO lập BG → 403 + `permission.denied` · đoán id cha → 404 · gửi `lines`/`giam_gia`/`total` khi sửa con → 422 · tên `<script>` trong bảng 02-VT → in thành chữ · lập con từ HĐ đã hủy → 409.
- Result: [ ]
