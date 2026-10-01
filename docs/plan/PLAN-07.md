# PLAN-07: Kiểm soát RBAC nâng cao — SoD · four-eyes đổi quyền · admin tạm thời (JIT) · rà soát quý

Status: Approved 2026-10-01 (driver chốt — bạn ủy quyền; R-9 SoD trước grant_not_held, R-10 can.request + request_locked_reason cộng thêm, R-11 phân quyền dòng rà soát như §4)
Spec: docs/spec/SPEC-07.md (Approved 2026-10-01) · Roadmap: ROADMAP-02 row 2b · Phụ thuộc: row 2a Done (PLAN-06, commit ae42fbc)

## 0. Đối chiếu `TODO(2a)` của SPEC với code 2a đã build
| SPEC chỗ | Code thật (2a) | Kết luận PLAN |
|---|---|---|
| §3.1 migration `0019_*` | migration cuối `0018_audit_events_append_only.sql` | `0019_*` (drizzle: 5 bảng) + `0020_seed_rbac_advanced.sql` (2 mã quyền) |
| §1 TTL cache 60s (C-06-003) | `session-cache.ts` TTL mặc định 60 | giữ 60; thêm `valid_until` (DEC-8) |
| §3.3 batch duyệt "stmt 1 CAS request → stmt 2 CAS version → rồi DELETE/INSERT" | C-06-003 lệch có chủ đích: mọi stmt phụ thuộc đặt TRƯỚC và cùng guard `G`, CAS cuối (`role-write-dao.ts` đầu file) | duyệt theo mẫu 2a: perms + audit guard `G` (pending ∧ chưa hết hạn ∧ requested_by≠actor ∧ version=base ∧ người gửi còn giữ mã thêm ∧ tập sau áp sạch SoD ∧ actor đủ điều kiện) → CAS request → CAS version cuối (R-2). Thứ tự SPEC không an toàn (bên thua cũng thấy `approved`) |
| R-3 `locked_reason` cuối của 2a | `null\|"system"\|"own_role"\|"admin"`, ưu tiên admin > own_role > system; `"system"` = sửa được, không xóa | KHÔNG nhồi `no_approver` vào `locked_reason` (phá nghĩa `system`); thêm `can.request` + `request_locked_reason: null\|"request_pending"\|"no_approver"` (R-10) |
| FR-12 2a ở thời điểm áp | `actorHoldsAll` / `grantPermissionsStmt` (`role-write-dao.ts`) | dùng lại `actorHoldsAll(requestedBy, added)` trong `G` |
| `PATCH /roles` bỏ `permissions` | `PatchRoleBody.strict()` → bỏ khóa = 422 tự có | AC-2/3/5 của `roles-acceptance.test.ts` chuyển sang luồng yêu cầu ở C-07-002 (R-1) |
| `deps.now` cho cron (`TODO(PLAN)`) | `scheduled()` gọi `ctx.waitUntil(fn(env))`; test gọi thẳng `pruneExpiredRows(env)` | cron mới export `runJitExpiry(env, nowSeconds)` / `runRbacDaily(env, nowSeconds)`; test gọi thẳng với `now` tiêm + 1 lần qua `worker.scheduled(createScheduledController(...))` (cloudflare:test) để chứng minh dispatch |
| Đồng hồ giả cho HTTP | `vi.setSystemTime` (Date, vẫn chạy) — Worker cùng isolate (`contracts-acceptance`) | như 4b; nhảy giờ → `relogin()` (JWT 120s) |
| `run_worker_first` | đã có `/admin/*`, `/roles/*` | thêm `/role-change-requests`, `/role-change-requests/*`, `/sod-pairs`, `/sod-pairs/*`, `/access-reviews`, `/access-reviews/*` × 3 block |
| Slug | `no-eligible-approver`, `duplicate`, `stale`, `last-admin` đã có | dùng lại; thêm `request-pending`, `not-pending`, `expired`, `sod-conflict`, `jit-active`, `already-admin`, `not-active`, `item-changed`, `review-closed`, `review-incomplete`; Problem + `pairs?: string[][]`, `roles?: {id,name,label}[]` |

## 1.
Red run (driver 2026-10-01): `rbac-advanced-acceptance` → `Tests 11 failed (14)` (route 404/405, catalog thiếu `jit:grant`, change request 404); 3 xanh sẵn là test chặn hồi quy (AC-7 last-admin…) — đúng kỳ vọng.
 Acceptance tests — written first, seen failing
Files (viết ở PLAN; `pnpm --filter @runway/api typecheck` + `lint` → 0 lỗi; e2e compile sạch với tsconfig tạm gồm `e2e/`):
- `apps/api/test/integration/rbac-advanced-acceptance.test.ts` — 14 test API. Bảng mới chỉ chạm qua SQL thô (reset trong try/catch). Cron qua dynamic import `src/crons/{jit-expiry,rbac-daily}` (chưa có).
- `apps/web/e2e/rbac-advanced.spec.ts` — 1 spec desktop (AC-12), hợp đồng UI ở đầu file. Không chạy ở PLAN.

Red run: driver chạy `CI=true pnpm --filter @runway/api exec vitest run test/integration/rbac-advanced-acceptance.test.ts` → [ ] (điền output thật; kỳ vọng 14 failed: route 404/501, catalog 16).

| AC | Chứng minh bằng | Đỏ bây giờ? |
|---|---|---|
| AC-1 | API `AC-1` (catalog 18, `/me` GĐ ⊇ 2 mã mới, người khác không; cặp vi phạm → 409 `roles:[giam_doc]`; cặp admin vi phạm → 409 `roles:[admin]`; cặp sạch 201 + `sod.pair_added`; đảo → 409 `duplicate`; 422; GET cho mọi người đăng nhập; NV 403 + denied; DELETE 204/404 + `sod.pair_removed`) | [ ] |
| AC-2 | API `AC-2` (POST /roles 409 `pairs`; tạo yêu cầu 409; cặp khai sau → duyệt 409, quyền + version không đổi; cặp ∥ duyệt → `sodViolations()=0`) | [ ] |
| AC-3 | API `AC-3` (PATCH `permissions` 422; yêu cầu 201 đủ trường, chưa đổi gì, `pending_request`, `request_locked_reason`; 409 `request-pending` ×3 (yêu cầu 2, PATCH, DELETE); `own_role`/`admin_role`/`grant_not_held` + denied; `stale`/404/422) + `roles-acceptance` AC-2/3/5 chuyển luồng (R-1) | [ ] |
| AC-4 | API `AC-4` (self_approve + denied; `can`/`locked_reason` theo người gọi; 2 admin duyệt song song → [200,409 `not-pending`]; QL 403 ngay lần kế; 2 dòng audit) + `AC-4 / reject+withdraw` (note bắt buộc; rút chỉ người gửi; người mang duyệt việc BỚT quyền vai trò mình; người gửi mất mã → 403 `grant_not_held`, yêu cầu vẫn chờ) | [ ] |
| AC-5 | API `AC-5` (đúng `expires_at` → 409 `expired`; list `expired`; cron 2 lần → 1 `role.change_expired`; mở khóa) | [ ] |
| AC-6 | API `AC-6` (201 + Idempotency replay; `/me` chỉ quyền admin, `jit.expires_at`; `user_roles` không đổi; cache ấm 30s trước hạn → +5s: KV còn khóa mà request 403; `scheduled("*/5")` + tick lặp → 1 `jit.expired`) | [ ] |
| AC-7 | API `AC-7` (`self_grant`; 422 phút/lý do/user pending; 409 `already-admin`/`jit-active`; 404; admin không có `jit:grant`; người có JIT: `admin_only`, `jit_actor`, cấp JIT 403; `last-admin`) | [ ] |
| AC-8 | API `AC-8` (GĐ thu hồi → 403 ngay; `jit.revoked`; 409 `not-active`; người nhận tự kết thúc; người thứ ba 403; đã thu hồi không sinh `jit.expired`) | [ ] |
| AC-9 | API `AC-9` (`scheduled("0 3")` 01/10 → 1 đợt `2026-Q4`, 4 dòng (pending/disabled loại); lặp/POST → 409 `duplicate`; 31/12 17:30Z → `2027-Q1`) | [ ] |
| AC-10 | API `AC-10` (Giữ; Gỡ → disabled + 401; `self_review`; admin quyết dòng GĐ, dòng khác 403 (R-11); `admin_only`; `changed` → 409 `item-changed`; `review-incomplete`; đóng → `review.closed`; `review-closed`) | [ ] |
| AC-11 | API `AC-11` (+14 ngày `overdue:false`, +16 ngày `true`) + human: banner trang chủ + số nav | [ ] |
| AC-12 | e2e `rbac-advanced.spec.ts` + human 390px | e2e chưa chạy (ngân sách: 1 lần ở PROOF) |
| AC-13 | API `AC-13` (thêm quyền vào `giam_doc` khi chỉ GĐ còn lại → 409; admin bị khóa → `can.request=false`, `no_approver`, 409, 0 dòng) | [ ] |
| §7 401/403 | API `§7 / §5` (14 endpoint: ẩn danh 401; NV 403 + đúng 1 denied mỗi lần) | [ ] |

Test đơn vị (red-first trong card): `domain/sod.test.ts` (C-07-001), `domain/review-period.test.ts` (C-07-006), web `role-diff.test.ts` ("Gửi yêu cầu (−1)"), `permission-labels.test.ts`, `audit-sentence.test.ts`, `problem-messages.test.ts` (C-07-007), `role-locks.test.ts` / `jit-*.test.ts` / `nav.test.ts` (C-07-008).

## 2. Files that change
| File | New / Modify | Why (FR) | Card |
|---|---|---|---|
| `apps/api/src/db/schema.ts` · `migrations/0019_*.sql` (drizzle) · `migrations/0020_seed_rbac_advanced.sql` · `migrations/meta/*` | M/N | 5 bảng (§3.1), partial unique `role_change_requests(role_id) WHERE status='pending'`; `jit:grant`, `reviews:write` → giam_doc (FR-10) | 001 |
| `packages/rbac/src/catalog.ts` · `docs/rbac.md` | M | 18 mã; mục SoD / four-eyes / JIT / rà soát + đường thoát lockout = migration (DEC-14, R-3 SPEC) | 001 |
| `apps/api/src/domain/sod.ts` (+test) · `dao/sod-dao.ts` (đọc) · `dao/jit-dao.ts` (đọc) | N | `sodViolations()` thuần; `sodClearSql(keys)`, `listPairs`; `jitActiveSql(userId, now)`, `findActiveJit` — predicate dùng chung cho 003/004/005/006 | 001 |
| `apps/api/test/integration/foundation-acceptance.test.ts` · `roles-acceptance.test.ts` (CATALOG, SEED_GRANTS) | M | hệ quả FR-10 (không sửa cho xanh) | 001 |
| `apps/api/src/dto/{roles,role-change,sod,jit,access-review,error}.ts` · `routes/{role-change-requests,sod-pairs,jit-grants,access-reviews}.routes.ts` (501) · `routes/index.ts` · `routes/roles.routes.ts` · `routes/me.routes.ts` (`jit: null`) · `services/role-admin-service.ts` (trường mới mặc định) | M/N | hợp đồng §2b trước handler | 002 |
| `apps/api/src/crons/{jit-expiry,rbac-daily}.ts` · `src/index.ts` · stub `services/{role-change,jit,access-review}-service.ts` | N/M | dispatch cron (không lịch mới); mỗi nhánh try/catch riêng (R-6 SPEC) | 002 |
| `apps/api/wrangler.toml` | M | `run_worker_first` 6 path × 3 block | 002 |
| `packages/client/src/generated/*` | M | `openapi:export && client:generate` (chỉ 002) | 002 |
| `apps/api/test/integration/roles-acceptance.test.ts` (AC-2/3/5) · `apps/web/src/features/roles/role-drawer.tsx` · `roles-screen.test.tsx` | M | R-1: PATCH không còn `permissions` | 002 |
| `apps/api/src/services/sod-service.ts` · `dao/sod-dao.ts` (ghi) · `routes/sod-pairs.routes.ts` · `role-admin-service.ts` + `role-write-dao.ts` + `roles.routes.ts` (SoD khi tạo vai trò) | N/M | FR-1, FR-2 | 003 |
| `apps/api/src/services/role-change-service.ts` · `dao/role-change-dao.ts` · `routes/role-change-requests.routes.ts` · `role-admin-service.ts` + `roles.routes.ts` (`request-pending`, `pending_request`, `can.request`) | N/M | FR-2..4, FR-11, DEC-1..4, DEC-14 | 004 |
| `apps/api/src/services/jit-service.ts` · `dao/jit-dao.ts` (ghi) · `routes/jit-grants.routes.ts` · `middleware/auth.ts` · `dao/session-cache.ts` · `routes/me.routes.ts` · `docs/auth.md` | N/M | FR-5, FR-6, DEC-5..8 | 005 |
| `apps/api/src/services/access-review-service.ts` · `dao/access-review-dao.ts` · `routes/access-reviews.routes.ts` · `domain/review-period.ts` (+test) | N | FR-7, FR-8, DEC-10..12 | 006 |
| `apps/web/src/features/roles/**` · `features/audit/audit-sentence.ts` (+test) · `lib/problem-messages.ts` (+test) · `apps/web/e2e/roles.spec.ts` | M | ngăn + 3 tab, câu nhật ký FR-9, câu lỗi mọi slug/rule 2b; spec 2a theo DEC-1 | 007 |
| `apps/web/src/features/users/**` · `features/access-review/**` (N) · `app/{layout,me,nav,route-types,router}.tsx/ts` · `app/nav.test.ts` | M/N | JIT modal/chip, banner JIT + quá hạn, `/ra-soat-quyen`, nav any-of quyền | 008 |
| `apps/web/e2e/` (shots) · `docs/plan/PLAN-07.md` · `docs/roadmap/ROADMAP-02.md` | M | PROOF | 009 |

### 2b. API contract (C-07-002 khóa; card sau đổi → dừng, báo driver)
- `Role` + `can.request: bool`, `request_locked_reason: null|"request_pending"|"no_approver"`, `pending_request: {id, added[], removed[], requested_by_name, expires_at} | null`. Có yêu cầu chờ (chưa hết hạn) → `can = {edit:false, delete:false, request:false}`. `no_approver` = không có ai ≠ người gọi, `active`, `roles:write` thường trực (D1), không JIT hiệu lực (điều kiện yếu nhất — yêu cầu THÊM quyền còn kiểm "không mang vai trò" lúc gửi → 409).
- `PatchRoleBody {expected_version, label?, description?}.strict()`. PATCH/DELETE + 409 `request-pending`. POST /roles + 409 `sod-conflict` `pairs`.
- `POST /roles/{id}/change-requests` (`requireAuth`+`requirePerm("roles:write")`) `{expected_version, permissions[] (tập đầy đủ mới, catalog, không lặp), note? ≤500}` → 201 `ChangeRequest`. Thứ tự: 404 → `admin_role` → `own_role` → 422 không đổi gì (`validation`, `errors[{path:"permissions"}]`) → `sod-conflict` (R-9) → `grant_not_held` → `stale` → `request-pending` → `no-eligible-approver`.
- `ChangeRequest {id, role_id, role_name, role_label, base_version, added[], removed[], note, status (pending|approved|rejected|withdrawn|expired|cancelled — expired tính lúc đọc), requested_by, requested_by_name, requested_at, expires_at, decided_by, decided_by_name, decided_at, decision_note, can:{approve,reject,withdraw}, locked_reason: null|"self_approve"|"jit_actor"|"own_role"}`.
- `GET /role-change-requests?status=` (`roles:write`) → `{items}` mới nhất trước; không `status` = tất cả. `approve` `{note?}` → 200 `{request, role}`; `reject` `{note 1–500}` → 200 `ChangeRequest`; `withdraw` (`requireAuth`; service: chỉ người gửi, khác → 403 `forbidden` + denied) → 200. approve/reject: `requirePerm("roles:write")`; thứ tự 404 → `self_approve` → `jit_actor` → (approve) `own_role` → `not-pending` → `expired` → `stale` → `sod-conflict` → `grant_not_held`.
- `GET /sod-pairs` (đăng nhập) → `{items: SodPair}`; `POST /sod-pairs` (`roles:write`) `{perm_a, perm_b (catalog, khác nhau), reason? ≤200}` → 201 `SodPair` (lưu `perm_a < perm_b`), 409 `sod-conflict` `roles` / `duplicate`; `DELETE /sod-pairs/{id}` → 204 / 404.
- `JitGrant {id, user_id, user_name, reason, granted_by, granted_by_name, created_at, expires_at, revoked_at, state: active|revoked|expired}`. `GET /admin/jit-grants?active=` (`users:read`); `POST /admin/jit-grants` (`jit:grant`, `withIdempotency`) `{user_id, reason trim 10–500, minutes int 15–480}` → 201; thứ tự 404 → `self_grant` → `jit_actor` → 422 (user không `active`) → `already-admin` → `jit-active`. `POST /admin/jit-grants/{id}/revoke` (`requireAuth`; service: `jit:grant` thường trực hoặc chính người nhận, khác → 403 + denied) → 200 `JitGrant`; 404 · 409 `not-active`.
- `GET /me` + `jit: {expires_at} | null` (từ D1/JIT hiệu lực, không từ cache).
- `GET /access-reviews/current` (gate: principal có `reviews:write` hoặc `roles:write`, thiếu → 403 + denied) → `{review: {id, period, status, opened_by, opened_at, due_at, closed_at} | null, items: [{user:{id, display_name}, role:{name,label}, decision, decided_by_name, decided_at, state: open|decided|changed, can:{keep,remove}, locked_reason: null|"self_review"|"admin_only"|"not_reviewer"}], progress:{decided,total}, overdue}`. "current" = đợt `open` mới nhất, không có thì đợt của quý hiện tại, không có → `review:null`. `state` = decision≠null ? decided : (đổi vai trò / không còn `active` ? changed : open).
- `POST /access-reviews` (`reviews:write`) → 201 `review` (quý VN hiện tại) / 409 `duplicate`. `POST /access-reviews/{id}/items/{userId}` (`requireAuth`; service D1) `{decision: keep|remove}` → 200 item; thứ tự 404 → `jit_actor` → quyền (R-11; thiếu → 403 `forbidden` + denied) → `self_review` → `review-closed` → `item-changed` → (remove) `updateUser` (`admin_only`/`last-admin` đi nguyên). `POST /access-reviews/{id}/close` (`reviews:write`) → 200 / 409 `review-incomplete`.
- Cron: `runJitExpiry(env, now)` (`*/5`, ≤100/tick), `runRbacDaily(env, now)` (`0 3`: mở đợt quý nếu chưa có, `opened_by:"system:cron"`; đổi yêu cầu quá hạn → `expired` + audit). Gọi thêm sau nhánh cũ, try/catch riêng.
- Audit (FR-9, target): `sod.pair_added|removed {perm_a, perm_b}` `sod:<id>` · `role.change_requested|approved|rejected|withdrawn|expired {name, label, added, removed}` `role:<id>` · `jit.granted {user, reason, expires_at}` / `jit.revoked {user}` / `jit.expired {user}` `user:<id>` · `review.opened {period}` / `review.closed {period}` `review:<id>` · `review.item_decided {user, role, decision}` `review:<id>`.

## 3. Cards — một việc nhỏ mỗi card (docs/plan/cards/C-07-NNN.md)
Thứ tự: 001 → 002 → (003 → 004) ∥ 005 ∥ 006 → 007 → 008 → 009.
1. **[C-07-001]** dữ liệu + catalog + predicate đọc (SoD, JIT) → AC-1 (catalog), FR-10, nền mọi AC
2. **[C-07-002]** hợp đồng OpenAPI + dispatch cron + chuyển AC-2/3/5 của 2a (R-1) → nền AC-1..AC-13 · sau 001
3. **[C-07-003]** API cặp xung đột + SoD khi tạo vai trò → AC-1, AC-2 (phần tạo) · sau 002
4. **[C-07-004]** API four-eyes (yêu cầu, duyệt/từ chối/rút, hết hạn, khóa vai trò, lockout) → AC-2 (yêu cầu/duyệt), AC-3, AC-4, AC-5, AC-13 · sau 003
5. **[C-07-005]** API JIT + principal `valid_until` + `/me.jit` + cron hết hạn → AC-6, AC-7, AC-8 · sau 002 (∥ 003/004/006)
6. **[C-07-006]** API rà soát quý + cron mở đợt → AC-9, AC-10, AC-11 · sau 002 (∥ 003/004/005)
7. **[C-07-007]** web Phân quyền (ngăn gửi yêu cầu, 3 tab, cặp) + câu nhật ký/lỗi + `roles.spec.ts` theo DEC-1 → AC-12 (phần đổi quyền), FR-9 UI · sau 004
8. **[C-07-008]** web JIT + rà soát + banner + nav → AC-11 (UI), AC-12 (JIT/rà soát) · sau 005, 006, 007
9. **[C-07-009]** e2e một lần + PROOF → AC-1..AC-13 · sau 001–008

Điều phối (driver): touch-point SPEC §9 (rbac-daily cần hàm hết hạn của four-eyes) giải bằng **tách**: 002 viết `crons/rbac-daily.ts` + `jit-expiry.ts` hoàn chỉnh, gọi hàm stub trong `role-change-service` (`expireOverdueRequests`), `jit-service` (`sweepExpiredJit`), `access-review-service` (`openQuarterReview`); 004/005/006 điền thân hàm trong file service của mình, không ai sửa file cron sau 002. Predicate dùng chung (`jitActiveSql`, `sodClearSql`) ở 001; 003–006 chỉ import, 005 không đổi chữ ký. Chỉ 002 sinh `packages/client`. 003 → 004 tuần tự (cùng `role-admin-service.ts`, `roles.routes.ts`). Driver chạy vitest tập trung, không hai vitest song song.

## 4. Risks
- R-1 (SPEC R-1) `PATCH /roles` bỏ `permissions` → `roles-acceptance` AC-2/3/5 đỏ: 002 viết lại đúng 3 test đó sang luồng yêu cầu (chi tiết ở card), đỏ tới 004; web `role-drawer` thôi gửi `permissions` (biên dịch) — UI gửi yêu cầu ở 007.
- R-2 Thứ tự batch duyệt (§0): theo mẫu C-06-003 (stmt phụ thuộc trước, CAS cuối, một guard `G`). SoD + FR-12 của người gửi nằm trong `G` (D1 batch không rollback khi INSERT…SELECT ra 0 dòng — chỉ CAS phụ thuộc mới làm "cả hoặc không"). Test đua: AC-2 race, AC-4 song song.
- R-3 (SPEC R-2) đường nóng `loadPrincipal`: +1 truy vấn JIT chỉ khi cache miss; cache cũ thiếu `valid_until` → coi như hết hạn ngay (miss) — an toàn hơn SPEC ("coi như không JIT"), chi phí 1 lần đọc D1.
- R-4 (SPEC R-4) partial unique index qua drizzle-kit: đọc SQL sinh ra; không ra `WHERE` → viết tay trong `0019`. Bảng mới, không đụng bảng cũ (không dựng lại `roles`).
- R-5 Hết hạn lười: chỗ trống của partial unique (`pending` đã quá hạn) chặn yêu cầu mới tới khi cron chạy → tạo yêu cầu lật `expired` trong cùng batch (R-12).
- R-6 Cron mới chạy chung tick với `verifyEmailSweeper` / `pruneExpiredRows`: `Promise.allSettled`, mỗi nhánh log lỗi riêng.
- R-7 KV `expirationTtl` ≥ 60 (đã đọc lại docs Cloudflare KV, SPEC §1): `valid_until` là cách duy nhất cắt đúng giây; không đặt TTL < 60.
- R-8 **SPEC sai dữ liệu**: AC-1/AC-2 dùng cặp (`contract:issue`, `users:read`) — `giam_doc` có cả hai (seed 0010) ⇒ khai báo luôn 409. Test dùng (`contract:issue`, `settings:write`) (không vai trò seed nào có cả hai); AC-1 phần "201" và AC-2 theo cặp này.
- R-9 **SPEC thiếu thứ tự**: mỗi người 1 vai trò ⇒ mọi cặp mà người gọi giữ cả hai mã đã nằm trong vai trò của họ ⇒ khai báo cặp bị từ chối ⇒ nếu `grant_not_held` chạy trước SoD thì "POST /roles chứa cả hai → 409 sod-conflict" (AC-2) không bao giờ xảy ra. PLAN: SoD kiểm TRƯỚC `grant_not_held` ở POST /roles và tạo yêu cầu (hàm thuần trên tập đề xuất; cặp vốn công khai qua GET /sod-pairs — không lộ gì). **Bạn duyệt điểm này.**
- R-10 `no_approver` không nhét vào `locked_reason` 2a (xem §0) → trường mới `request_locked_reason` (additive). **Bạn duyệt.**
- R-11 **SPEC mơ hồ DEC-11** ("dòng của mình: DEC-11" ở bảng API): PLAN chốt — có `reviews:write` (D1) → quyết mọi dòng trừ dòng mình (`self_review`); chỉ có `roles:write` thường trực → chỉ quyết dòng của người mang `reviews:write` (GĐ), dòng khác 403 `forbidden` + denied, `locked_reason:"not_reviewer"`. Admin vẫn THẤY mọi dòng (đã thấy họ ở Người dùng). **Bạn duyệt.**
- R-12 `role.change_expired` ghi đúng 1 lần bởi bên lật trạng thái (cron hoặc tạo yêu cầu mới), cùng batch; đọc thì tính `expired` không ghi.
- R-13 AC-7 "admin thường trực duy nhất bị khóa khi đang có JIT → 409 last-admin": người khóa phải là admin (FIX-03 `admin_only`) ⇒ chỉ có thể là admin tự khóa mình (API không chặn tự khóa). Test làm vậy; test xanh ngay từ giờ là đúng (guard DEC-7 đã có, test giữ hồi quy).
- R-14 e2e: `rbac-advanced.spec.ts` chạy TRƯỚC `roles.spec.ts` (chữ cái) — spec trả Quản lý về đủ quyền (yêu cầu + duyệt qua API) và JIT do người nhận kết thúc. `roles.spec.ts` (007) đổi "Lưu (−1 quyền)" → "Gửi yêu cầu (−1)" + "Rút yêu cầu" để không để lại yêu cầu chờ. global-setup không lưu phiên admin → spec đăng nhập admin qua API (1 lần login).
- R-15 Nav "Rà soát quyền" cần `reviews:write` HOẶC `roles:write` — `NavItem.requiredPermissions` là "tất cả" → 008 thêm `anyPermissions?` (route-types + nav + layout).
- ENGINEERING.md: không xung đột (route giữ `c`; service không thấy `c`; DAO thuần; CAS + `db.batch`; Problem+JSON; ghi cần Origin + `X-Requested-With`; không binding mới, không lịch cron mới; `run_worker_first` mirror 3 block). Migration expand-only.

## 5. Trace check (trước STOP)
- [x] mọi FR có AC: FR-1→AC-1 · FR-2→AC-2 · FR-3→AC-3 · FR-4→AC-4, AC-5 · FR-5→AC-6, AC-8 · FR-6→AC-7 · FR-7→AC-9, AC-10 · FR-8→AC-10, AC-11 · FR-9→AC-1,3,4,5,6,8,9,10 · FR-10→AC-1, AC-7 · FR-11→AC-13
- [x] mọi AC có dòng §1 · mọi AC có card (`serves`) · edge "now": Input AC-1, AC-3, AC-7 · Duplicates AC-1, AC-3, AC-6 (Idempotency), AC-7 (`jit-active`), AC-9 · Two people AC-2 race, AC-4 song song · Yêu cầu cũ AC-3, AC-4 (`grant_not_held` lúc áp) · Failure AC-5, AC-6 (cache còn vẫn cắt), AC-8 (tick lặp) · Permissions AC-7, AC-10, §7 sweep · Lockout AC-13 · SoD × hệ thống AC-1 · Lifecycle AC-9 (pending/disabled loại), AC-10 (`changed`), AC-8 · Time AC-5, AC-6, AC-9 (múi giờ VN), AC-11
- [ ] red run API (driver) · [ ] bạn duyệt R-9, R-10, R-11 + PLAN

## 6. PROOF log (step 5) — điền ở C-07-009
- Checks: `pnpm lint && pnpm typecheck && pnpm build` · `pnpm openapi:export && pnpm client:generate && git diff --exit-code` · `CI=true pnpm test` · TUẦN TỰ sau đó `bash docs/cookbook/e2e-kit/free-ports.sh 8791` rồi `PROOF_SHOTS=1 CI=true pnpm --filter @runway/web e2e` (một lần).
- Human checklist (làm → phải thấy):
  - AC-1: Phân quyền → "Cặp xung đột" → thêm «Phát hành & hủy» ⟷ «Quản lý mẫu» → "Đang có vai trò chứa cả hai quyền: «Giám đốc»…"; thêm «Phát hành & hủy» ⟷ «Đổi cài đặt hệ thống» → vào danh sách.
  - AC-2: ngăn vai trò tự tạo tick cả hai mã của cặp → câu xung đột dưới ô quyền, không gửi được.
  - AC-3: GĐ bỏ 1 quyền Quản lý → "Gửi yêu cầu (−1)" → dải "Đang chờ duyệt"; ô quyền 🔒; sửa nhãn → báo đang chờ.
  - AC-4: admin → tab Yêu cầu (số trên tab + nav) → Duyệt; tab Quản lý đang mở bấm Nhật ký → thiếu quyền; GĐ không thấy nút Duyệt yêu cầu của mình.
  - AC-5: (API) — hết hạn chỉ chứng minh ở suite.
  - AC-6/8: GĐ → Người dùng → "Cấp quản trị tạm thời" 15 phút → chip "Quản trị tạm · còn …"; người nhận thấy banner, menu quản trị; "Thu hồi ngay" → người nhận tải lại mất quyền.
  - AC-7: dòng của mình 🔒 "Không tự cấp cho mình".
  - AC-9/10: "Rà soát quyền" → "Bắt đầu rà soát" → Giữ/Gỡ (xác nhận khóa tài khoản); dòng mình 🔒; admin đăng nhập quyết được dòng GĐ.
  - AC-11: đặt `due_at` lùi bằng SQL local → banner trang chủ "Đợt rà soát … quá hạn n ngày" + số trên nav.
  - AC-12: 390px: ngăn/modal toàn màn, không cuộn ngang.
  - AC-13: khóa admin bằng SQL local → ngăn vai trò: nút Gửi 🔒 + câu cảnh báo trước khi bấm.
- Attack: ẩn danh mọi endpoint mới → 401; NV gọi → 403 + `permission.denied`; người có JIT duyệt / cấp JIT / gán `admin` → 403; tự duyệt / tự cấp / tự rà → 403; `PATCH /roles` có `permissions` → 422; đoán id → 404.
- Result: [ ]
