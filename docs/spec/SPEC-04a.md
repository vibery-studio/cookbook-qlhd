# SPEC-04a: Giao diện nền `apps/web`

Status: Approved 2026-09-29
Intent: docs/intent/INTENT-04a.md

## 1. Research (nguồn + ngày, đọc 2026-09-29)
- Workers static assets — cấu hình (developers.cloudflare.com/workers/static-assets/binding/): `assets = { directory, binding?, run_worker_first, not_found_handling }`;
  `run_worker_first` = `false` (mặc định, asset trước) | `true` | **mảng route pattern** (glob `*`, phủ định `!`; ví dụ `["/api/*", "!/api/docs/*"]`) — "often paired with `not_found_handling = single-page-application`".
- SPA mode (…/static-assets/routing/single-page-application/): request không khớp file → trả `/index.html` 200. Khi đặt `run_worker_first` (mảng), việc tự nhận biết `Sec-Fetch-Mode: navigate`
  bị tắt và mình kiểm soát request nào vào Worker, request nào ra asset → **URL nằm trong mảng luôn vào Worker, kể cả khi trình duyệt điều hướng tới nó.**
- Worker-first (…/routing/worker-script/): với mảng, request không khớp "serve asset khớp, hoặc `index.html`, không qua Worker". Chỉ tính phí khi Worker chạy.
- Wrangler config (…/wrangler/configuration/): `assets` **không inheritable** → phải lặp trong từng `[env.*]` (khớp luật "bindings mirrored in every env block"). Đường dẫn `directory` tương đối với file wrangler (chưa nói rõ → xác nhận khi dựng bằng `wrangler dev`).
- Tailwind v4 + Vite (tailwindcss.com/docs/installation/using-vite): `npm i tailwindcss @tailwindcss/vite`; `plugins: [tailwindcss()]` trong `vite.config`; CSS `@import "tailwindcss";`.
- Tailwind v4 theme (tailwindcss.com/docs/theme): `@theme { --color-*: initial; --color-x: #… }` — `initial` xóa toàn bộ màu mặc định, chỉ còn token của mình; namespace `--color-* --font-* --spacing-* --radius-* --breakpoint-*`.
- React Router (reactrouter.com/start/modes): 3 chế độ declarative · data · framework; import `createBrowserRouter`, `RouterProvider` từ `"react-router"` (một package, không cần `react-router-dom`). Chưa xác nhận từ docs: đường import `RouterProvider` cho react-dom (v7 dùng `react-router/dom`) → kiểm khi cài.
- TanStack Query (tanstack.com/query/latest/docs/framework/react/installation): `@tanstack/react-query` v5, React ≥ 18. Cách dựng `QueryClientProvider` sẽ đọc lại lúc cài.
- Nội bộ: `docs/auth.md` (cookie `runway_at` Path=/ · `runway_rt` Path=/auth, SameSite=Strict, Secure chỉ ở preview/prod; ghi cần `Origin`=`APP_ORIGIN` + `X-Requested-With: fetch`) ·
  `packages/client` (`createClient`: cookie, tự thêm header CSRF, **tự refresh 1 lần khi 401, single-flight**, `Result<T>`; wrapper cho `login/logout/refresh/me`, còn lại qua `client.typed.GET/POST…`) ·
  `user-admin-service.ts:82` (API đã sinh `activation_url = ${APP_ORIGIN}/activate?token=…` → SPA phải có đúng route `/activate`) ·
  `middleware/security-headers.ts` (CSP `default-src 'self'` — chỉ áp cho response do Worker trả; `index.html` từ assets không đi qua nó).
- Miền: DESIGN.md "States", FEEL/MOTION (design law), mockup `index.html` (không có màn đăng nhập / kích hoạt / người dùng).

## 2. Requirements
- [FR-1] Một origin: SPA build vào `apps/web/dist`, Worker phục vụ bằng static assets; mọi đường API hiện có vẫn vào Worker; mọi URL khác trả `index.html` → OUT-1 OUT-3
- [FR-2] Tailwind v4, theme chỉ chứa token FEEL/MOTION (màu, font, cỡ chữ, spacing s1–s7, radius r1–r3, `--dur`); màu/kích thước ngoài token bị cấm → OUT-3
- [FR-3] Khung: sidebar 240px (tên app, nav, nhóm "HỆ THỐNG", chip người dùng + badge vai trò + Đăng xuất); ≤ breakpoint mobile: top bar + menu, 390px đọc được → OUT-3
- [FR-4] Đăng nhập `/login` (email, mật khẩu) → cookie → `GET /me`; đăng xuất; 401 → refresh 1 lần rồi mới về `/login`; nhớ trang định vào (`next`) → OUT-1
- [FR-5] Kích hoạt `/activate?token=…`: đặt mật khẩu → `POST /auth/activate` → hướng dẫn đăng nhập → OUT-2
- [FR-6] Route guard theo quyền từ `/me`: nav ẩn màn không có quyền; vào thẳng URL → màn 403 giải thích, không gọi API màn đó → OUT-3
- [FR-7] Một module duy nhất đổi Problem+JSON → câu tiếng Việt (theo `status` + slug `type` + `errors[].path`); không bao giờ hiện `detail`/title tiếng Anh hay mã thô → OUT-8
- [FR-8] Khách hàng (`contract:read` xem · `contract:write` thêm/sửa): danh sách thẻ, tìm, "Xem thêm" theo cursor, thêm/sửa trong modal, báo trùng + stale → OUT-4
- [FR-9] Phân quyền (mọi người đã đăng nhập): ma trận từ `GET /roles`, chỉ đọc → OUT-5
- [FR-10] Nhật ký (`audit:read`): mới nhất trước, lọc theo hành động, "Xem thêm"; `permission.denied` màu danger + biểu tượng 🔒 → OUT-6
- [FR-11] Người dùng (`users:read` xem · `users:write` thao tác; DEC-2 = có): danh sách, mời, tạo lại link, đổi vai trò, khóa/mở khóa → OUT-7
- [FR-12] Mỗi màn có đủ 4 trạng thái: rỗng · đang tải (skeleton) · lỗi (+ Thử lại) · 403 (🔒) → OUT-3 OUT-8
- [FR-13] Truy cập cơ bản: dùng được bằng bàn phím, nhãn cho mọi ô nhập, focus nhìn thấy, lỗi đọc được bởi trình đọc màn hình, tôn trọng `prefers-reduced-motion` → OUT-3

## 3. Design

### 3.1 Dựng & nối (static assets)
- `apps/web` = package workspace mới `@runway/web` (React 18/19 + Vite + TS). Phụ thuộc `@runway/client` (`workspace:*`). Build → `apps/web/dist`.
- `apps/api/wrangler.toml` — thêm vào block mặc định **và** `[env.preview]`, `[env.production]` (assets không thừa kế):
  ```toml
  [assets]                       # [env.X.assets] ở các env
  directory = "../web/dist"
  not_found_handling = "single-page-application"
  run_worker_first = [ "/auth/*", "/me", "/me/*", "/roles", "/audit", "/customers", "/customers/*",
                       "/price-list", "/admin/*", "/healthz", "/readyz", "/docs", "/openapi.json" ]
  ```
  (liệt kê cả `/customers` lẫn `/customers/*` vì chưa xác nhận `x/*` có khớp `x` không.) Row 2–4b thêm đường của chúng (`/templates`, `/contracts`…) vào mảng này trong cùng card tạo route.
- Chống lệch danh sách: 1 test (vitest ở `apps/api`) đọc OpenAPI và khẳng định mọi path đều khớp một pattern trong `run_worker_first` → thêm route API mà quên mảng thì CI đỏ, không phải 404 lặng lẽ thành `index.html`.
- URL màn hình (SPA) đặt tiếng Việt để không đụng URL API: `/login` · `/activate` (cố định vì API đã sinh link này) · `/khach-hang` · `/phan-quyen` · `/nhat-ky` · `/nguoi-dung` · `/` → chuyển tới màn đầu tiên được phép. (DEC-1: đã chốt A; mỗi route API mới ở row 2–4b thêm vào mảng cùng card)
- Dev: `pnpm dev` (wrangler :8787, giữ nguyên) + `pnpm --filter @runway/web dev` (Vite :5173, proxy các đường trong mảng ở trên sang :8787). Proxy đặt `Origin` = `APP_ORIGIN` (`http://localhost:8787`) — DEC-5,
  vì API chặn ghi khi `Origin` khác; cookie không Secure ở dev nên chạy được trên http. Đường thay thế đúng hình thật: `pnpm --filter @runway/web build --watch` + `pnpm dev` (một origin :8787, không proxy).
- Lệnh thêm: `pnpm --filter @runway/web build|typecheck|lint|test`; root `pnpm build` (turbo) build web trước api khi cần assets (`dependsOn`). Không deploy (do bạn, `docs/deploy.md`).
- Rủi ro cần xử lý ở card scaffold: (a) `wrangler dev`/vitest của api đọc `assets.directory` — nếu `apps/web/dist` chưa có thì lỗi → giữ thư mục tồn tại (`.gitkeep`) hoặc cấu hình test bỏ assets; (b) `scripts/validate-wrangler.ts` (`check:wrangler`) phải biết khối `assets` ở cả 3 env;
  (c) CSP: `index.html` từ assets không có header của Worker → thêm `_headers` trong `apps/web/public` (xác nhận cú pháp trong docs trước khi viết); font tự host (không CDN), `assetsInlineLimit: 0` để không sinh `data:` URI bị CSP chặn.

### 3.2 Token → Tailwind (`src/styles/theme.css`, nguồn: FEEL.md · MOTION.md)
```css
@import "tailwindcss";
@theme {
  --color-*: initial;  --spacing-*: initial;  --radius-*: initial;  --shadow-*: initial;
  /* màu: FEEL Colour — tên rút gọn: bg-app bg-surface bg-sidebar bg-sunken bg-hover bg-active
     text-strong text-body text-muted text-faint accent accent-soft accent-border danger(-bg,-border) ok(-bg,-border)
     border-line border-strong st-draft(-bg) … st-rejected(-bg) */
  --font-sans: "Be Vietnam Pro", …;  --font-mono: "JetBrains Mono", …;
  /* cỡ chữ 12·13·14·16·20·26 + line-height 1.28 (heading) / 1.55 (body); spacing s1…s7 = 4·8·12·16·24·32·48; radius r1·r2·r3 = 4·6·10 */
}
:root { --dur: 150ms; --sidebar-w: 240px; --row-h: 44px; --drawer-w: 560px; }
```
- Giá trị hex lấy nguyên từ FEEL.md, không nhập lại bằng tay ở nơi khác. Token chưa có trong FEEL: breakpoint mobile **768px** (đã chốt) → thêm vào FEEL.md như token ở card C-04a-001, trước khi dùng.
- Chuyển động: chỉ `transition-colors`/`opacity`/`transform` 150ms `cubic-bezier(.22,.68,.24,1)` cho modal; `prefers-reduced-motion` bỏ transform.
- Component dùng chung (`src/ui`): Button · Field · Modal (focus trap, Esc) · Pill · Skeleton · EmptyState · ErrorState · LockedNote (🔒 + lý do) · Toast/Alert.

### 3.3 Xác thực & phiên
- Chỉ cookie httpOnly; JS không đọc được token. Không `localStorage`/`sessionStorage` cho token hoặc dữ liệu người dùng. Trạng thái "tôi là ai" = cache TanStack Query khóa `["me"]` (`GET /me`: `id, email, display_name, roles, permissions` — `display_name` thêm ở DEC-6).
- Khởi động: gọi `/me`. 200 → vào app. 401 → `packages/client` đã tự `POST /auth/refresh` 1 lần (single-flight) rồi thử lại; vẫn 401 → xóa cache, `/login?next=<đường đang định vào>`. Không tự viết lại logic refresh ở SPA.
- Đăng nhập: `login()` → 200 `{user_id}` → `/me` → chuyển tới `next` (chỉ nhận đường nội bộ bắt đầu bằng một `/`, không `//`, không có scheme) hoặc màn đầu tiên được phép. Đã đăng nhập mà vào `/login` → chuyển đi.
- Đăng xuất: `logout()`; dù request lỗi vẫn xóa cache Query + về `/login` (cookie còn sẽ hết hạn ≤ 120s/7 ngày; thu hồi phía server đã có).
- Quyền đổi giữa phiên (Giám đốc hạ vai trò): tải lại `/me` khi cửa sổ lấy lại focus và ngay khi gặp 403; guard chạy lại theo dữ liệu mới.
- `/activate`: đọc `token` từ query vào bộ nhớ rồi `history.replaceState` xóa nó khỏi URL; form mật khẩu + nhập lại; gợi ý "ít nhất 12 ký tự" (server quyết định, `PASSWORD_MIN_LENGTH`); 204 → thông báo "Đã kích hoạt" + nút Đăng nhập (API không đăng nhập hộ); 400 → "Link đã hết hạn hoặc đã dùng — nhờ Giám đốc tạo lại link"; thiếu token → cùng thông điệp.

### 3.4 Lỗi API → tiếng Việt (`src/lib/problem-messages.ts`)
- Đầu vào `Problem` (`type` là URI, lấy slug cuối; `status`; `errors[{path,message}]`; `request_id`). Bảng: `validation`/422 → "Kiểm tra lại các ô đánh dấu" + lỗi theo ô (nhãn ô tiếng Việt do từng màn cung cấp, không dùng `message` tiếng Anh) ·
  `unauthorized` → phiên hết hạn · `forbidden` → 🔒 "Bạn không có quyền …" · `not-found` · `duplicate` → "Khách này đã có (trùng SĐT/MST)" + nút mở khách đã có (`existing_id`) · `stale` → "Người khác vừa sửa khách này" + "Tải bản mới" ·
  `last-admin` → "Không thể khóa/đổi vai trò tài khoản quản trị cuối cùng" · `already-active` · `invalid-or-expired-token` · `conflict` (email trùng khi mời) · `rate-limited` → "Thử quá nhiều lần, đợi khoảng 1 phút" · `service-unavailable`/5xx/mất mạng → "Hệ thống đang bận, thử lại" (+ "Mã hỗ trợ: request_id" cỡ nhỏ chỉ ở 5xx) · slug lạ → câu chung + Thử lại.
- Riêng đăng nhập: 401 "Email hoặc mật khẩu không đúng" (không nói cái nào sai) · 403 "Tài khoản chưa kích hoạt hoặc đã bị khóa — liên hệ Giám đốc".
- 1 test đơn vị cho bảng này (mọi slug của `ProblemType` → có câu tiếng Việt, không rỗng, không chứa ASCII-only `detail`).

### 3.5 Màn hình (nav theo thứ tự DESIGN.md; 4a chỉ có các màn dưới; Hợp đồng / Mẫu / Chờ tôi duyệt là 4b — sidebar đọc một registry để 4b chỉ thêm mục)
| Màn (URL) | Quyền | Nội dung |
|---|---|---|
| Khách hàng `/khach-hang` | `contract:read` (thêm/sửa: `contract:write`) | thẻ khách: tên, người đại diện, MST, SĐT, email/địa chỉ (chi tiết trong modal); ô tìm (`q`, chờ 300ms); "+ Thêm khách"; "Xem thêm" (`next_cursor`, ≤50/trang). Không có "số hợp đồng / tổng giá trị" (chưa có dữ liệu → 4b) |
| Phân quyền `/phan-quyen` | đăng nhập | bảng quyền × vai trò (● / ○), nhãn tiếng Việt cho mã quyền (lấy `PERMS` trong mockup; mã lạ hiện mã), cột vai trò lấy từ `/roles` (không cố định 3); nhãn vai trò `admin` = "Quản trị hệ thống" |
| Nhật ký `/nhat-ky` | `audit:read` | dòng: biểu tượng · **actor_name** + câu tiếng Việt dựng từ `action`/`target`/`metadata` · mã sự kiện nhỏ · thời gian · IP đầy đủ (DEC-7); `permission.denied` nền `--st-rejected-bg`/chữ `--danger` + 🔒; bộ lọc hành động; "Xem thêm" |
| Người dùng `/nguoi-dung` | `users:read` (thao tác: `users:write`) | bảng (mobile: thẻ): tên hiển thị, email, vai trò, trạng thái; "+ Mời người dùng" (email, tên, vai trò) → hiện `activation_url` + hạn **một lần** + nút Sao chép + lời nhắc gửi qua Zalo; "Tạo lại link" cho người chưa kích hoạt; đổi vai trò; khóa/mở khóa (xác nhận) |
| Đăng nhập · Kích hoạt · 403 | công khai · công khai · — | như §3.3; 403 = 🔒 + lý do + nút về màn được phép |

Trạng thái mỗi màn (DESIGN "States"): Rỗng — một câu + đúng một việc làm tiếp ("Chưa có khách nào — Thêm khách"; tìm không thấy: "Không có khách khớp ‘…’ — Xóa tìm kiếm"); Tải — skeleton hàng/thẻ, không spinner toàn trang; Lỗi — câu §3.4 + Thử lại; 403 — 🔒 thay cho hành động hoặc màn. Hành động không được phép: hiện 🔒 + lý do (vd. nút "Thêm khách" của người thiếu `contract:write`), không để nút chết.

Khách hàng — hành vi:
- Thêm: modal (tên bắt buộc; người đại diện, MST, SĐT, email, địa chỉ tùy chọn); gửi nguyên chuỗi SĐT như gõ (server chuẩn hóa `phone_norm`); ô trống gửi bỏ trống; `Idempotency-Key` (UUID mới mỗi lần mở modal), nút khóa khi đang gửi.
- 409 duplicate → cảnh báo trong modal: "Đã có khách dùng SĐT/MST này: <tên>" + "Xem khách đó" (mở `GET /customers/{existing_id}`); không đóng modal, giữ nội dung đã gõ.
- Sửa: gửi `expected_version`; 409 stale → "Người khác vừa sửa khách này" + "Tải bản mới" (nạp bản mới vào form; nội dung đã gõ không tự ghi đè); thành công → cập nhật thẻ, toast "Đã lưu".
- Danh sách làm mới sau ghi bằng invalidate khóa `["customers"]`.

Nhật ký — câu tiếng Việt cho từng `action` đã biết (`auth.login`, `permission.denied`, `customer.created/updated`, `user.*`…) nằm ở một bảng trong `features/audit`; `action` lạ → "thực hiện <mã>" (mã nhỏ, dạng meta như mockup) — không bao giờ để trống. Không hiển thị `metadata` thô.

Mobile 390px: sidebar → top bar + nút menu mở lớp phủ toàn màn; bảng → thẻ xếp dọc; modal → toàn màn; ma trận giữ dạng bảng nén (không cuộn ngang cả trang); nút/ô nhập cao ≥ 44px; ô SĐT `inputmode="tel"`, email `type=email`, `autocomplete` đúng (`username`, `current-password`, `new-password`).

### 3.6 API dùng (đã có từ row 1, không đổi)
`POST /auth/login` · `POST /auth/logout` · `POST /auth/refresh` (qua client) · `POST /auth/activate` · `GET /me` · `GET /roles` · `GET /audit?action&cursor&limit` · `GET|POST /customers` · `GET|PATCH /customers/{id}` · `GET|POST /admin/users` · `PATCH /admin/users/{id}` · `POST /admin/users/{id}/invite`. Ghi cần `Origin` (trình duyệt tự gửi, cùng origin) + `X-Requested-With: fetch` (client tự thêm).
Đổi API nhỏ (DEC-6): thêm `display_name` vào `GET /me` — card riêng trong PLAN-04a (API → OpenAPI → `pnpm client:generate` cùng commit); chip người dùng dùng email tới khi card này xong. Không cần API mới nào khác.

## 4. Edge cases — mặc định "now" (bạn đổi nếu muốn "later"/"n/a")
| Category | Case here | Decision |
|---|---|---|
| Input | email hoa/thường/khoảng trắng: cắt khoảng trắng trước khi gửi · tên có dấu giữ nguyên · SĐT nhiều dạng gửi như gõ · ô trống → bỏ · mật khẩu nhập lại không khớp → chặn ở client · trình quản lý mật khẩu (autocomplete) hoạt động | now |
| Duplicates & identity | khách trùng SĐT/MST → 409 → §3.5 · mời email đã có → "Email này đã có tài khoản" | now |
| Two people at once | sửa khách cùng lúc → 409 stale (§3.5) · bấm tạo 2 lần / mạng chậm → nút khóa + `Idempotency-Key` · hai tab cùng refresh → client đã xử lý (single-flight); server có cửa sổ 3s | now |
| Failure & retry | mạng đứt / 5xx → §3.4 + Thử lại, giữ nội dung modal · 429 → đợi ~1 phút · refresh hỏng giữa lúc đang gõ form → về `/login?next=`, nội dung form mất (chấp nhận, nêu rõ) | now |
| Permissions / not logged in | chưa đăng nhập vào URL bất kỳ → `/login?next=` · thiếu quyền vào URL → màn 403, không gọi API · 403 từ API (quyền vừa đổi) → 🔒 + tải lại `/me` · người bị khóa → request kế 401 → `/login` · `next` giả mạo (`//evil.com`) → bỏ | now |
| Lifecycle | link kích hoạt hết hạn/đã dùng → §3.3 · đóng hộp "link kích hoạt" là mất link → dùng "Tạo lại link" · `last-admin` → câu §3.4 · khách không có nút xóa · admin tự khóa mình → nút vô hiệu + lý do | now |
| Money | không có tiền ở 4a (giá/hợp đồng thuộc 4b) | n/a |
| Time / dates | `ts` (giây unix) hiển thị giờ VN: "Hôm nay 19:12", ngày khác `dd/mm/yyyy` | now |
| Copy / clipboard | Sao chép link thất bại (không có quyền clipboard) → ô chọn sẵn để tự chép | now |
| Bố cục | tên khách rất dài · nhật ký dài → xuống dòng / cắt có tooltip, không vỡ 390px | now |
| Đa tab đăng xuất | tab khác vẫn hiện app tới lần gọi API kế (→ 401 → `/login`) | later — đồng bộ tức thời cần BroadcastChannel |
| Bộ lọc nhật ký theo người/đối tượng | API có `actor`, `target`; UI chỉ lọc `action` | later — khi có nhu cầu |

## 5. Security
- Who may do what: quyền màn ở §3.5; guard ở SPA chỉ là UX — **API là nơi quyết định** (thử gọi thẳng API vẫn 403 + ghi `permission.denied`). Guard không gọi API màn không có quyền nên không tạo dòng `permission.denied` vô nghĩa.
- Token: không có trong `localStorage`/`sessionStorage`/URL sau khi đọc/biến JS toàn cục; `activation_url` và token kích hoạt chỉ ở bộ nhớ, xóa khỏi thanh địa chỉ (`replaceState`), không log. Không `console.log` dữ liệu khách/email/token/`Problem.detail`; bản build production không `console.*` (lint `no-console`).
- CSRF: cùng origin + cookie `SameSite=Strict` + client tự gửi `X-Requested-With: fetch`; `Origin` do trình duyệt gửi. Dev qua Vite phải ghi đè `Origin` (§3.1) — chỉ trong dev server, không trong bản build.
- XSS: React escape mặc định; cấm `dangerouslySetInnerHTML`; nội dung nhật ký/khách render như văn bản. CSP cho `index.html` qua `_headers` (§3.1).
- Dữ liệu cá nhân: SĐT/email/MST/địa chỉ chỉ hiện cho người có `contract:read`; cache Query xóa khi đăng xuất; không lưu vào URL (ô tìm giữ trong state, không đưa SĐT vào query string).
- Abuse: brute-force đăng nhập (server rate-limit 5/phút — UI hiện 429 dễ hiểu) · open-redirect qua `next` (§3.3) · lộ token qua Referer (đã `replaceState` + `strict-origin-when-cross-origin`).

## 6. Decisions (bạn quyết)
- [DEC-1] Tiền tố URL API vs SPA · options: **A** giữ đường API như hiện tại, liệt kê trong `run_worker_first`, URL màn hình tiếng Việt (`/khach-hang`…) · **B** đổi API sang `/api/*` (SPA tự do đặt tên, mảng chỉ `["/api/*"]`) — chi phí: mount lại toàn bộ route, cookie refresh `Path=/auth` → `/api/auth`, `activation_url`, OpenAPI + client regenerate, mọi test row 1 đã duyệt, Bruno/docs; phải làm trước khi row 2–3 dựng thêm route ·
  **C** `run_worker_first = true`, Worker tự trả asset cho URL lạ — mọi request tĩnh tốn 1 lần chạy Worker, không khuyên · recommended: **A** (không đụng row 1 đã duyệt; rủi ro "quên thêm vào mảng" được test §3.1 chặn) · decided: **A — giữ đường API, liệt kê trong `run_worker_first`, URL màn hình tiếng Việt (`/khach-hang`, `/phan-quyen`, `/nhat-ky`, `/nguoi-dung`, `/activate`) + test đối chiếu OpenAPI ↔ mảng** (bạn chốt 2026-09-29)
- [DEC-2] Màn "Người dùng" trong 4a · options: có (khuyến nghị: nhỏ, dùng lại component; Giám đốc/admin không phải mở Swagger) / hoãn sang row khác (mời qua `/docs`) · recommended: **có**, và bổ sung DESIGN.md thành màn thứ 7 sau khi bạn duyệt · decided: **có — màn Người dùng trong 4a; bổ sung DESIGN.md (màn thứ 7) ở PROOF** (bạn chốt 2026-09-29)
- [DEC-3] Màn không có trong mockup (đăng nhập, kích hoạt, 403, Người dùng) · options: dựng từ FEEL + component sẵn, bạn duyệt ở PROOF / bạn vẽ mockup bổ sung trước · recommended: **dựng từ FEEL rồi duyệt** · decided: **dựng từ FEEL + component sẵn, bạn duyệt ở PROOF** (bạn chốt 2026-09-29)
- [DEC-4] Mục nav không đủ quyền · options: **ẩn** + màn 403 khi vào thẳng URL / hiện mờ kèm 🔒 · recommended: **ẩn** (DESIGN chỉ đòi 🔒 cho *hành động*; nav sạch hơn) · decided: **ẩn mục nav không đủ quyền + màn 403 khi vào thẳng URL** (bạn chốt 2026-09-29)
- [DEC-5] Chạy dev · options: Vite proxy (HMR nhanh, phải ghi đè `Origin`) / build --watch + wrangler dev (đúng hình thật, chậm hơn) · recommended: **proxy để làm, build+wrangler để proof** · decided: **Vite proxy ghi đè `Origin` = `APP_ORIGIN` khi dev; build + wrangler để proof** (bạn chốt 2026-09-29)
- [DEC-6] Chip người dùng hiện tên · options: thêm `display_name` vào `GET /me` (đổi nhỏ API row 1, regenerate client) / dùng email · recommended: **thêm `display_name`** (mockup hiện tên; Nhật ký đã có `actor_name`) — làm như một fix nhỏ ở row 1, không thuộc card web · decided: **thêm `display_name` vào `GET /me` — đổi API nhỏ, card riêng trong PLAN-04a (kèm `pnpm client:generate`)** (bạn chốt 2026-09-29)
- [DEC-7] Nhật ký hiện IP đầy đủ hay che (mockup `27.72.x.x`) · options: đầy đủ (người xem đã có `audit:read`) / che octet cuối · recommended: **đầy đủ** — nhật ký để điều tra; mockup che chỉ để minh họa · decided: **đầy đủ — Nhật ký hiện IP đầy đủ cho người có `audit:read`** (bạn chốt 2026-09-29)
- [DEC-8] Nhãn tiếng Việt của vai trò `admin` (mockup không có cột này) · decided: **"Quản trị hệ thống"** (bạn chốt 2026-09-29)

## 7. Acceptance — kiểm bằng trình duyệt (dev: :5173 hoặc :8787)
- [AC-1] `curl -i localhost:8787/khach-hang` (và `/phan-quyen`, `/nhat-ky`, `/nguoi-dung`, `/activate`) → 200 HTML (SPA); `curl -i localhost:8787/customers` → 401 Problem+JSON (Worker, không phải HTML); `/docs` vẫn mở Swagger; test đối chiếu: mọi path trong OpenAPI khớp một pattern `run_worker_first` (thêm route quên mảng → đỏ) — proves FR-1, DEC-1
- [AC-2] Vào `/khach-hang` khi chưa đăng nhập → `/login?next=/khach-hang`; đăng nhập đúng → về `/khach-hang`; sai mật khẩu → "Email hoặc mật khẩu không đúng"; `next=//evil.com` → bỏ qua — proves FR-4, §4 Permissions
- [AC-3] Link `activation_url` (từ `POST /admin/users` hoặc màn Người dùng) mở `/activate`: thanh địa chỉ không còn `token`; đặt mật khẩu → "Đã kích hoạt" → đăng nhập được; mở lại link đó → thông báo hết hạn/đã dùng — proves FR-5, §4 Lifecycle
- [AC-4] Sau đăng nhập DevTools → Application: không có token trong localStorage/sessionStorage; Cookie `runway_at`/`runway_rt` là HttpOnly; Console không có dữ liệu khách/token — proves §5
- [AC-5] Đợi > 120s (hoặc xóa cookie `runway_at`) rồi bấm chuyển màn → vẫn ở lại app (refresh 1 lần, Network thấy đúng 1 `POST /auth/refresh`); xóa cả `runway_rt` → về `/login` — proves FR-4
- [AC-6] Nhân viên: sidebar không có Nhật ký / Người dùng; vào thẳng `/nhat-ky` → màn 403 có 🔒 + lý do, Network không có `GET /audit`; Giám đốc: thấy Nhật ký, dòng `permission.denied` của Nhân viên màu danger — proves FR-6, FR-10, DEC-4
- [AC-7] Thêm khách SĐT `0901 234 567`, rồi thêm khách khác SĐT `+84901234567` → cảnh báo trùng bằng tiếng Việt + "Xem khách đó"; hai tab cùng sửa 1 khách, lưu tab 1 rồi tab 2 → "Người khác vừa sửa" + "Tải bản mới"; mỗi thao tác có dòng trong Nhật ký — proves FR-8, §4 Duplicates, Two people
- [AC-8] Phân quyền hiển thị khớp `GET /roles` cho cả 3 vai trò + admin; đọc được ở mọi vai trò — proves FR-9
- [AC-9] Ngắt mạng (DevTools offline) rồi bấm Thử lại/lưu → câu "Hệ thống đang bận…", không mã lỗi/tiếng Anh, nội dung modal còn nguyên; xem từng lỗi trong §3.4 không bao giờ thấy `type`/`detail` thô — proves FR-7, FR-12
- [AC-10] Mỗi màn có: skeleton khi tải chậm (DevTools throttling), rỗng có 1 hành động, lỗi có Thử lại — proves FR-12
- [AC-11] Cửa sổ 390px (breakpoint 768px, token trong FEEL.md): sidebar thu thành top bar + menu, bảng thành thẻ, modal toàn màn, không cuộn ngang trang, mục chạm ≥ 44px — proves FR-3, FR-13
- [AC-12] Chỉ dùng phím: Tab qua toàn bộ, Esc đóng modal và trả focus, focus nhìn thấy; bật "reduce motion" → không còn dịch chuyển — proves FR-13
- [AC-13] Mọi màu/spacing trong `dist` đến từ token: `grep -rE "#[0-9a-fA-F]{3,8}" apps/web/src` chỉ trúng `theme.css`; không có giá trị Tailwind tùy ý (`[#..]`, `p-[..px]`) — proves FR-2
- [AC-14] admin mời Nhân viên → link hiện một lần; đóng rồi "Tạo lại link" ra link mới; admin cuối cùng tự khóa → thông báo `last-admin` tiếng Việt; Giám đốc hạ vai trò Quản lý → người đó mất Nhật ký sau lần tải lại kế — proves FR-11, FR-6

Ngân sách chứng minh giao diện (`e2e-kit/README.md`): **tối đa 1 spec smoke** cho 4a (Giám đốc đăng nhập → thêm khách → thấy trùng → Nhật ký có dòng; Nhân viên vào `/nhat-ky` → 403), chạy **một lần** ở PROOF, sau khi suite API xong, chạy trên bản build thật qua wrangler. 1 test đơn vị cho §3.4. Mobile 390px và design law kiểm bằng mắt trên 3 ảnh chụp (Khách hàng · Phân quyền · Nhật ký); e2e đầy đủ + mobile smoke là row 4b. Lỗi nhìn thấy nhỏ → ghi danh sách vào PROOF log, không lặp vòng sửa.

## 8. Tách card gợi ý (file scope rời nhau để chạy song song)
Quy ước: mỗi card chỉ ghi trong thư mục của nó. Cần đổi `src/app`, `src/ui`, `src/lib`, `package.json` hay wrangler → dừng, báo card 001. Mọi dependency cài ở card 001 (React, react-router, @tanstack/react-query, tailwind, font, vitest, testing-library) — sau đó không ai sửa `package.json` trừ card 006 (Playwright).
| Card | Phạm vi file | Phụ thuộc | Xong khi |
|---|---|---|---|
| **C-04a-000** `display_name` trong `GET /me` (DEC-6) | `apps/api` (route/DTO/service `/me`, test), `packages/client` (sinh lại), OpenAPI | — (nhỏ, làm trước hoặc song song 001; đụng API nên tuần tự với 001 ở `packages/client`) | test `/me` có `display_name`; `pnpm client:generate` sạch |
| **C-04a-001** scaffold + token + khung | `apps/web/` gốc (`package.json`, `vite.config.ts` + proxy, `index.html`, `public/_headers`, tsconfig, eslint), `src/main.tsx`, `src/styles/theme.css` (+ thêm breakpoint 768px vào `docs/cookbook/design/FEEL.md`), `src/app/**` (providers, router, layout/sidebar/mobile top bar, guard, `registry` nav+route lấy từ `src/features/*/routes.ts` + `nav.ts`), `src/ui/**`, `src/lib/**` (client singleton, `problem-messages` + test, format tiền/ngày VN, `me` query), **stub** `src/features/{auth,customers,roles,audit,users}/{routes,nav}.ts(x)`; `apps/api/wrangler.toml` (3 env), `scripts/validate-wrangler.ts`, `turbo.json`, test đối chiếu OpenAPI ↔ `run_worker_first`, `pnpm-lock.yaml` | — (đầu tiên; chặn các card sau) | `pnpm build` ra `dist`; AC-1 · AC-13; khung + 403 + guard chạy với trang stub |
| **C-04a-002** đăng nhập + kích hoạt | `src/features/auth/**` | 001 | AC-2 AC-3 AC-4 AC-5 |
| **C-04a-003** Khách hàng | `src/features/customers/**` | 001 | AC-7 (+ AC-9/10 cho màn này) |
| **C-04a-004** Phân quyền + Nhật ký | `src/features/roles/**`, `src/features/audit/**` | 001 | AC-6 (phần Nhật ký) · AC-8 |
| **C-04a-005** Người dùng | `src/features/users/**` | 001, (DEC-2 = có) | AC-14 |
| **C-04a-006** smoke e2e + PROOF | `apps/web/e2e/**`, `apps/web/playwright.config.ts`, devDependency Playwright trong `apps/web/package.json` | 002–005 xong | 1 spec xanh, ảnh chụp 3 màn, PROOF log |
002–005 chạy song song (thư mục rời nhau; router/nav đọc registry nên không ai sửa chung file). Nếu cần component dùng chung mới → đặt tạm trong thư mục feature, xin card 001 đưa lên `src/ui` sau. Review diff + chạy lại `typecheck`/`lint`/test từng card trước khi nhận.

## 9. Trace check (trước STOP)
- [x] mọi FR trỏ tới một OUT (FR-1..13 → OUT-1..8; FR-11 → OUT-7)
- [x] mọi AC chứng minh một FR / edge case "now" / DEC (AC-1 DEC-1 · AC-6 DEC-4 · AC-14 DEC-2)
- [x] mọi edge case "now" có AC: Input/Duplicates/Two people → AC-7 · Failure → AC-9 · Permissions → AC-2 AC-6 · Lifecycle → AC-3 AC-14 · Time → AC-6 (định dạng giờ nhật ký, xem bằng mắt) · Copy/clipboard, Bố cục → AC-11 (kiểm bằng mắt)
- [x] DEC-1..8 đã chốt (2026-09-29); DESIGN.md (màn Người dùng) và FEEL.md (breakpoint 768px) cập nhật theo card/PROOF
- [ ] chờ bạn duyệt SPEC (Status vẫn Draft)
