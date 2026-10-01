-- SPEC-08 DEC-8 / §3.4 (PLAN-08 §2b, P-7): seed template "Hợp đồng cung cấp dịch vụ phần mềm" v2 — document lines.
-- v1 stays as stored (template_versions is append-only, trigger 0012); the pointer moves to v2. created_by NULL = system,
-- audit actor NULL. Body = v1 except Điều 1–2: the line table ({{bang_hang}}, type `lines`, source derived:lines_table)
-- replaces "cho {{so_cua_hang}} cửa hàng"; pre-tax money · discount · VAT by rate · payable total replace "đã gồm VAT".
-- The table sits right after "theo bảng:" as its own block (a <table> cannot live inside <p>).
INSERT INTO `template_versions` (`id`, `template_id`, `version_no`, `body`, `fields`, `default_line_items`, `default_clauses`, `approval_policy`, `field_rules`, `note`, `created_by`, `created_at`)
VALUES ('01K6C0NTRACT0000000000V002', '01K6C0NTRACT000000000TP001', 2, '<div class="center b">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
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
<tr><td>(ký, ghi rõ họ tên)</td><td>(ký, ghi rõ họ tên)</td></tr></table>', '[{"key":"so_hop_dong","label":"Số hợp đồng","type":"text","required":false,"source":"issue:number"},{"key":"so_bao_gia","label":"Số báo giá","type":"text","required":false,"source":"manual"},{"key":"ngay_bao_gia","label":"Ngày báo giá","type":"date","required":false,"source":"manual"},{"key":"ngay_hop_dong","label":"Ngày hợp đồng","type":"date","required":true,"source":"derived:doc_date"},{"key":"ten_cua_hang","label":"Tên cửa hàng","type":"text","required":true,"source":"subject:name"},{"key":"ten_khach","label":"Người đại diện Bên B","type":"text","required":true,"source":"subject:contact_person"},{"key":"chuc_vu_nguoi_ky","label":"Chức vụ người ký","type":"text","required":true,"source":"manual"},{"key":"sdt","label":"Điện thoại","type":"text","required":true,"source":"subject:phone"},{"key":"email","label":"Email","type":"text","required":true,"source":"subject:email"},{"key":"ten_goi","label":"Tên gói","type":"text","required":true,"source":"derived:service_name"},{"key":"bang_hang","label":"Bảng dòng hàng","type":"lines","required":true,"source":"derived:lines_table"},{"key":"ngay_bat_dau","label":"Ngày bắt đầu","type":"date","required":true,"source":"manual","default":"derived:doc_date"},{"key":"ngay_ket_thuc","label":"Ngày kết thúc","type":"date","required":true,"source":"derived:contract_end"},{"key":"giam_gia","label":"Giảm giá (%)","type":"percent","required":true,"source":"manual","default":0},{"key":"tien_truoc_thue","label":"Tiền trước thuế","type":"money","required":true,"source":"derived:subtotal_ex_vat"},{"key":"tien_giam_gia","label":"Tiền giảm giá","type":"money","required":true,"source":"derived:discount_amount"},{"key":"thue_suat","label":"Thuế suất","type":"text","required":true,"source":"derived:vat_rates"},{"key":"tien_thue","label":"Tiền thuế GTGT","type":"money","required":true,"source":"derived:vat_total"},{"key":"tong_thanh_toan","label":"Tổng thanh toán","type":"money","required":true,"source":"derived:total"},{"key":"tong_thanh_toan_bang_chu","label":"Bằng chữ","type":"text","required":true,"source":"derived:total_in_words"}]', '[]', '[]', '{"mode":"combined","steps":[{"step_no":1,"label":"Quản lý duyệt","permission":"contract:approve"}],"rules":[{"when":{"var":"discount_bps","op":"gt","value":1000},"add_steps":[{"label":"Giám đốc duyệt","permission":"contract:approve","role":"giam_doc"}]}]}', '[{"all_or_none":["so_bao_gia","ngay_bao_gia"]}]', 'Dòng hàng: bảng sản phẩm, tiền trước thuế, thuế GTGT theo thuế suất, tổng thanh toán (SPEC-08).', NULL, CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
UPDATE `templates` SET `current_version_id` = '01K6C0NTRACT0000000000V002', `updated_at` = CAST(strftime('%s','now') AS INTEGER) WHERE `id` = '01K6C0NTRACT000000000TP001';
--> statement-breakpoint
INSERT INTO `audit_events` (`id`, `ts`, `actor`, `action`, `target`, `metadata`, `ip`)
VALUES ('01AUDT00000000000TPLSEED02', CAST(strftime('%s','now') AS INTEGER), NULL, 'template.version_created', 'template:01K6C0NTRACT000000000TP001', '{"version_no":2,"fields":20}', NULL);
