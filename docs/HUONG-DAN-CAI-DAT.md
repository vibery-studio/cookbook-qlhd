# Hướng dẫn cài đặt — Quản lý hợp đồng (bản demo)

Ứng dụng quản lý hợp đồng cho nhóm nhỏ: Nhân viên tạo hợp đồng từ mẫu, Quản lý và Giám đốc duyệt (cơ chế duyệt 2 lớp), Quản lý hoặc Giám đốc phát hành với số liên tục, mọi thao tác đều được ghi nhật ký.
Mã nguồn: https://github.com/vibery-studio/cookbook-qlhd · Bản chạy thử: https://runway-api-prod.bnqtoan.workers.dev

Tài liệu này có hai phần: **A. chạy trên máy của bạn** và **B. đưa lên Cloudflare**. Dữ liệu trong repo là dữ liệu demo.

---

## 0. Tổng quan nhanh

| Thành phần | Công nghệ | Thư mục |
|---|---|---|
| API (Worker) | Cloudflare Workers + Hono + D1 (SQLite) + KV + Queues + R2 | `apps/api` |
| Giao diện | React 19 + Vite | `apps/web` |
| Gói dùng chung | auth, rbac, client (sinh tự động), contracts (OpenAPI), email-templates | `packages/*` |
| Lệnh quản lý | pnpm 10.28 + turbo, Node 22 | gốc repo |

Khi chạy thật, **một Worker phục vụ cả API lẫn giao diện** (giao diện build sẵn vào `apps/web/dist`, Worker trả file tĩnh).

Ba vai trò nghiệp vụ: **Nhân viên · Quản lý · Giám đốc**. Ngoài ra có `admin` (quản trị hệ thống, IT) và `root` (chỉ tạo bằng công cụ cài đặt, dùng để bật/tắt cơ chế duyệt 2 lớp).

---

# A. Chạy trên máy của bạn

## A1. Cần có

- **Node 22** (`node -v` phải ra v22.x). Dùng `nvm use` vì repo có `.nvmrc`.
- **pnpm 10.28**: `corepack enable && corepack prepare pnpm@10.28.2 --activate`.
- **Git**.
- Không cần tài khoản Cloudflare để chạy local: Wrangler dựng D1, KV, Queues giả lập trong thư mục `.wrangler`.

## A2. Lấy mã và cài thư viện

```bash
git clone https://github.com/vibery-studio/cookbook-qlhd.git
cd cookbook-qlhd
pnpm install --frozen-lockfile
```

## A3. Tạo file bí mật cho môi trường dev

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Mở `apps/api/.dev.vars`, thay ba dòng bằng giá trị ngẫu nhiên (mỗi dòng một giá trị khác nhau):

```bash
openssl rand -hex 32     # dán vào JWT_SECRET
openssl rand -hex 32     # dán vào TOKEN_PEPPER
openssl rand -hex 16     # dán vào READYZ_TOKEN
```

File `.dev.vars` đã nằm trong `.gitignore`, **không bao giờ commit**.

## A4. Tạo cơ sở dữ liệu local và dữ liệu demo

```bash
pnpm db:migrate:local                   # tạo bảng (kèm 6 sản phẩm demo + giá)
RUNWAY_LOCAL=1 pnpm dev:seed-team       # 5 tài khoản demo, mật khẩu mặc định: correct-horse-battery-staple
```

Muốn đặt mật khẩu khác: `RUNWAY_LOCAL=1 pnpm dev:seed-team --password 'mat-khau-cua-ban-12-ky-tu'`.

Reset dữ liệu local (không dùng `pnpm dev:reset`): `mv apps/api/.wrangler/state /tmp/state-$(date +%H%M%S)` rồi chạy lại `pnpm db:migrate:local` và lệnh seed.

## A5. Chạy

Mở **hai terminal**:

```bash
# Terminal 1 — API + trang tĩnh, cổng 8787
pnpm dev

# Terminal 2 — giao diện có hot-reload, cổng 5173 (tự chuyển tiếp API sang 8787)
cd apps/web && pnpm dev
```

Mở http://localhost:5173 để dùng ứng dụng. Mở http://localhost:8787/docs để xem Swagger (chỉ bật ngoài môi trường production).

> Cổng 8788 trên máy bạn thuộc dự án khác, đừng dừng nó. Chỉ dừng tiến trình của chính bạn.

## A6. Tài khoản demo local

| Email | Vai trò | Dùng để |
|---|---|---|
| `nhanvien@runway.local` | Nhân viên | tạo, sửa, nộp hợp đồng |
| `quanly@runway.local` | Quản lý | duyệt, phát hành, xem nhật ký, quản lý sản phẩm và giá |
| `giamdoc@runway.local` | Giám đốc | duyệt (chiết khấu trên 10% bắt buộc Giám đốc), quản lý mẫu hợp đồng, phân quyền |
| `admin@runway.local` | Admin (IT) | người dùng, cài đặt, cờ hệ thống |
| `root@runway.local` | Root | bật/tắt cơ chế duyệt 2 lớp ở màn Bảo mật |

## A7. Kiểm tra chất lượng

```bash
pnpm lint && pnpm typecheck && pnpm build
CI=true pnpm test        # luôn đặt CI=true: chạy song song nhiều miniflare sẽ hết cổng
```

Chạy một file test: `CI=true pnpm --filter @runway/api exec vitest run test/integration/<ten>.test.ts`.

---

# B. Đưa lên Cloudflare (bản demo)

## B1. Cần có

- Tài khoản Cloudflare và `wrangler` đã đăng nhập (`npx wrangler whoami` ra đúng tài khoản). Nếu đăng nhập nhiều tài khoản, luôn đặt:
  ```bash
  export CLOUDFLARE_ACCOUNT_ID=<id tài khoản của bạn>
  ```
  Tài khoản demo hiện tại: `5cbaf7492795d0e9eafa26240b14389c`. Id này nằm sẵn trong `apps/api/wrangler.toml`.
- Dịch vụ **Browser Rendering** (để tạo PDF hợp đồng) cần gói Workers phù hợp. Nếu chưa bật, mọi chức năng khác vẫn chạy, chỉ nút "Tải PDF" lỗi.

## B2. Tài nguyên đã có / cần tạo

| Tài nguyên | Tên | Ghi chú |
|---|---|---|
| D1 | `runway_prod` | đã tạo |
| KV | `SESSIONS`, `SETTINGS` | id khai báo trong `wrangler.toml` |
| R2 | `hopdong-files-prod` | tạo tay (PDF hợp đồng) |
| Queues | `email-retry`, `email-dlq` | tạo tay |
| Secrets | `JWT_SECRET`, `TOKEN_PEPPER`, `READYZ_TOKEN` | đặt sau lần deploy đầu |

Địa chỉ ứng dụng phải khớp biến `APP_ORIGIN` trong `apps/api/wrangler.toml` (mục `[env.production.vars]`). Hiện là `https://runway-api-prod.bnqtoan.workers.dev` (`<tên-worker>.<subdomain-tài-khoản>.workers.dev`). **Sai giá trị này thì mọi thao tác ghi đều bị 403.** Nếu dùng tên miền riêng, sửa cả `APP_ORIGIN`.

## B3. Deploy lần đầu (đúng thứ tự)

Worker chưa tồn tại thì chưa đặt secret được, và `pnpm deploy:prod` đòi sẵn secret, nên lần đầu phải đi đường thủ công. Chạy từ gốc repo:

```bash
export CLOUDFLARE_ACCOUNT_ID=5cbaf7492795d0e9eafa26240b14389c

# 1. R2 + queues (bỏ qua lệnh nào báo "đã tồn tại")
(cd apps/api && npx wrangler r2 bucket create hopdong-files-prod)
(cd apps/api && npx wrangler queues create email-retry)
(cd apps/api && npx wrangler queues create email-dlq)

# 2. Build giao diện, tạo bảng trên D1 production
pnpm --filter @runway/web build
pnpm db:migrate:prod

# 3. Deploy lần đầu (chưa có secret nên /readyz chưa xanh là bình thường)
(cd apps/api && npx wrangler deploy --env production --var BUILD_SHA:$(git rev-parse HEAD))

# 4. Đặt ba bí mật (mỗi lệnh sẽ hỏi giá trị, dán chuỗi `openssl rand -hex 32`)
(cd apps/api && npx wrangler secret put JWT_SECRET --env production)
(cd apps/api && npx wrangler secret put TOKEN_PEPPER --env production)
(cd apps/api && npx wrangler secret put READYZ_TOKEN --env production)

# 5. Kiểm tra
curl -s https://runway-api-prod.bnqtoan.workers.dev/healthz
# mong đợi: {"ok":true,"build_sha":"..."}
```

### Lưu ba bí mật ở đâu

Cloudflare **không cho đọc lại** secret đã đặt. Hãy lưu vào trình quản lý mật khẩu (1Password...) hoặc Keychain:

```bash
security add-generic-password -a "$USER" -s runway-readyz -w '<giá trị READYZ_TOKEN>'
# lần deploy sau:
READYZ_TOKEN="$(security find-generic-password -a "$USER" -s runway-readyz -w)" pnpm deploy:prod
```

Quên `READYZ_TOKEN` thì tạo cái mới và `secret put` lại (không ảnh hưởng gì khác). **Đừng đổi `JWT_SECRET`** nếu không muốn mọi phiên đăng nhập bị đăng xuất, **đừng đổi `TOKEN_PEPPER`** nếu không muốn mọi token mời/xác minh/làm mới đang lưu hết hiệu lực. Không ghi bí mật vào repo (repo này công khai).

## B4. Nạp dữ liệu demo lên D1 production

Sản phẩm và bảng giá demo đã nằm sẵn trong migration `0022_seed_products.sql`, nên bước 2 ở trên đã nạp. Chỉ còn **tài khoản**. Chọn một mật khẩu demo của riêng bạn (tối thiểu 12 ký tự) rồi chạy từ gốc repo:

```bash
export CLOUDFLARE_ACCOUNT_ID=5cbaf7492795d0e9eafa26240b14389c
DEMO_PASSWORD='mat-khau-demo-cua-ban' pnpm demo:seed-remote --dry-run   # xem sẽ tạo gì
DEMO_PASSWORD='mat-khau-demo-cua-ban' pnpm demo:seed-remote             # ghi thật
```

Script tạo năm tài khoản như bảng ở A6 (cùng email `@runway.local`) với mật khẩu bạn đặt. Chạy lại an toàn: tài khoản đã có thì giữ mật khẩu cũ. **Không có mật khẩu mặc định** vì repo công khai, mật khẩu mặc định sẽ là mật khẩu công khai.

Thêm tài khoản thật sau này: đăng nhập `giamdoc@runway.local` hoặc `admin@runway.local`, vào màn Người dùng, mời bằng email. Vì `EMAIL_PROVIDER=noop`, hệ thống **không gửi email**; thay vào đó màn mời hiển thị đường dẫn kích hoạt, bạn gửi cho người đó.

## B5. Kiểm tra sau khi lên

1. `GET /healthz` ra `ok:true`, `build_sha` đúng commit.
2. Mở https://runway-api-prod.bnqtoan.workers.dev, đăng nhập `nhanvien@runway.local`.
3. Tạo hợp đồng từ mẫu → nộp duyệt → đăng nhập `quanly@runway.local` duyệt → phát hành, kiểm tra số hợp đồng.
4. Đăng nhập `root@runway.local`, vào màn Bảo mật, thử bật/tắt cơ chế duyệt 2 lớp.

## B6. Các lần deploy sau

```bash
git pull
READYZ_TOKEN=<giá trị đã lưu> pnpm deploy:prod
```

Lệnh này tự chạy chuỗi: kiểm tra trước (binding, kích thước, secret) → ghi điểm khôi phục D1 → migrate → deploy → verify; verify lỗi thì **tự quay về bản cũ**. Chi tiết: `docs/deploy.md`.

## B7. Tự động hóa bằng GitHub Actions (chưa bật)

Hiện CI (`.github/workflows/ci.yml`) chỉ chạy lint, typecheck, test, build, gitleaks. Workflow `deploy.yml` chỉ chạy tay (`workflow_dispatch`). Muốn tự deploy khi đẩy lên `main` cần:
1. Tạo API token Cloudflare giới hạn quyền (Workers, D1, KV, R2, Queues của đúng tài khoản).
2. `gh secret set CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID` cho repo.
3. Cân nhắc kỹ: bản demo công khai tự deploy nghĩa là mọi thay đổi vào `main` lên thẳng môi trường đang chạy. Dự án mặc định chủ trương deploy tay từ máy người vận hành.

---

# C. Xử lý sự cố đã gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Required Worker name missing` | chạy `wrangler` ngoài thư mục `apps/api` | `cd apps/api` hoặc thêm `--config apps/api/wrangler.toml` |
| `Worker "runway-api-prod" (env: production) not found` | Worker chưa deploy lần nào | làm B3 bước 3 trước, rồi mới `secret put` |
| Mọi thao tác ghi báo 403 | `APP_ORIGIN` không khớp địa chỉ đang truy cập | sửa `APP_ORIGIN` trong `wrangler.toml`, deploy lại |
| Tải PDF lỗi | Browser Rendering/R2 chưa sẵn sàng | tạo bucket `hopdong-files-prod`, bật Browser Rendering cho tài khoản |
| Test báo hết cổng / lỗi miniflare | chạy song song | luôn `CI=true`, chạy từng file |
| `pnpm demo:seed-remote` báo thiếu `DEMO_PASSWORD` | chưa đặt biến môi trường | đặt mật khẩu ≥ 12 ký tự ngay trước lệnh |
| `wrangler` hỏi chọn tài khoản | đăng nhập nhiều tài khoản | `export CLOUDFLARE_ACCOUNT_ID=...` |

---

# D. Lưu ý bảo mật cho bản demo công khai

- **Mọi người có đường dẫn đều mở được trang đăng nhập.** Đừng đưa dữ liệu khách thật vào. Chỉ chia sẻ mật khẩu demo cho người cần xem.
- Hai khóa `SESSIONS` và `SETTINGS` (KV) đang dùng chung id giữa môi trường dev, preview và production. Với demo một môi trường thì không sao; nếu dựng thêm preview, tạo KV riêng.
- Email đang tắt (`noop`). Bật email thật cần cấu hình `EMAIL_PROVIDER` và `RESEND_API_KEY` (xem `docs/email.md`).
- Kết quả quét bảo mật gần nhất (`FIX-07`, `FIX-08`) đã sửa hai lỗi: tái mời tài khoản đặc quyền đang chờ kích hoạt và lộ `password_hash` khi xuất dữ liệu. Phần còn hoãn của đợt quét được ghi ở báo cáo quét, chưa kiểm hết.

# E. Gỡ bản demo

```bash
cd apps/api
npx wrangler delete --env production --name runway-api-prod
npx wrangler d1 delete runway_prod
npx wrangler r2 bucket delete hopdong-files-prod
npx wrangler queues delete email-retry && npx wrangler queues delete email-dlq
```

Các lệnh này xóa dữ liệu thật và không hoàn tác được. Đọc kỹ tên trước khi chạy.
