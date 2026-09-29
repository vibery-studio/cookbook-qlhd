-- SPEC-02 DEC-5 / §3.4-3.5: seed template "Hợp đồng cung cấp dịch vụ phần mềm" v1 (created_by NULL = system; audit actor NULL).
-- Fixed ULID literals for cross-environment reproducibility. Body = SPEC-02 §3.5 verbatim (internal note removed).
INSERT INTO `templates` (`id`, `type`, `name`, `name_norm`, `subject_type`, `current_version_id`, `active`, `created_by`, `created_at`, `updated_at`)
VALUES ('01K6C0NTRACT000000000TP001', 'contract', 'Hợp đồng cung cấp dịch vụ phần mềm', 'hợp đồng cung cấp dịch vụ phần mềm', 'customer', NULL, 1, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
INSERT INTO `template_versions` (`id`, `template_id`, `version_no`, `body`, `fields`, `default_line_items`, `default_clauses`, `approval_policy`, `field_rules`, `note`, `created_by`, `created_at`)
VALUES ('01K6C0NTRACT0000000000V001', '01K6C0NTRACT000000000TP001', 1, '<div class="center b">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
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
<p>Bên A cấp cho Bên B quyền sử dụng phần mềm quản lý bán hàng Nhật Minh, {{ten_goi}}, cho {{so_cua_hang}} cửa hàng, từ ngày {{ngay_bat_dau}} đến hết ngày {{ngay_ket_thuc}}. Bên A hỗ trợ cài đặt và hướng dẫn sử dụng qua điện thoại và Zalo trong giờ hành chính.</p>
<h3>Điều 2. Giá trị hợp đồng</h3>
<p>Giá trị hợp đồng: {{tong_tien}} đồng (bằng chữ: {{tong_tien_bang_chu}}), đã gồm VAT, đã trừ giảm giá {{giam_gia}}%.</p>
<h3>Điều 3. Thanh toán</h3>
<p>Bên B chuyển khoản 100% giá trị hợp đồng trong 7 ngày kể từ ngày ký, theo đề nghị thanh toán của Bên A. Tài khoản: 0071 0004 58213 · Vietcombank · Chủ tài khoản: CÔNG TY TNHH PHẦN MỀM NHẬT MINH.</p>
<h3>Điều 4. Trách nhiệm của hai bên</h3>
<p>Bên A bảo đảm phần mềm hoạt động ổn định và giữ bí mật dữ liệu bán hàng của Bên B. Bên B sử dụng phần mềm đúng mục đích và thanh toán đúng hạn.</p>
<h3>Điều 5. Điều khoản chung</h3>
<p>Hợp đồng lập thành 02 bản, mỗi bên giữ 01 bản, có giá trị như nhau. Mọi thay đổi phải được hai bên đồng ý bằng văn bản.</p>
<table class="sig"><tr><th>ĐẠI DIỆN BÊN A</th><th>ĐẠI DIỆN BÊN B</th></tr>
<tr><td>(ký, ghi rõ họ tên)</td><td>(ký, ghi rõ họ tên)</td></tr></table>', '[{"key":"so_hop_dong","label":"Số hợp đồng","type":"text","required":false,"source":"issue:number"},{"key":"so_bao_gia","label":"Số báo giá","type":"text","required":false,"source":"manual"},{"key":"ngay_bao_gia","label":"Ngày báo giá","type":"date","required":false,"source":"manual"},{"key":"ngay_hop_dong","label":"Ngày hợp đồng","type":"date","required":true,"source":"derived:doc_date"},{"key":"ten_cua_hang","label":"Tên cửa hàng","type":"text","required":true,"source":"subject:name"},{"key":"ten_khach","label":"Người đại diện Bên B","type":"text","required":true,"source":"subject:contact_person"},{"key":"chuc_vu_nguoi_ky","label":"Chức vụ người ký","type":"text","required":true,"source":"manual"},{"key":"sdt","label":"Điện thoại","type":"text","required":true,"source":"subject:phone"},{"key":"email","label":"Email","type":"text","required":true,"source":"subject:email"},{"key":"ten_goi","label":"Tên gói","type":"text","required":true,"source":"price_list:name"},{"key":"so_cua_hang","label":"Số cửa hàng","type":"number","required":true,"source":"manual"},{"key":"ngay_bat_dau","label":"Ngày bắt đầu","type":"date","required":true,"source":"manual","default":"derived:doc_date"},{"key":"ngay_ket_thuc","label":"Ngày kết thúc","type":"date","required":true,"source":"derived:contract_end"},{"key":"giam_gia","label":"Giảm giá (%)","type":"percent","required":true,"source":"manual","default":0},{"key":"tong_tien","label":"Giá trị hợp đồng","type":"money","required":true,"source":"derived:total"},{"key":"tong_tien_bang_chu","label":"Bằng chữ","type":"text","required":true,"source":"derived:total_in_words"},{"key":"ma_goi","label":"Gói","type":"choice","required":true,"source":"manual","options":["G3","G6","G12"]}]', '[]', '[]', '{"mode":"combined","steps":[{"step_no":1,"label":"Quản lý duyệt","permission":"contract:approve"}],"rules":[{"when":{"var":"discount_bps","op":"gt","value":1000},"add_steps":[{"label":"Giám đốc duyệt","permission":"contract:approve","role":"giam_doc"}]}]}', '[{"all_or_none":["so_bao_gia","ngay_bao_gia"]}]', NULL, NULL, CAST(strftime('%s','now') AS INTEGER));
--> statement-breakpoint
UPDATE `templates` SET `current_version_id` = '01K6C0NTRACT0000000000V001' WHERE `id` = '01K6C0NTRACT000000000TP001';
--> statement-breakpoint
INSERT INTO `audit_events` (`id`, `ts`, `actor`, `action`, `target`, `metadata`, `ip`)
VALUES ('01AUDT00000000000TPLSEED01', CAST(strftime('%s','now') AS INTEGER), NULL, 'template.created', 'template:01K6C0NTRACT000000000TP001', '{"version_no":1,"fields":17}', NULL);
