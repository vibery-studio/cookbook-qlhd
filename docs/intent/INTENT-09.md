# INTENT-09: Nhiều loại tài liệu — Báo giá → Hợp đồng → Đề nghị thanh toán, mỗi loại số riêng (+ Phiếu xuất kho)

Status: Approved 2026-10-01
Serves: MAP M1–M3 (+ M9 mới: Nhân viên lập tài liệu kế tiếp từ tài liệu trước; mỗi loại có tiền tố + dãy số riêng) · Roadmap: ROADMAP-02 row 4
Asked by: bạn (phiên feedback 2026-10-01) · Written: 2026-10-01

## 1. Problem today
- [PRB-1] Báo giá và Đề nghị thanh toán làm tay bằng Word (`07_Mau_Tai_Lieu/Bao_Gia.docx`, `De_Nghi_Thanh_Toan.docx`): mỗi bước BG → HĐ → DNTT gõ lại tên khách, gói, số lượng, giá; DNTT có khi lệch số tiền so với hợp đồng.
- [PRB-2] App chỉ có một loại "hợp đồng" (số HD-YYYY-NNN); BG/DNTT không có số liên tục, không qua duyệt, không truy được BG nào thành HĐ nào, HĐ nào được đề nghị thanh toán.
- [PRB-3] Hàng hóa (máy in, giấy — có từ row 3) giao cho khách không có phiếu xuất kho đúng mẫu kế toán.

## 2. Outcome
- [OUT-1] Nhân viên bấm một lần từ tài liệu trước là ra nháp tài liệu kế tiếp đã điền sẵn: HĐ từ BG (giữ nguyên dòng hàng + giá của BG), DNTT từ HĐ đã phát hành (số tiền = tổng thanh toán HĐ); không gõ lại khách/dòng/giá ← PRB-1 · nhìn ở: form nháp + bản in cùng số với tài liệu cha
- [OUT-2] Mỗi loại (BG · HD · DNTT · PXK) có tiền tố + dãy số riêng theo năm từ 001, liên tục, không trùng (BG-2026-001, DNTT-2026-001…) ← PRB-2
- [OUT-3] Mọi loại đi chung luồng HĐ hiện nay: nháp → gửi duyệt → duyệt (không tự duyệt; giảm >10% cần Giám đốc) → phát hành lấy số → bản in đóng băng; sai thì hủy giữ số; nhật ký đủ ← PRB-2
- [OUT-4] Tài liệu thấy được cha/con của nó (BG → HĐ → DNTT) ← PRB-2 · nhìn ở: drawer tài liệu
- [OUT-5] PXK in đúng mẫu 02-VT (mình soạn theo chuẩn kế toán, DEMO), lập độc lập từ dòng hàng hóa ← PRB-3

## 3. Who and what it touches
- People: Nhân viên (lập) · Quản lý, Giám đốc (duyệt, phát hành) · bạn/Giám đốc (mẫu mỗi loại, quyền theo loại nếu cần).
- Data: mô hình `contract` tổng quát thành tài liệu có loại (đổi mô hình dữ liệu — expand/contract) · dãy số theo loại · liên kết cha–con · mẫu mỗi loại · tiền (BG/DNTT chép giá, không tính lại). Dữ liệu hiện có là demo — wipe/seed lại.

## 4. Out of scope
- Theo dõi đã thu tiền, công nợ, đối soát ngân hàng — DNTT chỉ là giấy đề nghị.
- Tồn kho cho PXK — in phiếu, không trừ tồn.
- Gửi tài liệu cho khách từ app (email/Zalo) — in hoặc tải PDF rồi tự gửi.
- Nhiều đợt thanh toán (đặt cọc, trả góp) — mỗi HĐ một DNTT bằng tổng HĐ.
- Nhập mẫu `.docx` — row 5.

## 5. Open questions
- [Q-1] Đau nhất hôm nay? → answer: **gõ lại, sai số giữa BG → HĐ → DNTT** (bạn chốt 2026-10-01)
- [Q-2] Chuỗi nào chạy được trong row này? → answer: **đủ BG → HĐ → DNTT; PXK lập độc lập** (bạn chốt)
- [Q-3] BG/DNTT có cần duyệt? → answer: **cùng luồng HĐ (duyệt + phát hành lấy số, giảm >10% cần GĐ — áp cả BG)** (bạn chốt)
- [Q-4] Ngoài phạm vi? → answer: **thu tiền, tồn kho, gửi cho khách, nhiều đợt thanh toán** (bạn chốt)
- [Q-5] (SPEC) BG hết hiệu lực 15 ngày (theo mẫu box): HĐ lập từ BG đã quá hạn — chặn, cảnh báo, hay lấy giá hiện hành? → hỏi ở SPEC.
- [Q-6] (SPEC) Một BG/HĐ sinh được mấy con (1 HĐ từ 1 BG? HĐ hủy thì lập lại từ cùng BG?) → hỏi ở SPEC.
