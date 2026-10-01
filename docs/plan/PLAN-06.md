# PLAN-06: Quản lý vai trò — sửa quyền, thêm vai trò, clone vai trò

Status: Approved 2026-10-01 (driver chốt — bạn ủy quyền)
Spec: docs/spec/SPEC-06.md (Approved 2026-10-01; §0 bổ sung: FR-12, FR-13, `member` không gán được, AC-9, AC-10)
Roadmap row: ROADMAP-02 row 2. Phụ thuộc ngoài: **FIX-03** (DEC-5: `self_role`/`admin_only`) phải commit trước C-06-001 (001 sửa `fix-03-role-escalation.test.ts` + `foundation-acceptance.test.ts` sang helper dọn nhật ký) —
FIX-03 sở hữu `user-admin-service.ts`, `admin-users.routes.ts`, `users-screen.tsx`, `role-locks.ts`, `problem-messages.ts`,
`foundation-acceptance.test.ts` (SPEC-01 AC-4 → `self_role`, SPEC R-3). PLAN-06 không làm lại phần đó.

## 1.
Red run (driver, 2026-10-01): `roles-acceptance.test.ts` → `Tests 11 failed (11)` — POST /roles 404, PATCH/DELETE 405, catalog thiếu `roles:write`, AC-10 `UPDATE audit_events` không bị chặn (đúng lý do: chưa có code).
 Acceptance tests — written first, seen failing
Files (viết trước; `pnpm --filter @runway/api typecheck` + eslint file → 0 lỗi; e2e compile sạch với tsconfig tạm gồm `e2e/`):
- `apps/api/test/integration/roles-acceptance.test.ts` — 11 test API, gọi đúng SPEC-06 §3.2 + §0. Cột mới chỉ chạm qua SQL thô
  (reset trong try/catch; test `role-limit` chèn thẳng 50 vai trò). `restoreSeedRoles()` trả `quan_ly`/`giam_doc`/`nhan_vien`
  về grant seed + xóa vai trò `r_…` trước VÀ sau mỗi test (test sửa vai trò hệ thống). Dọn nhật ký bằng `clearAuditEvents()` cục bộ
  (đọc trigger của `audit_events` từ `sqlite_master` → DROP → DELETE → tạo lại đúng SQL đó; hôm nay 0 trigger = DELETE thường) —
  C-06-001 chuyển nó vào `@runway/test-fixtures` và thay bản cục bộ bằng import.
- `apps/web/e2e/roles.spec.ts` — 1 spec desktop (ngân sách SPEC-06 §7), khóa hợp đồng UI ở đầu file (nhãn + testid). Không chạy ở PLAN.
  Đổi tài khoản Nhân viên dùng chung sang "Kế toán" rồi **trả lại `nhan_vien` cuối spec** (`shell.smoke.spec.ts` chạy sau).

Red run: driver chạy tập trung `CI=true pnpm --filter @runway/api exec vitest run test/integration/roles-acceptance.test.ts` → [ ] (điền output thật).

| AC | Chứng minh bằng | Đỏ bây giờ? |
|---|---|---|
| AC-1 | API `AC-1` (`/me` 4 vai trò · `catalog` 16 mã · 5 vai trò hệ thống `label` Việt, `is_system`, `version` 1, `holders` · `can`/`locked_reason` theo người gọi · Nhân viên mọi `can=false`) + e2e: ma trận có hàng `roles:write` (catalog đầy đủ) | [ ] chờ red run (`roles:write` chưa có) |
| AC-2 | API `AC-2` (PATCH bỏ `contract:issue` → 200, `version`+1; cùng phiên Quản lý → 403 ngay lần kế sau khi cache KV đã ấm; `/me` mất quyền; 1 dòng `role.permissions_changed {added:[],removed:[…]}`) | [ ] (route chưa có) |
| AC-3 | API `AC-3` (2 PATCH song song → `[200,409 stale]`, tập của bên thắng, 1 audit; stale tuần tự; 404 id lạ) | [ ] |
| AC-4 | API `AC-4` (201 `name` `r_<ulid thường>`, Idempotency-Key replay cùng id, 1 `role.created`; `" kế  toán "` 409 `duplicate`; 422: mã lạ, mã lặp, label rỗng/61 ký tự, `name`, `is_system`) + `AC-4 / §3.1` (50 vai trò tự tạo → 409 `role-limit`) | [ ] |
| AC-5 | API `AC-5` (`own_role` · `grant_not_held` + `permissions` (GĐ và admin) · bỏ quyền mình không có = 200 · admin bỏ `users:write` khỏi `giam_doc` = 200 · `admin_role` cho cả admin · `system_role` · Nhân viên 403 · đếm `permission.denied` theo actor sau mỗi 403 · PATCH `name` 422 · 401 ẩn danh) | [ ] |
| AC-6 | API `AC-6` (2 người mang → 409 `role-in-use` `holders:2`; đổi họ sang `nhan_vien` → 204, mất khỏi list, `role_permissions` sạch, `role.deleted {name,label}`; stale; 404 lần 2) + `AC-6 race` (DELETE ∥ mời vào vai trò → `[409,201]` hoặc `[204,422 unknown-role]`, 0 user không vai trò) + e2e "Còn 1 người…" | [ ] |
| AC-7 | API `AC-7 (custom-role part)` (mời `r_…` 201 · `khong_co` 422 `unknown-role`, không tạo user · PATCH `r_…` 200 + `/me` theo vai trò mới · PATCH `khong_co` 422 · admin mời/PATCH `member` → 422 `unknown-role` (§0, admin để FR-12 không chen vào)). Phần `self_role`/`admin_only` = `fix-03-role-escalation.test.ts` (FIX-03) | [ ] |
| AC-9 | API `AC-9 / FR-12` (admin tạo "Kỹ thuật" `settings:write`; GĐ mời vào → 403 `grant_not_held` `permissions:["settings:write"]`, không tạo user · GĐ chuyển Nhân viên vào → 403, vai trò giữ · admin chuyển → 200 · GĐ chuyển ra lại `nhan_vien` → 403 (thu hồi tương ứng) · đếm `permission.denied` 1/2/3 · admin mời → 201) | [ ] |
| AC-10 | API `AC-10 / FR-13` (`UPDATE`/`DELETE audit_events` qua D1 → lỗi, số dòng giữ; helper dọn vẫn xóa được và để lại ≥ 2 trigger) | [ ] (chưa có trigger → UPDATE chạy được) |
| AC-8 | e2e `roles.spec.ts` (GĐ: ngăn Quản lý, "Lưu (−1 quyền)", 🔒 "Bạn đang mang vai trò này"; Nhân viên chỉ xem; clone → Kế toán → gán → phiên Nhân viên tải lại không mất đăng nhập, không còn "+ Tạo hợp đồng"; xóa bị chặn; Nhật ký) + human 390px (ngăn toàn màn) | e2e chưa chạy (ngân sách: 1 lần ở PROOF) |
Test đơn vị web (red-first trong card, module đích cố định): `permission-labels.test.ts` (nhóm 3 mục, nhãn `roles:write`), `role-diff.test.ts`
(`roleDiffLabel(old,new)` → "Lưu (+2 quyền · −1 quyền)"), `audit-sentence.test.ts` (`role.*`), `problem-messages.test.ts` (slug + rule mới) — C-06-005.

## 2. Files that change
| File | New / Modify | Why (FR) | Card |
|---|---|---|---|
| `apps/api/src/db/schema.ts` · `migrations/0016_*.sql` (drizzle) · `migrations/0017_seed_roles_write.sql` · `migrations/meta/*` | M/N | cột `label/label_key/is_system/version/created_at/updated_at`, backfill 5 vai trò hệ thống, `roles:write` → admin + giam_doc (FR-1) | 001 |
| `apps/api/src/db/migrations/0018_audit_events_append_only.sql` · `docs/audit.md` | N/M | trigger `BEFORE UPDATE`/`BEFORE DELETE` → `RAISE(ABORT)` (mẫu 0012) (FR-13) | 001 |
| `packages/test-fixtures/src/audit.ts` (+ `index.ts`) · 9 file test dọn `audit_events` (xem card) | N/M | helper `clearAuditEvents(db, where?)` dùng chung (FR-13) | 001 |
| `packages/rbac/src/catalog.ts` · `docs/rbac.md` | M | `roles:write` (FR-1, FR-6); mục "Role admin" (FR-5, FR-7) | 001 |
| `apps/api/src/dto/roles.ts` | N | `Role`, `RolesResponse{items,catalog}`, `CreateRoleBody`/`PatchRoleBody` `.strict()`, `DeleteRoleQuery` | 002 |
| `apps/api/src/dto/users.ts` | M | `role: string` (mời + PATCH); `RoleItem`/`RolesResponse` chuyển sang `dto/roles.ts` | 002 |
| `apps/api/src/dto/error.ts` | M | slug `role-in-use`, `role-limit`, `unknown-role`; mở rộng Problem `permissions?: string[]`, `holders?: number` | 002 |
| `apps/api/src/routes/roles.routes.ts` | M | định nghĩa 4 route (POST/PATCH/DELETE → 501 `not-implemented` ở 002; handler thật ở 003) | 002, 003 |
| `apps/api/src/routes/admin-users.routes.ts` | M | 002: chặn tạm tên ngoài 4 vai trò cũ → 422 `unknown-role` (không user mồ côi giữa hai card); 004: bỏ chặn tạm, map kết quả service | 002, 004 |
| `apps/api/wrangler.toml` | M | `run_worker_first` + `"/roles/*"` ở cả 3 block (thiếu trong SPEC — xem §4 R-2) | 002 |
| `apps/api/dist/openapi.json` · `packages/client/src/generated/*` | M | `pnpm openapi:export && pnpm client:generate` | 002 |
| `apps/api/src/services/role-admin-service.ts` · `dao/role-write-dao.ts` | N | tạo/sửa/xóa vai trò, guard, CAS + `db.batch`, audit, xóa cache người mang (FR-2..5, FR-7, FR-8) | 003 |
| `apps/api/src/dao/role-dao.ts` | M | list: `label,is_system,version,holders` + `listPermissionKeysForUser`-kiểu đọc D1 của actor | 003 |
| `apps/api/src/domain/role-label.ts` (+test) | N | `normalizeLabel` cho `label_key` (khớp backfill 001) | 003 |
| `apps/api/src/dao/session-cache.ts` · `docs/auth.md` | M | TTL 300 → 60s (DEC-4), sửa phép tính max-time-to-revoke | 003 |
| `apps/api/test/integration/role-write-dao.test.ts` | N | guard `grant_not_held` trong WHERE (race) | 003 |
| `apps/api/src/services/user-admin-service.ts` · `dao/user-dao.ts` (`insertInvitedUserStmt` có điều kiện) | M | vai trò = tên có thật (trừ `member`), 422 `unknown-role`, không user mồ côi (FR-9); gán/gỡ cần quyền người gọi ⊇ quyền vai trò mới + cũ, admin miễn → 403 `grant_not_held` + denied (FR-12) | 004 |
| `apps/web/src/app/roles-query.ts` | N | `useRoles()` (GET /roles, key `["roles"]`) + `roleLabelOf()` dùng chung | 005 |
| `apps/web/src/features/roles/**` | M/N | ma trận cả catalog, ngăn 560px, thêm/clone, Lưu/Xóa, 🔒 lý do (FR-11, DEC-3, DEC-6) | 005 |
| `apps/web/src/features/audit/audit-sentence.ts` (+test) · `src/lib/problem-messages.ts` (+test) | M | câu `role.*`; câu cho `role-in-use`, `role-limit`, `unknown-role`, rule `own_role`/`admin_role`/`system_role`/`grant_not_held` (cả khi gán người, FR-12) | 005 |
| `apps/web/src/features/users/**` · `src/app/me.tsx` · `src/app/layout.tsx` | M | select vai trò từ GET /roles, nhãn từ `label` (FR-9); vai trò có quyền người gọi không có → 🔒 lý do trong select (FR-12, gợi ý — API quyết) | 006 |
| `apps/web/e2e/roles.spec.ts` (viết ở PLAN) · `e2e/shots/` · `docs/roadmap/ROADMAP-02.md` · `docs/plan/PLAN-06.md` | M | PROOF | 007 |

## 3. Cards — một việc nhỏ mỗi card (docs/plan/cards/C-06-NNN.md)
Thứ tự: [FIX-03 commit] → 001 → 002 → (003 ∥ 004) → 005 → 006 → 007.
1. **[C-06-001]** dữ liệu + catalog + nhật ký bất biến (migration expand + seed + `roles:write` + trigger `audit_events` + helper `clearAuditEvents` và 9 file test chuyển sang) → AC-1, AC-10, FR-1, FR-13 · sau FIX-03. **Không song song** với card/agent nào chạm các file test trong `touches` của nó
2. **[C-06-002]** hợp đồng OpenAPI: DTO, route định nghĩa (501), slug, `role: string` + chặn tạm, `run_worker_first`, client → nền AC-1..AC-7 · sau 001, FIX-03
3. **[C-06-003]** API vai trò: GET mới + POST/PATCH/DELETE + guard + audit + xóa cache + TTL 60s → AC-1..AC-6 · sau 002
4. **[C-06-004]** API người dùng: tên vai trò có thật, `member`/lạ → `unknown-role`, mời không mồ côi, FR-12 gán/gỡ ⊇ quyền → AC-7, AC-9, AC-6 race · sau 002 (∥ 003: file rời nhau)
5. **[C-06-005]** web Phân quyền + `useRoles` + câu nhật ký + câu lỗi → AC-8, FR-11 · sau 003
6. **[C-06-006]** web Người dùng + nhãn vai trò chip/bảng + 🔒 vai trò không gán được → AC-7 (UI), AC-9 (UI), AC-8 (gán) · sau 004, 005
7. **[C-06-007]** e2e một lần + PROOF → AC-1..AC-10 · sau 001–006

Điều phối (driver): 003 ∥ 004 không đổi OpenAPI (002 đã khóa hợp đồng); cần đổi → dừng, báo driver (tránh 2 card cùng sinh
`packages/client`). Chỉ 003 sửa `role-dao.ts`; 004 dùng `grantRoleByNameStmt` có sẵn (`.returning()` → 0 dòng = vai trò không còn).
Chỉ 005 sửa `problem-messages.ts` (gồm cả câu `unknown-role` cho 006). Driver chạy vitest tập trung, không hai vitest song song.

## 4. Risks
- R-1 (SPEC R-1) xóa cache theo số người mang: `Promise.all(invalidatePrincipalCache)` ≤ 900; trên → cắt lô qua `waitUntil` (chưa làm; đội nhỏ). Ghi ở `docs/rbac.md`.
- R-2 **SPEC thiếu**: `run_worker_first` chỉ có `"/roles"` → `/roles/{id}` sẽ bị phục vụ như asset SPA khi chạy wrangler/deploy; test 4a `web-shell-acceptance` bắt (mọi path OpenAPI phải khớp). Sửa ở 002, mirror 3 block env.
- R-3 drizzle-kit với `label_key` UNIQUE: phải ra `ALTER TABLE ADD` + `CREATE UNIQUE INDEX`, **không** dựng lại bảng `roles` (bảng con `user_roles`/`role_permissions` FK cascade → mất gán vai trò). 001 đọc SQL sinh ra trước khi chạy; dựng lại bảng → dừng, viết tay ALTER. Cột NOT NULL phải có DEFAULT (`is_system` 0, `version` 1, `created_at`/`updated_at` 0) — SQLite không ADD COLUMN NOT NULL không default.
- R-4 `label_key` hệ thống phải backfill (chữ thường có dấu, viết sẵn trong SQL) để không tạo được vai trò tự tạo "giám đốc" trùng nhãn; hàm chuẩn hóa ở app (`normalizeLabel`) và literal trong SQL phải khớp — 003 có unit test cho hàm.
- R-5 thứ tự `locked_reason` (SPEC chỉ cho 1 giá trị): `admin` > `own_role` > `system` > null; vai trò hệ thống khác `admin` sửa được nhưng không xóa → `can {edit:true, delete:false}`, `locked_reason:"system"`. Admin PATCH `admin` → 403 `admin_role` (không `own_role`) — test AC-5 khóa điều này.
- R-6 (SPEC R-2) client đổi `role` enum → `string`: web `features/users/api.ts` vẫn compile (kiểu hẹp truyền vào kiểu rộng); 006 bỏ type cứng.
- R-7 đổi TTL 300 → 60s tăng đọc D1 khi cache miss; đội nhỏ, chấp nhận (DEC-4). `docs/auth.md` cập nhật con số.
- R-8 e2e đổi vai trò tài khoản Nhân viên dùng chung + bỏ `audit:read` khỏi Quản lý: spec trả Nhân viên về `nhan_vien` cuối spec; `shell.smoke` không dùng Quản lý. Nếu spec đỏ giữa chừng, `shell.smoke` có thể đỏ dây chuyền — đọc lỗi đầu tiên.
- R-9 `member`: đã chốt (SPEC §0) — API từ chối 422 `unknown-role`; thứ tự kiểm ở 004: `self_role`/`admin_only` (FIX-03) → `unknown-role` → `grant_not_held` (FR-12). Test dùng admin cho `member` để không phụ thuộc thứ tự với FR-12.
- R-11 FR-13 trigger: mọi test dọn `audit_events` bằng SQL sẽ đỏ ngay khi migration 0018 vào → 001 phải chuyển cả 9 file trong cùng card (danh sách ở card). Helper đọc trigger từ `sqlite_master` (không chép SQL trigger lần 2). `truncateTables` hiện không đụng `audit_events` (đã grep). Không code sản phẩm nào UPDATE/DELETE `audit_events` (đã grep `src/`; pruner/privacy không đụng) — nếu suite đầy đủ lộ ra chỗ nào, dừng, báo driver.
- R-12 FR-12 có thể đổi kết quả test cũ: người không phải admin đổi vai trò của user đang mang `member` (signup) hoặc vai trò có quyền nền (`notes:*`, `settings:*`) → nay 403. 004 chạy toàn bộ suite API (driver) và ghi test cũ nào đổi kỳ vọng (là guard mới, không phải sửa cho xanh).
- R-10 AC-2 "≤ 60s" chỉ chứng minh ở API (cùng KV, ngay lần gọi kế); ở deploy là trễ KV toàn cầu — human checklist ghi rõ.
- ENGINEERING.md: không xung đột (route giữ `c`; service không thấy `c`; DAO thuần; CAS `UPDATE … WHERE version=? RETURNING` + `db.batch`; Problem+JSON; ghi cần Origin + `X-Requested-With`; bindings không đổi, `run_worker_first` mirror 3 block). Expand-only migration; không SQL phá hủy.

## 5. Trace check (trước STOP)
- [x] mọi FR có AC: FR-1→AC-1 · FR-2→AC-2,3 · FR-3→AC-4 · FR-4→AC-6 · FR-5→AC-5 · FR-6→AC-1,4 · FR-7→AC-2 · FR-8→AC-2,4,6 · FR-9→AC-7 · FR-10→AC-7 (FIX-03) · FR-11→AC-8 · FR-12→AC-9 · FR-13→AC-10
- [x] mọi AC có dòng §1 · mọi AC có card (`serves` từng card) · edge "now": Input AC-4 · Duplicates AC-4 · Two people AC-3, AC-6 race · Failure AC-3 (thua không audit) · Permissions AC-5 · Lockout AC-5 · Lifecycle AC-6 · Lan truyền AC-2 + e2e
- [ ] red run API (driver) · [ ] chờ bạn duyệt PLAN

## 6. PROOF log (step 5) — điền ở C-06-007
- Checks: `pnpm lint && pnpm typecheck && pnpm build` · `pnpm openapi:export && pnpm client:generate && git diff --exit-code` · `CI=true pnpm test` · TUẦN TỰ sau đó `bash docs/cookbook/e2e-kit/free-ports.sh 8791` rồi `PROOF_SHOTS=1 CI=true pnpm --filter @runway/web e2e` (một lần).
- Human checklist (làm → phải thấy):
  - AC-1: `/me` của admin + GĐ có `roles:write`; `/phan-quyen` có hàng "Quản lý vai trò" và đủ 16 quyền, 3 nhóm.
  - AC-2: GĐ bỏ "Phát hành & hủy" khỏi Quản lý; tab Quản lý đang mở bấm Phát hành → câu thiếu quyền (≤ 60s), không đăng xuất; Nhật ký "tắt 1 quyền của «Quản lý»".
  - AC-3: 2 tab cùng sửa Quản lý → tab sau "Người khác vừa sửa vai trò này" + "Tải bản mới".
  - AC-4: "+ Thêm vai trò" "Kế toán" → cột mới; thêm lại " kế  toán " → báo trùng.
  - AC-5: GĐ mở cột Giám đốc → 🔒 "Bạn đang mang vai trò này"; admin mở "Kế toán" → ô "Duyệt / từ chối" 🔒 "Bạn không có quyền này nên không cấp được"; cột Quản trị hệ thống 🔒.
  - AC-6: xóa "Kế toán" khi còn người → "Còn n người…" + link Người dùng; đổi họ đi → xóa được; Nhật ký "xóa vai trò «Kế toán»".
  - AC-7: Người dùng → mời với "Kế toán" → OK; select không có "Thành viên (nền)"; GĐ không thấy "Quản trị hệ thống" trong select (FIX-03).
  - AC-8: 390px: ngăn vai trò toàn màn, không cuộn ngang.
  - AC-9: admin tạo "Kỹ thuật" (Đổi cài đặt hệ thống); GĐ ở Người dùng chọn "Kỹ thuật" cho một người → 🔒 / câu "Bạn không có quyền này nên không cấp được"; admin gán được; GĐ đổi người đó về Nhân viên → bị chặn.
  - AC-10: `wrangler d1 execute runway_dev --local --command "DELETE FROM audit_events"` → lỗi append-only, Nhật ký còn nguyên.
- Attack: không đăng nhập `POST /roles` → 401; Nhân viên `PATCH /roles/{id}` → 403 + `permission.denied`; gửi `name:"admin"` → 422; đoán id → 404; GĐ tự thêm `settings:write` vào vai trò khác → 403 `grant_not_held`; GĐ mời người vào vai trò có `settings:write` → 403 `grant_not_held`.
- Result: [ ]
