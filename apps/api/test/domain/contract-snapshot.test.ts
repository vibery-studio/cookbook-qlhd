import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../../src/domain/contract/snapshot";
import type { CustomerInput, PriceRow, TemplateVersionInput } from "../../src/domain/contract/types";

const version: TemplateVersionInput = {
  id: "v1",
  template_id: "t1",
  version_no: 1,
  body: "<p>{{ten_cua_hang}} {{chuc_vu_nguoi_ky}}</p><p>{{tong_tien}} {{tong_tien_bang_chu}}</p>{{#if so_bao_gia}}<p>{{so_bao_gia}} {{ngay_bao_gia}}</p>{{/if}}<p>{{so_hop_dong}}</p>",
  fields: [
    { key: "ten_cua_hang", label: "Tên cửa hàng", type: "text", required: true, source: "subject:name" },
    { key: "chuc_vu_nguoi_ky", label: "Chức vụ", type: "text", required: true, source: "manual" },
    { key: "so_bao_gia", label: "Số báo giá", type: "text", required: false, source: "manual" },
    { key: "ngay_bao_gia", label: "Ngày báo giá", type: "date", required: false, source: "manual" },
    { key: "ma_goi", label: "Gói", type: "choice", required: true, source: "manual", options: ["G3", "G6", "G12"] },
    { key: "so_cua_hang", label: "Số cửa hàng", type: "number", required: true, source: "manual" },
    { key: "giam_gia", label: "Giảm giá", type: "percent", required: true, source: "manual", default: 0 },
    { key: "ngay_bat_dau", label: "Ngày bắt đầu", type: "date", required: true, source: "manual", default: "derived:doc_date" },
    { key: "ngay_hop_dong", label: "Ngày hợp đồng", type: "date", required: true, source: "derived:doc_date" },
    { key: "ngay_ket_thuc", label: "Ngày kết thúc", type: "date", required: true, source: "derived:contract_end" },
    { key: "tong_tien", label: "Tổng tiền", type: "money", required: true, source: "derived:total" },
    { key: "tong_tien_bang_chu", label: "Tổng tiền bằng chữ", type: "text", required: true, source: "derived:total_in_words" },
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

const price: PriceRow = {
  code: "G6",
  name: "Gói 6 tháng",
  duration_value: 6,
  duration_unit: "month",
  unit_price: 2_700_000,
  effective_from: "2026-09-01",
};

const values = { ma_goi: "G6", so_cua_hang: 1, giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" };

describe("contract snapshot", () => {
  it("builds computed fields, line, dates, and print values", () => {
    const result = buildSnapshot({ version, customer, price, values, docDate: "2026-09-28", manualStart: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot).toMatchObject({
        gross: 2_700_000,
        discount_amount: 135_000,
        total: 2_565_000,
        total_words: "Hai triệu năm trăm sáu mươi lăm nghìn đồng",
        dates: { doc_date: "2026-09-28", start: "2026-09-28", end: "2027-03-27" },
        fields: { tong_tien: "2.565.000", giam_gia: "5", ngay_hop_dong: "28/09/2026" },
      });
    }
  });

  it("returns missing required fields and treats whitespace as empty", () => {
    const result = buildSnapshot({
      version,
      customer,
      price,
      values: { ...values, chuc_vu_nguoi_ky: "   " },
      docDate: "2026-09-28",
      manualStart: false,
    });
    expect(result).toEqual({ ok: false, kind: "missing-fields", missing: [{ key: "chuc_vu_nguoi_ky", label: "Chức vụ" }] });
  });

  it("rejects pair-rule violations, a non-contract package, and forged derived input", () => {
    const pair = buildSnapshot({
      version,
      customer,
      price,
      values: { ...values, so_bao_gia: "BG-1" },
      docDate: "2026-09-28",
      manualStart: false,
    });
    if (pair.ok) throw new Error("expected pair-rule failure");
    expect(pair.kind).toBe("invalid");

    const trial = buildSnapshot({
      version,
      customer,
      price: { ...price, code: "DT14", duration_unit: "day" },
      values: { ...values, ma_goi: "DT14" },
      docDate: "2026-09-28",
      manualStart: false,
    });
    expect(trial).toMatchObject({ ok: false, kind: "invalid" });

    const forged = buildSnapshot({
      version,
      customer,
      price,
      values: { ...values, total: 1 },
      docDate: "2026-09-28",
      manualStart: false,
    });
    expect(forged).toMatchObject({ ok: false, kind: "invalid" });
  });
});
