-- SPEC-09 FR-13 / §3.1 "Mẫu seed" (PLAN-09 §2b, C-09-005): one seed template per document type + contract template v3.
-- INSERT/UPDATE only — template_versions is append-only (trigger 0012). created_by NULL = system, audit actor NULL (as 0013/0023).
-- approval_policy of all four = v2's verbatim (DEC-9 A): "Quản lý duyệt" + discount_bps > 1000 → "Giám đốc duyệt".
-- Bên A facts, bank account and wording come from the box (07_Mau_Tai_Lieu: Bao_Gia.docx, De_Nghi_Thanh_Toan.docx).
--
-- 1) Báo giá v1 (type quote). Money block = SPEC-08 (pre-tax · discount · VAT by rate · payable total + words); the box's
--    "Tổng cộng (đã gồm VAT)" is NOT used (PLAN-09 R-8). Validity "đến hết ngày" = derived:valid_until (doc_date + 15, DEC-5).
INSERT INTO `templates` (`id`, `type`, `name`, `name_norm`, `subject_type`, `current_version_id`, `active`, `created_by`, `created_at`, `updated_at`)
VALUES ('01K6D0CTYPE0000000000BG001', 'quote', 'Báo giá phần mềm quản lý bán hàng', 'báo giá phần mềm quản lý bán hàng', 'customer', '01K6D0CTYPE0000000000BGV01', 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
INSERT INTO `template_versions` (`id`, `template_id`, `version_no`, `body`, `fields`, `default_line_items`, `default_clauses`, `approval_policy`, `field_rules`, `note`, `created_by`, `created_at`)
VALUES ('01K6D0CTYPE0000000000BGV01', '01K6D0CTYPE0000000000BG001', 1, '<p class="b">CÔNG TY TNHH PHẦN MỀM NHẬT MINH</p>
<p>Địa chỉ: 25 Nguyễn Văn Trỗi, Phường Phú Nhuận, TP. Hồ Chí Minh</p>
<p>Điện thoại: 028 3997 2468 · Email: kinhdoanh@nhatminh.vn</p>
<h1 class="center">BÁO GIÁ</h1>
<p class="center">Số: {{so_bao_gia}} · Ngày: {{ngay_bao_gia}}</p>
<p>Kính gửi: {{ten_khach}} — {{ten_cua_hang}}</p>
<p>Điện thoại: {{sdt}} · Email: {{email}}</p>
<p>Nhật Minh xin gửi Quý khách báo giá phần mềm quản lý bán hàng như sau:</p>
{{bang_hang}}
<p>Tiền trước thuế: {{tien_truoc_thue}} đồng · giảm giá {{giam_gia}}% ({{tien_giam_gia}} đồng) · thuế GTGT ({{thue_suat}}): {{tien_thue}} đồng.</p>
<p><strong>Tổng thanh toán: {{tong_thanh_toan}} đồng</strong> (bằng chữ: {{tong_thanh_toan_bang_chu}}).</p>
<p>Báo giá có hiệu lực 15 ngày, đến hết ngày {{hieu_luc_den}}.</p>
<p>Nhân viên phụ trách: {{nhan_vien}}</p>', '[{"key":"so_bao_gia","label":"Số báo giá","type":"text","required":false,"source":"issue:number"},{"key":"ngay_bao_gia","label":"Ngày báo giá","type":"date","required":true,"source":"derived:doc_date"},{"key":"ten_khach","label":"Người nhận báo giá","type":"text","required":true,"source":"subject:contact_person"},{"key":"ten_cua_hang","label":"Tên cửa hàng","type":"text","required":true,"source":"subject:name"},{"key":"sdt","label":"Điện thoại","type":"text","required":true,"source":"subject:phone"},{"key":"email","label":"Email","type":"text","required":true,"source":"subject:email"},{"key":"bang_hang","label":"Bảng dòng hàng","type":"lines","required":true,"source":"derived:lines_table"},{"key":"giam_gia","label":"Giảm giá (%)","type":"percent","required":true,"source":"manual","default":0},{"key":"tien_truoc_thue","label":"Tiền trước thuế","type":"money","required":true,"source":"derived:subtotal_ex_vat"},{"key":"tien_giam_gia","label":"Tiền giảm giá","type":"money","required":true,"source":"derived:discount_amount"},{"key":"thue_suat","label":"Thuế suất","type":"text","required":true,"source":"derived:vat_rates"},{"key":"tien_thue","label":"Tiền thuế GTGT","type":"money","required":true,"source":"derived:vat_total"},{"key":"tong_thanh_toan","label":"Tổng thanh toán","type":"money","required":true,"source":"derived:total"},{"key":"tong_thanh_toan_bang_chu","label":"Bằng chữ","type":"text","required":true,"source":"derived:total_in_words"},{"key":"hieu_luc_den","label":"Hiệu lực đến","type":"date","required":true,"source":"derived:valid_until"},{"key":"nhan_vien","label":"Nhân viên phụ trách","type":"text","required":true,"source":"creator:name"}]', '[]', '[]', '{"mode":"combined","steps":[{"step_no":1,"label":"Quản lý duyệt","permission":"contract:approve"}],"rules":[{"when":{"var":"discount_bps","op":"gt","value":1000},"add_steps":[{"label":"Giám đốc duyệt","permission":"contract:approve","role":"giam_doc"}]}]}', '[]', 'Báo giá: dòng hàng, khối tiền SPEC-08, hiệu lực 15 ngày (SPEC-09).', NULL, CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
INSERT INTO `audit_events` (`id`, `ts`, `actor`, `action`, `target`, `metadata`, `ip`)
VALUES ('01AUDT00000000000TPLSEED03', CAST(strftime('%s','now') AS INTEGER), NULL, 'template.created', 'template:01K6D0CTYPE0000000000BG001', '{"version_no":1,"fields":16}', NULL);
--> statement-breakpoint
-- 2) Đề nghị thanh toán v1 (type payment_request) — only ever a child of an issued contract (DEC-8 A). Lines + money block are
--    the contract's, copied verbatim; amount requested = contract total (derived:amount_requested*); due = doc_date + 7.
--    The bank account is body text (data of the template, never taken from a request — SPEC-09 §5). No manual field.
INSERT INTO `templates` (`id`, `type`, `name`, `name_norm`, `subject_type`, `current_version_id`, `active`, `created_by`, `created_at`, `updated_at`)
VALUES ('01K6D0CTYPE0000000000DN001', 'payment_request', 'Đề nghị thanh toán', 'đề nghị thanh toán', 'customer', '01K6D0CTYPE0000000000DNV01', 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
INSERT INTO `template_versions` (`id`, `template_id`, `version_no`, `body`, `fields`, `default_line_items`, `default_clauses`, `approval_policy`, `field_rules`, `note`, `created_by`, `created_at`)
VALUES ('01K6D0CTYPE0000000000DNV01', '01K6D0CTYPE0000000000DN001', 1, '<p class="b">CÔNG TY TNHH PHẦN MỀM NHẬT MINH</p>
<p>Địa chỉ: 25 Nguyễn Văn Trỗi, Phường Phú Nhuận, TP. Hồ Chí Minh</p>
<p>Điện thoại: 028 3997 2468 · Email: kinhdoanh@nhatminh.vn</p>
<h1 class="center">ĐỀ NGHỊ THANH TOÁN</h1>
<p class="center">Số: {{so_de_nghi}} · Ngày: {{ngay_de_nghi}}</p>
<p>Kính gửi: {{ten_khach}} — {{ten_cua_hang}}</p>
<p>Căn cứ hợp đồng số {{so_hop_dong}} ngày {{ngay_hop_dong}}, Nhật Minh đề nghị Quý khách thanh toán:</p>
{{bang_hang}}
<p>Tiền trước thuế: {{tien_truoc_thue}} đồng · giảm giá {{tien_giam_gia}} đồng · thuế GTGT ({{thue_suat}}): {{tien_thue}} đồng · tổng thanh toán: {{tong_thanh_toan}} đồng.</p>
<p><strong>Số tiền đề nghị thanh toán: {{so_tien_de_nghi}} đồng</strong> (bằng chữ: {{so_tien_de_nghi_bang_chu}}).</p>
<p>Tài khoản: 0071 0004 58213 · Vietcombank · Chủ tài khoản: CÔNG TY TNHH PHẦN MỀM NHẬT MINH</p>
<p>Nội dung chuyển khoản: NM {{so_de_nghi}}</p>
<p>Hạn thanh toán: {{han_thanh_toan}}</p>', '[{"key":"so_de_nghi","label":"Số đề nghị","type":"text","required":false,"source":"issue:number"},{"key":"ngay_de_nghi","label":"Ngày đề nghị","type":"date","required":true,"source":"derived:doc_date"},{"key":"ten_khach","label":"Người đại diện khách","type":"text","required":true,"source":"subject:contact_person"},{"key":"ten_cua_hang","label":"Tên cửa hàng","type":"text","required":true,"source":"subject:name"},{"key":"so_hop_dong","label":"Số hợp đồng","type":"text","required":true,"source":"parent:number"},{"key":"ngay_hop_dong","label":"Ngày hợp đồng","type":"date","required":true,"source":"parent:doc_date"},{"key":"bang_hang","label":"Bảng dòng hàng","type":"lines","required":true,"source":"derived:lines_table"},{"key":"tien_truoc_thue","label":"Tiền trước thuế","type":"money","required":true,"source":"derived:subtotal_ex_vat"},{"key":"tien_giam_gia","label":"Tiền giảm giá","type":"money","required":true,"source":"derived:discount_amount"},{"key":"thue_suat","label":"Thuế suất","type":"text","required":true,"source":"derived:vat_rates"},{"key":"tien_thue","label":"Tiền thuế GTGT","type":"money","required":true,"source":"derived:vat_total"},{"key":"tong_thanh_toan","label":"Tổng thanh toán","type":"money","required":true,"source":"derived:total"},{"key":"so_tien_de_nghi","label":"Số tiền đề nghị thanh toán","type":"money","required":true,"source":"derived:amount_requested"},{"key":"so_tien_de_nghi_bang_chu","label":"Số tiền đề nghị (bằng chữ)","type":"text","required":true,"source":"derived:amount_requested_in_words"},{"key":"han_thanh_toan","label":"Hạn thanh toán","type":"date","required":true,"source":"derived:payment_due"}]', '[]', '[]', '{"mode":"combined","steps":[{"step_no":1,"label":"Quản lý duyệt","permission":"contract:approve"}],"rules":[{"when":{"var":"discount_bps","op":"gt","value":1000},"add_steps":[{"label":"Giám đốc duyệt","permission":"contract:approve","role":"giam_doc"}]}]}', '[]', 'Đề nghị thanh toán 100% hợp đồng: dòng + khối tiền chép từ hợp đồng, hạn 7 ngày (SPEC-09).', NULL, CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
INSERT INTO `audit_events` (`id`, `ts`, `actor`, `action`, `target`, `metadata`, `ip`)
VALUES ('01AUDT00000000000TPLSEED04', CAST(strftime('%s','now') AS INTEGER), NULL, 'template.created', 'template:01K6D0CTYPE0000000000DN001', '{"version_no":1,"fields":15}', NULL);
--> statement-breakpoint
-- 3) Phiếu xuất kho v1 (type delivery_note) — DEMO layout of form 02-VT (DEC-12 A: unit price / amount / "Thực xuất" left
--    blank for the accountant; DEC-13 A: Thông tư 99/2025/TT-BTC). Goods table = derived:goods_table (type `goods`).
--    "Bộ phận", warehouse and place are not in the box → DEMO labels / free text (PLAN-09 R-8).
--    TODO(build): đối chiếu từng nhãn với Phụ lục I Thông tư 99/2025/TT-BTC chính thức (mẫu 02-VT).
--    TODO(hỏi Nhật Minh): công ty áp chế độ kế toán Thông tư 99/2025 hay Thông tư 133/2016? (chỉ khác dòng "kèm theo").
INSERT INTO `templates` (`id`, `type`, `name`, `name_norm`, `subject_type`, `current_version_id`, `active`, `created_by`, `created_at`, `updated_at`)
VALUES ('01K6D0CTYPE0000000000PX001', 'delivery_note', 'Phiếu xuất kho (mẫu 02-VT, DEMO)', 'phiếu xuất kho (mẫu 02-vt, demo)', 'customer', '01K6D0CTYPE0000000000PXV01', 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
INSERT INTO `template_versions` (`id`, `template_id`, `version_no`, `body`, `fields`, `default_line_items`, `default_clauses`, `approval_policy`, `field_rules`, `note`, `created_by`, `created_at`)
VALUES ('01K6D0CTYPE0000000000PXV01', '01K6D0CTYPE0000000000PX001', 1, '<table><tr><td>Đơn vị: <strong>CÔNG TY TNHH PHẦN MỀM NHẬT MINH</strong><br>Bộ phận: …… (DEMO)</td><td class="center"><strong>Mẫu số 02 - VT</strong><br>(Kèm theo Thông tư 99/2025/TT-BTC) (DEMO)</td></tr></table>
<h1 class="center">PHIẾU XUẤT KHO</h1>
<p class="center">Ngày {{ngay_phieu}} · Số: {{so_phieu}}</p>
<p class="right">Nợ: …… · Có: ……</p>
<p>Họ và tên người nhận hàng: {{nguoi_nhan}}</p>
<p>Địa chỉ (bộ phận): {{ten_cua_hang}}{{#if dia_chi}} — {{dia_chi}}{{/if}}</p>
<p>Lý do xuất kho: {{ly_do_xuat_kho}}</p>
<p>Xuất tại kho (ngăn lô): {{xuat_tai_kho}} · Địa điểm: {{dia_diem}}</p>
{{bang_hang_xuat}}
<p>Tổng số tiền (viết bằng chữ): ……</p>
<p>Số chứng từ gốc kèm theo: ……</p>
<table class="center"><tr><th>Người lập phiếu</th><th>Người nhận hàng</th><th>Thủ kho</th><th>Kế toán trưởng (hoặc bộ phận có nhu cầu nhập)</th><th>Giám đốc</th></tr>
<tr><td>(Ký, họ tên)</td><td>(Ký, họ tên)</td><td>(Ký, họ tên)</td><td>(Ký, họ tên)</td><td>(Ký, họ tên)</td></tr></table>', '[{"key":"so_phieu","label":"Số phiếu","type":"text","required":false,"source":"issue:number"},{"key":"ngay_phieu","label":"Ngày phiếu","type":"date","required":true,"source":"derived:doc_date"},{"key":"nguoi_nhan","label":"Họ và tên người nhận hàng","type":"text","required":true,"source":"subject:contact_person"},{"key":"ten_cua_hang","label":"Cửa hàng nhận","type":"text","required":true,"source":"subject:name"},{"key":"dia_chi","label":"Địa chỉ","type":"text","required":false,"source":"subject:address"},{"key":"ly_do_xuat_kho","label":"Lý do xuất kho","type":"text","required":true,"source":"manual"},{"key":"xuat_tai_kho","label":"Xuất tại kho (ngăn lô)","type":"text","required":false,"source":"manual"},{"key":"dia_diem","label":"Địa điểm","type":"text","required":false,"source":"manual"},{"key":"bang_hang_xuat","label":"Bảng hàng xuất kho","type":"goods","required":true,"source":"derived:goods_table"}]', '[]', '[]', '{"mode":"combined","steps":[{"step_no":1,"label":"Quản lý duyệt","permission":"contract:approve"}],"rules":[{"when":{"var":"discount_bps","op":"gt","value":1000},"add_steps":[{"label":"Giám đốc duyệt","permission":"contract:approve","role":"giam_doc"}]}]}', '[]', 'Phiếu xuất kho theo bố cục 02-VT (DEMO): chỉ hàng hóa, không giá (SPEC-09 DEC-12/13).', NULL, CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
INSERT INTO `audit_events` (`id`, `ts`, `actor`, `action`, `target`, `metadata`, `ip`)
VALUES ('01AUDT00000000000TPLSEED05', CAST(strftime('%s','now') AS INTEGER), NULL, 'template.created', 'template:01K6D0CTYPE0000000000PX001', '{"version_no":1,"fields":9}', NULL);
--> statement-breakpoint
-- 4) Hợp đồng v3 = v2 byte-for-byte in body/policy; only so_bao_gia → parent:number, ngay_bao_gia → parent:doc_date (still
--    optional: a stand-alone contract, DEC-14 A, prints without "Căn cứ" via {{#if so_bao_gia}}). Both come from the parent
--    together, so the all_or_none rule on two manual fields is gone (SPEC-09 §3.1). v1, v2 stay as stored.
INSERT INTO `template_versions` (`id`, `template_id`, `version_no`, `body`, `fields`, `default_line_items`, `default_clauses`, `approval_policy`, `field_rules`, `note`, `created_by`, `created_at`)
VALUES ('01K6C0NTRACT0000000000V003', '01K6C0NTRACT000000000TP001', 3, '<div class="center b">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
<div class="center b">Độc lập – Tự do – Hạnh phúc</div>
<h1 class="center">HỢP ĐỒNG CUNG CẤP DỊCH VỤ PHẦN MỀM</h1>
<p class="center">Số: {{so_hop_dong}}</p>
{{#if so_bao_gia}}<p>Căn cứ báo giá số {{so_bao_gia}} ngày {{ngay_bao_gia}}.</p>{{/if}}
<p>Hôm nay, ngày {{ngay_hop_dong}}, chúng tôi gồm:</p>
<h3>Bên A (bên cung cấp)</h3>
<p class="b">CÔNG TY TNHH PHẦN MỀM NHẬT MINH</p>
<p>Địa chỉ: 25 Nguyễn Văn Trỗi, Phường Phú Nhuận, TP. Hồ Chí Minh</p>
<p>Đại diện: ông Nguyễn Nhật Minh — Chức vụ: Giám đốc</p>
<h3>Bên B (khách hàng)</h3>
<p>Tên cửa hàng: {{ten_cua_hang}}</p>
<p>Đại diện: {{ten_khach}} — Chức vụ: {{chuc_vu_nguoi_ky}}</p>
<p>Điện thoại: {{sdt}} — Email: {{email}}</p>
<h3>Điều 1. Nội dung dịch vụ</h3>
<p>Bên A cấp cho Bên B quyền sử dụng phần mềm quản lý bán hàng Nhật Minh, {{ten_goi}}, từ ngày {{ngay_bat_dau}} đến hết ngày {{ngay_ket_thuc}}, theo bảng:</p>
{{bang_hang}}
<p>Bên A hỗ trợ cài đặt và hướng dẫn sử dụng qua điện thoại và Zalo trong giờ hành chính.</p>
<h3>Điều 2. Giá trị hợp đồng</h3>
<p>Tiền trước thuế: {{tien_truoc_thue}} đồng · giảm giá {{giam_gia}}% ({{tien_giam_gia}} đồng) · thuế GTGT ({{thue_suat}}): {{tien_thue}} đồng.</p>
<p><strong>Tổng thanh toán: {{tong_thanh_toan}} đồng</strong> (bằng chữ: {{tong_thanh_toan_bang_chu}}).</p>
<h3>Điều 3. Thanh toán</h3>
<p>Bên B chuyển khoản 100% giá trị hợp đồng trong 7 ngày kể từ ngày ký, theo đề nghị thanh toán của Bên A. Tài khoản: 0071 0004 58213 · Vietcombank · Chủ tài khoản: CÔNG TY TNHH PHẦN MỀM NHẬT MINH.</p>
<h3>Điều 4. Trách nhiệm của hai bên</h3>
<p>Bên A bảo đảm phần mềm hoạt động ổn định và giữ bí mật dữ liệu bán hàng của Bên B. Bên B sử dụng phần mềm đúng mục đích và thanh toán đúng hạn.</p>
<h3>Điều 5. Điều khoản chung</h3>
<p>Hợp đồng lập thành 02 bản, mỗi bên giữ 01 bản, có giá trị như nhau. Mọi thay đổi phải được hai bên đồng ý bằng văn bản.</p>
<table class="sig"><tr><th>ĐẠI DIỆN BÊN A</th><th>ĐẠI DIỆN BÊN B</th></tr>
<tr><td>(ký, ghi rõ họ tên)</td><td>(ký, ghi rõ họ tên)</td></tr></table>', '[{"key":"so_hop_dong","label":"Số hợp đồng","type":"text","required":false,"source":"issue:number"},{"key":"so_bao_gia","label":"Số báo giá","type":"text","required":false,"source":"parent:number"},{"key":"ngay_bao_gia","label":"Ngày báo giá","type":"date","required":false,"source":"parent:doc_date"},{"key":"ngay_hop_dong","label":"Ngày hợp đồng","type":"date","required":true,"source":"derived:doc_date"},{"key":"ten_cua_hang","label":"Tên cửa hàng","type":"text","required":true,"source":"subject:name"},{"key":"ten_khach","label":"Người đại diện Bên B","type":"text","required":true,"source":"subject:contact_person"},{"key":"chuc_vu_nguoi_ky","label":"Chức vụ người ký","type":"text","required":true,"source":"manual"},{"key":"sdt","label":"Điện thoại","type":"text","required":true,"source":"subject:phone"},{"key":"email","label":"Email","type":"text","required":true,"source":"subject:email"},{"key":"ten_goi","label":"Tên gói","type":"text","required":true,"source":"derived:service_name"},{"key":"bang_hang","label":"Bảng dòng hàng","type":"lines","required":true,"source":"derived:lines_table"},{"key":"ngay_bat_dau","label":"Ngày bắt đầu","type":"date","required":true,"source":"manual","default":"derived:doc_date"},{"key":"ngay_ket_thuc","label":"Ngày kết thúc","type":"date","required":true,"source":"derived:contract_end"},{"key":"giam_gia","label":"Giảm giá (%)","type":"percent","required":true,"source":"manual","default":0},{"key":"tien_truoc_thue","label":"Tiền trước thuế","type":"money","required":true,"source":"derived:subtotal_ex_vat"},{"key":"tien_giam_gia","label":"Tiền giảm giá","type":"money","required":true,"source":"derived:discount_amount"},{"key":"thue_suat","label":"Thuế suất","type":"text","required":true,"source":"derived:vat_rates"},{"key":"tien_thue","label":"Tiền thuế GTGT","type":"money","required":true,"source":"derived:vat_total"},{"key":"tong_thanh_toan","label":"Tổng thanh toán","type":"money","required":true,"source":"derived:total"},{"key":"tong_thanh_toan_bang_chu","label":"Bằng chữ","type":"text","required":true,"source":"derived:total_in_words"}]', '[]', '[]', '{"mode":"combined","steps":[{"step_no":1,"label":"Quản lý duyệt","permission":"contract:approve"}],"rules":[{"when":{"var":"discount_bps","op":"gt","value":1000},"add_steps":[{"label":"Giám đốc duyệt","permission":"contract:approve","role":"giam_doc"}]}]}', '[]', 'Căn cứ báo giá lấy từ báo giá cha (số, ngày) thay cho nhập tay (SPEC-09 FR-13).', NULL, CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
UPDATE `templates` SET `current_version_id` = '01K6C0NTRACT0000000000V003', `updated_at` = CAST(strftime('%s','now') AS INTEGER) WHERE `id` = '01K6C0NTRACT000000000TP001';
--> statement-breakpoint
INSERT INTO `audit_events` (`id`, `ts`, `actor`, `action`, `target`, `metadata`, `ip`)
VALUES ('01AUDT00000000000TPLSEED06', CAST(strftime('%s','now') AS INTEGER), NULL, 'template.version_created', 'template:01K6C0NTRACT000000000TP001', '{"version_no":3,"fields":20}', NULL);
