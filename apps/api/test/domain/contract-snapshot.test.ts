import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../../src/domain/contract/snapshot";
import type { CustomerInput, PricedLineInput, TemplateVersionInput } from "../../src/domain/contract/types";

const version: TemplateVersionInput = {
  id: "v2",
  template_id: "t1",
  version_no: 2,
  body:
    "<p>{{ten_cua_hang}} {{chuc_vu_nguoi_ky}} {{ten_goi}}</p>{{bang_hang}}<p>{{tien_truoc_thue}} {{tien_giam_gia}} {{thue_suat}} {{tien_thue}} {{tong_thanh_toan}} {{tong_thanh_toan_bang_chu}}</p>{{#if so_bao_gia}}<p>{{so_bao_gia}} {{ngay_bao_gia}}</p>{{/if}}<p>{{so_hop_dong}}</p>",
  fields: [
    { key: "ten_cua_hang", label: "Tên cửa hàng", type: "text", required: true, source: "subject:name" },
    { key: "chuc_vu_nguoi_ky", label: "Chức vụ", type: "text", required: true, source: "manual" },
    { key: "so_bao_gia", label: "Số báo giá", type: "text", required: false, source: "manual" },
    { key: "ngay_bao_gia", label: "Ngày báo giá", type: "date", required: false, source: "manual" },
    { key: "giam_gia", label: "Giảm giá", type: "percent", required: true, source: "manual", default: 0 },
    { key: "ngay_bat_dau", label: "Ngày bắt đầu", type: "date", required: true, source: "manual", default: "derived:doc_date" },
    { key: "ngay_hop_dong", label: "Ngày hợp đồng", type: "date", required: true, source: "derived:doc_date" },
    { key: "ngay_ket_thuc", label: "Ngày kết thúc", type: "date", required: true, source: "derived:contract_end" },
    { key: "ten_goi", label: "Tên gói", type: "text", required: true, source: "derived:service_name" },
    { key: "bang_hang", label: "Bảng hàng", type: "lines", required: true, source: "derived:lines_table" },
    { key: "tien_truoc_thue", label: "Tiền trước thuế", type: "money", required: true, source: "derived:subtotal_ex_vat" },
    { key: "tien_giam_gia", label: "Tiền giảm giá", type: "money", required: true, source: "derived:discount_amount" },
    { key: "thue_suat", label: "Thuế suất", type: "text", required: true, source: "derived:vat_rates" },
    { key: "tien_thue", label: "Tiền thuế", type: "money", required: true, source: "derived:vat_total" },
    { key: "tong_thanh_toan", label: "Tổng thanh toán", type: "money", required: true, source: "derived:total" },
    { key: "tong_thanh_toan_bang_chu", label: "Bằng chữ", type: "text", required: true, source: "derived:total_in_words" },
    { key: "so_hop_dong", label: "Số hợp đồng", type: "text", required: true, source: "issue:number" },
  ],
  field_rules: [{ all_or_none: ["so_bao_gia", "ngay_bao_gia"] }],
  default_line_items: [],
  default_clauses: [],
  approval_policy: { mode: "none" },
};

const customer: CustomerInput = {
  id: "c1",
  name: "Cửa hàng Cô Ba",
  contact_person: "Trần Thị Ba",
  phone: "0901",
  email: "ba@example.com",
  tax_code: null,
  address: "12 Lê Lợi",
};

const G6: PricedLineInput = {
  product_id: "01PROD000000000000000000G6",
  code: "G6",
  name: "Gói 6 tháng",
  kind: "service",
  unit: "cửa hàng",
  duration_value: 6,
  duration_unit: "month",
  qty: 1,
  unit_price_ex_vat: 2_700_000,
  vat_rate_bps: null,
  price_from: "2026-07-01",
};

const MIN: PricedLineInput = {
  product_id: "01PROD00000000000DEMOMIN01",
  code: "DEMO-MIN-01",
  name: "Máy in hóa đơn (DEMO)",
  kind: "goods",
  unit: "cái",
  duration_value: null,
  duration_unit: null,
  qty: 1,
  unit_price_ex_vat: 1_000_000,
  vat_rate_bps: 1000,
  price_from: "2026-01-01",
};

const values = { giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" };
const build = (over: Partial<Parameters<typeof buildSnapshot>[0]> = {}) =>
  buildSnapshot({ version, customer, lines: [G6], values, docDate: "2026-09-28", manualStart: false, ...over });

describe("contract snapshot (SPEC-08 §3.2)", () => {
  it("G6 −5%: KCT line, one VAT group, totals, dates, print values, inputs.lines", () => {
    const result = build();
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.snapshot.lines).toEqual([{ ...G6, amount_ex_vat: 2_700_000, discount_amount: 135_000, net_ex_vat: 2_565_000 }]);
    expect(result.snapshot).toMatchObject({
      vat_groups: [{ vat_rate_bps: null, base: 2_565_000, vat: 0 }],
      subtotal_ex_vat: 2_700_000,
      discount_bps: 500,
      discount_amount: 135_000,
      total_ex_vat: 2_565_000,
      vat_total: 0,
      total: 2_565_000,
      total_words: "Hai triệu năm trăm sáu mươi lăm nghìn đồng",
      dates: { doc_date: "2026-09-28", start: "2026-09-28", end: "2027-03-27" },
      inputs: { giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh", lines: [{ product_id: G6.product_id, qty: 1 }] },
      line_table_fields: ["bang_hang"],
      fields: {
        ten_goi: "Gói 6 tháng",
        tong_thanh_toan: "2.565.000",
        tien_truoc_thue: "2.700.000",
        tien_giam_gia: "135.000",
        thue_suat: "KCT",
        tien_thue: "0",
        giam_gia: "5",
        ngay_hop_dong: "28/09/2026",
      },
    });
    expect(result.snapshot).not.toHaveProperty("package");
    expect(result.snapshot).not.toHaveProperty("gross");
  });

  it("G6 + DEMO-MIN-01: KCT + 10% groups → 3.800.000, rates label 'KCT, 10%'", () => {
    const result = build({ lines: [G6, MIN], values: { ...values, giam_gia: 0 } });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.snapshot).toMatchObject({
      vat_groups: [
        { vat_rate_bps: null, base: 2_700_000, vat: 0 },
        { vat_rate_bps: 1000, base: 1_000_000, vat: 100_000 },
      ],
      subtotal_ex_vat: 3_700_000,
      vat_total: 100_000,
      total: 3_800_000,
      total_words: "Ba triệu tám trăm nghìn đồng",
      fields: { thue_suat: "KCT, 10%", tien_thue: "100.000", tong_thanh_toan: "3.800.000" },
    });
  });

  it("DEC-10: no service, two services, a day-based service → invalid `lines`", () => {
    const G12 = { ...G6, product_id: "01PROD00000000000000000G12", code: "G12", duration_value: 12 };
    const DT = { ...G6, product_id: "01PROD0000000000000000DT14", code: "DT14", duration_unit: "day" as const, duration_value: 14 };
    for (const lines of [[MIN], [G6, G12], [DT], [DT, MIN]]) {
      const r = build({ lines });
      expect(r, JSON.stringify(lines.map((l) => l.code))).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "lines" }] });
    }
  });

  it("returns missing required fields and treats whitespace as empty", () => {
    expect(build({ values: { ...values, chuc_vu_nguoi_ky: "   " } })).toEqual({
      ok: false,
      kind: "missing-fields",
      missing: [{ key: "chuc_vu_nguoi_ky", label: "Chức vụ" }],
    });
  });

  it("rejects pair-rule violations and forged derived / old v1 inputs", () => {
    expect(build({ values: { ...values, so_bao_gia: "BG-1" } })).toMatchObject({ ok: false, kind: "invalid" });
    expect(build({ values: { ...values, total: 1 } })).toMatchObject({ ok: false, kind: "invalid" });
    expect(build({ values: { ...values, ma_goi: "G6" } })).toMatchObject({ ok: false, kind: "invalid" });
    expect(build({ values: { ...values, bang_hang: "<b>x</b>" } })).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("SPEC-09: every snapshot carries `type` + `parent: null`; no type = contract (today's rule); number keys recorded", () => {
    const result = build();
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.snapshot).toMatchObject({ type: "contract", parent: null, number_fields: ["so_hop_dong"], goods_table_fields: [] });
  });
});

const quoteVersion: TemplateVersionInput = {
  id: "vq1",
  template_id: "tq",
  version_no: 1,
  body: "<p>{{so_bao_gia}} {{ten_cua_hang}} {{ngay_bao_gia}} {{hieu_luc_den}} {{nguoi_lap}}</p>{{bang_hang}}<p>{{tong_thanh_toan}} {{tong_thanh_toan_bang_chu}}</p>",
  fields: [
    { key: "ten_cua_hang", label: "Tên cửa hàng", type: "text", required: true, source: "subject:name" },
    { key: "giam_gia", label: "Giảm giá", type: "percent", required: true, source: "manual", default: 0 },
    { key: "ngay_bao_gia", label: "Ngày báo giá", type: "date", required: true, source: "derived:doc_date" },
    { key: "hieu_luc_den", label: "Hiệu lực đến", type: "date", required: true, source: "derived:valid_until" },
    { key: "nguoi_lap", label: "Nhân viên phụ trách", type: "text", required: true, source: "creator:name" },
    { key: "bang_hang", label: "Bảng hàng", type: "lines", required: true, source: "derived:lines_table" },
    { key: "tong_thanh_toan", label: "Tổng", type: "money", required: true, source: "derived:total" },
    { key: "tong_thanh_toan_bang_chu", label: "Bằng chữ", type: "text", required: true, source: "derived:total_in_words" },
    { key: "so_bao_gia", label: "Số báo giá", type: "text", required: true, source: "issue:number" },
  ],
  field_rules: [],
  default_line_items: [],
  default_clauses: [],
  approval_policy: { mode: "none" },
};

const GIAY: PricedLineInput = {
  ...MIN,
  product_id: "01PROD0000000000DEMOGIAY01",
  code: "DEMO-GIAY-01",
  name: "Giấy in nhiệt (DEMO)",
  unit: "cuộn",
  unit_price_ex_vat: 20_000,
};

describe("quote snapshot (SPEC-09 §3.3, DEC-5)", () => {
  const quote = (over: Partial<Parameters<typeof buildSnapshot>[0]> = {}) =>
    buildSnapshot({
      type: "quote",
      version: quoteVersion,
      customer,
      lines: [G6],
      values: { giam_gia: 500 },
      docDate: "2026-12-31",
      manualStart: false,
      creatorName: "Nguyễn Văn Nam",
      ...over,
    });

  it("valid_until = doc_date + 15 across the year (31/12 → 15/01), creator_name, money via priceLines, no contract dates", () => {
    const r = quote();
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.snapshot).toMatchObject({
      type: "quote",
      parent: null,
      creator_name: "Nguyễn Văn Nam",
      total: 2_565_000,
      discount_bps: 500,
      dates: { doc_date: "2026-12-31", valid_until: "2027-01-15" },
      fields: { hieu_luc_den: "15/01/2027", nguoi_lap: "Nguyễn Văn Nam", ngay_bao_gia: "31/12/2026", tong_thanh_toan: "2.565.000" },
      number_fields: ["so_bao_gia"],
      line_table_fields: ["bang_hang"],
    });
    expect(r.snapshot.dates).not.toHaveProperty("end");
    expect(r.snapshot.dates).not.toHaveProperty("start");
  });

  it("free lines: goods only and two services are a valid quote (no DEC-10); 0 or 51 lines are not", () => {
    const G12 = { ...G6, product_id: "01PROD00000000000000000G12", code: "G12", duration_value: 12 };
    for (const lines of [[MIN], [G6, G12], [MIN, GIAY]]) {
      expect(quote({ lines }).ok, JSON.stringify(lines.map((l) => l.code))).toBe(true);
    }
    expect(quote({ lines: [] })).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "lines" }] });
    const many = Array.from({ length: 51 }, (_, i) => ({ ...MIN, product_id: `01PROD000000000000000000${String(i).padStart(2, "0")}` }));
    expect(quote({ lines: many })).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "lines" }] });
  });

  it("a payment request is never built standalone (it needs a parent)", () => {
    expect(quote({ type: "payment_request" })).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "type" }] });
  });
});

const pxkVersion: TemplateVersionInput = {
  id: "vx1",
  template_id: "tx",
  version_no: 1,
  body: "<p>{{so_phieu}} {{ten_cua_hang}} {{ly_do_xuat_kho}} {{xuat_tai_kho}} {{dia_diem}}</p>{{bang_hang_hoa}}",
  fields: [
    { key: "ten_cua_hang", label: "Người nhận", type: "text", required: true, source: "subject:name" },
    { key: "ly_do_xuat_kho", label: "Lý do xuất kho", type: "text", required: true, source: "manual" },
    { key: "xuat_tai_kho", label: "Xuất tại kho", type: "text", required: false, source: "manual" },
    { key: "dia_diem", label: "Địa điểm", type: "text", required: false, source: "manual" },
    { key: "bang_hang_hoa", label: "Bảng hàng hóa", type: "goods", required: true, source: "derived:goods_table" },
    { key: "so_phieu", label: "Số phiếu", type: "text", required: true, source: "issue:number" },
  ],
  field_rules: [],
  default_line_items: [],
  default_clauses: [],
  approval_policy: { mode: "steps", steps: [{ step_no: 1, label: "Quản lý duyệt", permission: "contract:approve" }] },
};

describe("delivery note snapshot (SPEC-09 §3.3, DEC-12 A, P-1, P-7)", () => {
  const pxkValues = { ly_do_xuat_kho: "Giao máy in", xuat_tai_kho: "Kho Phú Nhuận (DEMO)", dia_diem: "25 Nguyễn Văn Trỗi" };
  // no price needed: goods lines without a price level
  const unpriced = (l: PricedLineInput, qty: number) => ({
    product_id: l.product_id,
    code: l.code,
    name: l.name,
    kind: l.kind,
    unit: l.unit,
    duration_value: l.duration_value,
    duration_unit: l.duration_unit,
    qty,
  });
  const pxk = (over: Partial<Parameters<typeof buildSnapshot>[0]> = {}) =>
    buildSnapshot({
      type: "delivery_note",
      version: pxkVersion,
      customer,
      lines: [unpriced(MIN, 2), unpriced(GIAY, 5)],
      values: pxkValues,
      docDate: "2026-09-28",
      manualStart: false,
      ...over,
    });

  it("goods lines {product_id, code, name, unit, qty}, money 0, discount 0, no total_words, goods table field", () => {
    const r = pxk();
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.snapshot.lines).toEqual([
      { product_id: MIN.product_id, code: "DEMO-MIN-01", name: "Máy in hóa đơn (DEMO)", unit: "cái", qty: 2 },
      { product_id: GIAY.product_id, code: "DEMO-GIAY-01", name: "Giấy in nhiệt (DEMO)", unit: "cuộn", qty: 5 },
    ]);
    expect(r.snapshot).toMatchObject({
      type: "delivery_note",
      parent: null,
      total: 0,
      subtotal_ex_vat: 0,
      discount_bps: 0,
      discount_amount: 0,
      total_ex_vat: 0,
      vat_total: 0,
      vat_groups: [],
      goods_table_fields: ["bang_hang_hoa"],
      line_table_fields: [],
      dates: { doc_date: "2026-09-28" },
      inputs: { ...pxkValues, lines: [{ product_id: MIN.product_id, qty: 2 }, { product_id: GIAY.product_id, qty: 5 }] },
      fields: { ly_do_xuat_kho: "Giao máy in" },
    });
    expect(r.snapshot).not.toHaveProperty("total_words");
    // priced lines are accepted too, the price is dropped
    const priced = pxk({ lines: [MIN] });
    if (!priced.ok) throw new Error(JSON.stringify(priced));
    expect(priced.snapshot.total).toBe(0);
    expect(priced.snapshot.lines[0]).not.toHaveProperty("unit_price_ex_vat");
  });

  it("a service line → validation `lines`; giam_gia (even 0) → validation `values.giam_gia`; ly_do_xuat_kho required", () => {
    expect(pxk({ lines: [G6] })).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "lines" }] });
    expect(pxk({ lines: [unpriced(MIN, 1), G6] })).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "lines" }] });
    for (const giam_gia of [500, 0]) {
      expect(pxk({ values: { ...pxkValues, giam_gia } })).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "values.giam_gia" }] });
    }
    expect(pxk({ values: { ...pxkValues, ly_do_xuat_kho: " " } })).toEqual({
      ok: false,
      kind: "missing-fields",
      missing: [{ key: "ly_do_xuat_kho", label: "Lý do xuất kho" }],
    });
    expect(pxk({ lines: [] })).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "lines" }] });
    expect(pxk({ lines: [unpriced(MIN, 0)] })).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "lines" }] });
  });
});
