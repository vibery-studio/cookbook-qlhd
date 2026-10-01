import { describe, expect, it } from "vitest";
import { buildChildSnapshot } from "../../src/domain/contract/child-snapshot";
import { buildSnapshot } from "../../src/domain/contract/snapshot";
import type { CustomerInput, PricedLineInput, Snapshot, TemplateVersionInput } from "../../src/domain/contract/types";

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

const base = { field_rules: [], default_line_items: [], default_clauses: [], approval_policy: { mode: "none" as const } };

const quoteVersion: TemplateVersionInput = {
  ...base,
  id: "vq1",
  template_id: "tq",
  version_no: 1,
  body: "<p>{{so_bao_gia}} {{ten_cua_hang}}</p>{{bang_hang}}<p>{{tong_thanh_toan}}</p>",
  fields: [
    { key: "ten_cua_hang", label: "Tên cửa hàng", type: "text", required: true, source: "subject:name" },
    { key: "giam_gia", label: "Giảm giá", type: "percent", required: true, source: "manual", default: 0 },
    { key: "bang_hang", label: "Bảng hàng", type: "lines", required: true, source: "derived:lines_table" },
    { key: "tong_thanh_toan", label: "Tổng", type: "money", required: true, source: "derived:total" },
    { key: "so_bao_gia", label: "Số báo giá", type: "text", required: true, source: "issue:number" },
  ],
};

// HĐ v3 (FR-13): so_bao_gia / ngay_bao_gia now come from the parent
const contractVersion: TemplateVersionInput = {
  ...base,
  id: "v3",
  template_id: "t1",
  version_no: 3,
  body:
    "<p>{{so_hop_dong}} {{ten_cua_hang}} {{chuc_vu_nguoi_ky}} {{ten_goi}}</p>{{#if so_bao_gia}}<p>Căn cứ báo giá số {{so_bao_gia}} ngày {{ngay_bao_gia}}</p>{{/if}}{{bang_hang}}<p>{{tong_thanh_toan}} {{ngay_ket_thuc}}</p>",
  fields: [
    { key: "ten_cua_hang", label: "Tên cửa hàng", type: "text", required: true, source: "subject:name" },
    { key: "chuc_vu_nguoi_ky", label: "Chức vụ", type: "text", required: true, source: "manual" },
    { key: "so_bao_gia", label: "Số báo giá", type: "text", required: false, source: "parent:number" },
    { key: "ngay_bao_gia", label: "Ngày báo giá", type: "date", required: false, source: "parent:doc_date" },
    { key: "giam_gia", label: "Giảm giá", type: "percent", required: true, source: "manual", default: 0 },
    { key: "ngay_bat_dau", label: "Ngày bắt đầu", type: "date", required: true, source: "manual", default: "derived:doc_date" },
    { key: "ngay_ket_thuc", label: "Ngày kết thúc", type: "date", required: true, source: "derived:contract_end" },
    { key: "ten_goi", label: "Tên gói", type: "text", required: true, source: "derived:service_name" },
    { key: "bang_hang", label: "Bảng hàng", type: "lines", required: true, source: "derived:lines_table" },
    { key: "tong_thanh_toan", label: "Tổng", type: "money", required: true, source: "derived:total" },
    { key: "so_hop_dong", label: "Số hợp đồng", type: "text", required: true, source: "issue:number" },
  ],
  field_rules: [{ all_or_none: ["so_bao_gia", "ngay_bao_gia"] }],
};

const dnttVersion: TemplateVersionInput = {
  ...base,
  id: "vd1",
  template_id: "td",
  version_no: 1,
  body: "<p>Căn cứ hợp đồng số {{so_hop_dong_goc}} ngày {{ngay_hop_dong_goc}}</p>{{bang_hang}}<p>{{so_tien}} ({{so_tien_chu}}) hạn {{han_thanh_toan}} — NM {{so_de_nghi}}</p>",
  fields: [
    { key: "so_hop_dong_goc", label: "Số hợp đồng", type: "text", required: true, source: "parent:number" },
    { key: "ngay_hop_dong_goc", label: "Ngày hợp đồng", type: "date", required: true, source: "parent:doc_date" },
    { key: "bang_hang", label: "Bảng hàng", type: "lines", required: true, source: "derived:lines_table" },
    { key: "so_tien", label: "Số tiền", type: "money", required: true, source: "derived:amount_requested" },
    { key: "so_tien_chu", label: "Bằng chữ", type: "text", required: true, source: "derived:amount_requested_in_words" },
    { key: "han_thanh_toan", label: "Hạn thanh toán", type: "date", required: true, source: "derived:payment_due" },
    { key: "so_de_nghi", label: "Số đề nghị", type: "text", required: true, source: "issue:number" },
  ],
};

function snap(r: ReturnType<typeof buildSnapshot>): Snapshot {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.snapshot;
}

const issuedQuote = (lines: PricedLineInput[], giam_gia: number) => ({
  id: "01BG00000000000000000000Q1",
  type: "quote" as const,
  number: "BG-2026-001",
  doc_date: "2026-09-20",
  snapshot: snap(
    buildSnapshot({ type: "quote", version: quoteVersion, customer, lines, values: { giam_gia }, docDate: "2026-09-20", manualStart: false }),
  ),
});

const issuedContract = (lines: PricedLineInput[], giam_gia: number) => ({
  id: "01HD00000000000000000000H1",
  type: "contract" as const,
  number: "HD-2026-007",
  doc_date: "2026-12-01",
  snapshot: snap(
    buildSnapshot({
      version: contractVersion,
      customer,
      lines,
      values: { giam_gia, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" },
      docDate: "2026-12-01",
      manualStart: false,
    }),
  ),
});

describe("HĐ from an issued BG (SPEC-09 FR-5, DEC-6/7)", () => {
  const child = (parent = issuedQuote([G6], 500), values: Record<string, unknown> = { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" }) =>
    buildChildSnapshot({ parent, childType: "contract", version: contractVersion, customer, values, docDate: "2026-10-01" });

  it("BG 2.700.000 −5% → HĐ 2.565.000 from the frozen lines (no price lookup), parent ref + frozen_from, print cites the BG", () => {
    const parent = issuedQuote([G6], 500);
    const r = child(parent);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.snapshot.lines).toEqual(parent.snapshot.lines);
    expect(r.snapshot).toMatchObject({
      type: "contract",
      parent: { id: parent.id, type: "quote", number: "BG-2026-001", doc_date: "2026-09-20", total: 2_565_000 },
      total: 2_565_000,
      subtotal_ex_vat: 2_700_000,
      discount_bps: 500,
      discount_amount: 135_000,
      vat_groups: parent.snapshot.vat_groups,
      dates: { doc_date: "2026-10-01", start: "2026-10-01", end: "2027-03-31" },
      inputs: {
        frozen_from: parent.id,
        giam_gia: 500,
        chuc_vu_nguoi_ky: "Chủ hộ kinh doanh",
        lines: [{ product_id: G6.product_id, qty: 1, unit_price_ex_vat: 2_700_000, vat_rate_bps: null, price_from: "2026-07-01" }],
      },
      fields: { so_bao_gia: "BG-2026-001", ngay_bao_gia: "20/09/2026", tong_thanh_toan: "2.565.000", giam_gia: "5" },
    });
  });

  it("a parent snapshot whose total does not re-price is a bug → throws", () => {
    const parent = issuedQuote([G6], 500);
    expect(() => child({ ...parent, snapshot: { ...parent.snapshot, total: 2_565_001 } })).toThrow();
  });

  it("DEC-7: a goods-only BG cannot become a HĐ → validation `lines`", () => {
    expect(child(issuedQuote([MIN], 0))).toMatchObject({ ok: false, kind: "invalid", errors: [{ path: "lines" }] });
  });

  it("giam_gia in values (any value) → lines-locked; missing manual field → missing-fields", () => {
    expect(child(undefined, { giam_gia: 0, chuc_vu_nguoi_ky: "x" })).toEqual({ ok: false, kind: "lines-locked" });
    expect(child(undefined, {})).toMatchObject({ ok: false, kind: "missing-fields", missing: [{ key: "chuc_vu_nguoi_ky" }] });
  });

  it("child-type: only CHILD_OF pairs (BG→HĐ, HĐ→DNTT)", () => {
    const parent = issuedQuote([G6], 0);
    expect(buildChildSnapshot({ parent, childType: "payment_request", version: dnttVersion, customer, values: {}, docDate: "2026-10-01" })).toEqual({
      ok: false,
      kind: "child-type",
    });
    expect(buildChildSnapshot({ parent, childType: "quote", version: quoteVersion, customer, values: {}, docDate: "2026-10-01" })).toEqual({
      ok: false,
      kind: "child-type",
    });
  });
});

describe("DNTT from an issued HĐ (SPEC-09 FR-6, DEC-8)", () => {
  const dntt = (parent = issuedContract([G6, MIN], 0), docDate = "2026-12-28", values: Record<string, unknown> = {}) =>
    buildChildSnapshot({ parent, childType: "payment_request", version: dnttVersion, customer, values, docDate });

  it("copies lines, VAT groups, totals, discount verbatim; amount_requested = parent total; payment_due 28/12 → 04/01", () => {
    const parent = issuedContract([G6, MIN], 0);
    const r = dntt(parent);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.snapshot.lines).toEqual(parent.snapshot.lines);
    expect(r.snapshot.vat_groups).toEqual(parent.snapshot.vat_groups);
    for (const k of ["subtotal_ex_vat", "discount_bps", "discount_amount", "total_ex_vat", "vat_total", "total", "total_words"] as const) {
      expect(r.snapshot[k], k).toEqual(parent.snapshot[k]);
    }
    expect(r.snapshot).toMatchObject({
      type: "payment_request",
      parent: { id: parent.id, type: "contract", number: "HD-2026-007", doc_date: "2026-12-01", total: 3_800_000 },
      amount_requested: 3_800_000,
      total: 3_800_000,
      dates: { doc_date: "2026-12-28", payment_due: "2027-01-04" },
      inputs: { frozen_from: parent.id },
      number_fields: ["so_de_nghi"],
      fields: {
        so_hop_dong_goc: "HD-2026-007",
        ngay_hop_dong_goc: "01/12/2026",
        so_tien: "3.800.000",
        so_tien_chu: "Ba triệu tám trăm nghìn đồng",
        han_thanh_toan: "04/01/2027",
      },
    });
  });

  it("a 0đ HĐ → nothing-to-pay; giam_gia in values → lines-locked", () => {
    expect(dntt(issuedContract([G6], 10_000))).toEqual({ ok: false, kind: "nothing-to-pay" });
    expect(dntt(undefined, undefined, { giam_gia: 500 })).toEqual({ ok: false, kind: "lines-locked" });
  });
});
