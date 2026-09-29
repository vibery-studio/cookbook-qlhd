# INTENT-04a: Giao diện nền — đăng nhập, khung app, Khách hàng · Phân quyền · Nhật ký (+ Người dùng)

Status: Approved 2026-09-29
Serves: MAP M5 M6 M7 · Roadmap: ROADMAP-01 row 4a
Asked by: bạn (chủ dự án) · Written: 2026-09-29

## 1. Problem today
- [PRB-1] Row 1 xong nhưng chỉ dùng được qua `/docs` (Swagger): nhân viên không có chỗ đăng nhập; app chưa "mở ra dùng" được.
- [PRB-2] Người được mời nhận `activation_url` (`/activate?token=…`) nhưng chưa có trang nào để mở link và đặt mật khẩu.
- [PRB-3] Khách hàng chỉ có JSON: trùng SĐT/MST (409) hoặc hai người sửa cùng lúc (409 stale) hiện ra mã lỗi, không phải câu người dùng hiểu.
- [PRB-4] "Ai được làm gì" (ma trận quyền) và "ai đã làm gì, ai bị chặn" (nhật ký, `permission.denied`) chưa nhìn thấy được với người không phải dev.
- [PRB-5] Việc mời / đổi vai trò / khóa người dùng chỉ có API; Giám đốc/admin phải gọi Swagger. Màn này KHÔNG nằm trong 6 màn của DESIGN.md → xem Q-1.

## 2. Outcome — what "better" looks like
- [OUT-1] Người dùng đăng nhập / đăng xuất bằng email + mật khẩu; phiên tự gia hạn khi hết hạn ngắn hạn; hết hẳn thì quay về đăng nhập ← PRB-1 · xem: `/login`
- [OUT-2] Người được mời mở link, đặt mật khẩu, đăng nhập được ngay sau đó ← PRB-2 · xem: `/activate?token=…`
- [OUT-3] Khung app đúng design law (sidebar, chip người dùng + vai trò, mobile 390px); mỗi người chỉ thấy màn đúng quyền, vào thẳng URL không quyền thì thấy giải thích 🔒 ← PRB-1 PRB-4 · xem: sidebar + URL trực tiếp
- [OUT-4] Khách hàng: xem, tìm, thêm, sửa; trùng và bị sửa trước được báo bằng câu tiếng Việt kèm việc làm tiếp ← PRB-3 · xem: màn Khách hàng
- [OUT-5] Phân quyền: ma trận vai trò × quyền chỉ đọc, khớp `GET /roles` ← PRB-4 · xem: màn Phân quyền
- [OUT-6] Nhật ký: mới nhất trước, `permission.denied` màu danger, chỉ người có `audit:read` thấy ← PRB-4 · xem: màn Nhật ký (sau khi một Nhân viên bị chặn)
- [OUT-7] (nếu Q-1 = có) Người dùng: admin/Giám đốc mời, đổi vai trò, khóa/mở khóa; link kích hoạt hiện đúng một lần ← PRB-5 · xem: màn Người dùng
- [OUT-8] Mọi lỗi từ API hiện bằng tiếng Việt dễ hiểu, không lộ mã lỗi thô ← PRB-3 · xem: thử từng lỗi ở SPEC-04a §4

## 3. Who and what it touches
- People: Nhân viên · Quản lý · Giám đốc (đăng nhập, Khách hàng, Phân quyền) · Quản lý + Giám đốc + admin (Nhật ký) · admin + Giám đốc (Người dùng).
- Data: dữ liệu cá nhân của khách (SĐT, email, MST, địa chỉ) hiển thị cho người có `contract:read`; IP trong nhật ký; email người dùng. Không lưu token ở trình duyệt.

## 4. Out of scope
- Màn Hợp đồng · Mẫu · Chờ tôi duyệt · bản in · e2e đầy đủ (row 4b). Số hợp đồng / tổng giá trị trên thẻ khách (chưa có hợp đồng → 4b).
- Quên mật khẩu / đổi mật khẩu (chưa có API trong row 1) · sửa bảng giá · nhập khách từ Excel · giao diện tối.

## 5. Open questions (answered before the SPEC is approved)
- [Q-1] Màn "Người dùng" (không có trong DESIGN.md) có làm trong 4a không? Khuyến nghị: **có** — nhỏ, chỉ dựng từ token/component có sẵn, gắn `users:read/write`; không có nó thì mời người vẫn phải qua Swagger. Cách khác: hoãn, mời qua `/docs`. → answer: **có** (bạn chốt 2026-09-29)
- [Q-2] Trang đăng nhập / kích hoạt / 403 / Người dùng không có trong mockup: dựng từ FEEL rồi bạn duyệt ở PROOF? Khuyến nghị: **có**; sau OK thì bổ sung vào DESIGN.md. → answer: **có** (bạn chốt 2026-09-29)
- [Q-3] Route API và route SPA cùng tên (`/customers`, `/audit`…) — xem SPEC-04a DEC-1 (khuyến nghị: URL màn hình đặt tên tiếng Việt, không đổi tiền tố API). → answer: **URL màn hình tiếng Việt, API giữ nguyên** (bạn chốt 2026-09-29)
