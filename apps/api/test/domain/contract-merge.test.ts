import { describe, expect, it } from "vitest";
import { escapeHtml, mergeFields } from "../../src/domain/contract/merge";
import { renderGoodsTable } from "../../src/domain/contract/goods-table";
import { renderHtml, renderLinesTable, withVoidBand } from "../../src/domain/contract/render";
import type { Snapshot } from "../../src/domain/contract/types";

const snapshot = { fields: { name: "<script>alert(1)</script>", so_bao_gia: "" } } as unknown as Snapshot;

describe("contract merging and rendering", () => {
  it("escapes values and drops empty conditional blocks", () => {
    expect(escapeHtml("<script>\"x\"</script>")).toBe("&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
    expect(mergeFields("<p>{{name}}</p>{{#if so_bao_gia}}<p>{{so_bao_gia}}</p>{{/if}}", snapshot.fields)).toEqual({
      html: "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
      leftover: [],
    });
  });

  it("leaves and lists unresolved placeholders", () => {
    expect(mergeFields("{{known}} {{x}}", { known: "ok" })).toEqual({ html: "ok {{x}}", leftover: ["x"] });
    expect(mergeFields("{{#if empty}}{{unknown}}{{/if}}", { empty: "" })).toEqual({ html: "", leftover: [] });
  });

  it("renders a draft as a complete document and can add a void band", () => {
    const result = renderHtml("<p>Số: {{so_hop_dong}}</p>{{name}}", snapshot, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain('<meta charset="utf-8">');
      expect(result.html).toContain("Số: (chưa có số)");
      expect(result.html).toContain("NHÁP");
      expect(result.html).not.toContain("<script>");
      expect(withVoidBand(result.html)).toContain("ĐÃ HỦY");
    }
  });

  it("the line table (trusted channel) escapes every cell; only line_table_fields get it (PLAN-08 R-5)", () => {
    const line = {
      product_id: "01PROD000000000000000XSS01",
      code: "XSS-01",
      name: "<b>x</b>",
      kind: "goods" as const,
      unit: "<i>cái</i>",
      duration_value: null,
      duration_unit: null,
      qty: 1000,
      unit_price_ex_vat: 1_000,
      vat_rate_bps: 1000,
      price_from: "2026-01-01",
      amount_ex_vat: 1_000_000,
      discount_amount: 0,
      net_ex_vat: 1_000_000,
    };
    const table = renderLinesTable([line, { ...line, name: "Gói", vat_rate_bps: null }]);
    expect(table).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(table).toContain("&lt;i&gt;cái&lt;/i&gt;");
    expect(table).not.toContain("<b>");
    for (const text of ["STT", "Đơn giá chưa VAT", "Thuế suất", "Thành tiền chưa VAT", "1.000.000", "10%", "KCT"]) {
      expect(table, text).toContain(text);
    }
    const snap = { fields: { bang_hang: "<b>x</b> × 1", note: "<b>n</b>" }, line_table_fields: ["bang_hang"], lines: [line] } as unknown as Snapshot;
    const result = renderHtml("<div>{{bang_hang}}</div><p>{{note}}</p>", snap, "HD-1");
    if (!result.ok) throw new Error("render failed");
    expect(result.html).toContain('<table class="lines">');
    expect(result.html).toContain("&lt;b&gt;n&lt;/b&gt;");
    expect(result.html).not.toContain("<b>");
    // a key not listed in line_table_fields is plain escaped text, never the table
    expect(mergeFields("{{note}}", { note: "<table>" }, {}).html).toBe("&lt;table&gt;");
  });

  it("02-VT goods table (SPEC-09 DEC-12 A): A–D + 1–4 columns, qty only in (1), 2–4 blank, a blank 'Cộng' row, every cell escaped", () => {
    const goods = [
      { product_id: "01PROD000000000000000XSS01", code: "<i>XSS</i>", name: "<b>x</b>", unit: "c&i", qty: 1200 },
      { product_id: "01PROD00000000000DEMOMIN01", code: "DEMO-MIN-01", name: "Máy in hóa đơn (DEMO)", unit: "cái", qty: 2 },
    ];
    const table = renderGoodsTable(goods);
    expect(table).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(table).toContain("&lt;i&gt;XSS&lt;/i&gt;");
    expect(table).toContain("c&amp;i");
    expect(table).not.toContain("<b>");
    expect(table).not.toContain("<i>");
    for (const text of ["STT", "Tên, nhãn hiệu, quy cách", "Mã số", "Đơn vị tính", "Số lượng", "Yêu cầu", "Thực xuất", "Đơn giá", "Thành tiền", "Cộng"]) {
      expect(table, text).toContain(text);
    }
    for (const col of ["A", "B", "C", "D", "1", "2", "3", "4"]) expect(table, col).toContain(`<td class="center">${col}</td>`);
    // row 1: STT, B, C, D, Yêu cầu = 1.200, Thực xuất / Đơn giá / Thành tiền blank
    expect(table).toContain(
      '<tr><td class="center">1</td><td>&lt;b&gt;x&lt;/b&gt;</td><td>&lt;i&gt;XSS&lt;/i&gt;</td><td>c&amp;i</td><td class="num">1.200</td><td class="num"></td><td class="num"></td><td class="num"></td></tr>',
    );
    expect(table).toContain('<tr><td></td><td class="b">Cộng</td><td></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td></tr>');

    const snap = {
      type: "delivery_note",
      fields: { bang_hang_hoa: "<b>x</b> × 1200", so_phieu: "" },
      line_table_fields: [],
      goods_table_fields: ["bang_hang_hoa"],
      number_fields: ["so_phieu"],
      lines: goods,
    } as unknown as Snapshot;
    const result = renderHtml("<p>Số: {{so_phieu}}</p><div>{{bang_hang_hoa}}</div>", snap, "PXK-2026-001");
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.html).toContain("Số: PXK-2026-001");
    expect(result.html).toContain("Yêu cầu");
    expect(result.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(result.html).not.toContain("<b>x</b>");
    expect(result.html).toContain("<title>Phiếu xuất kho</title>");
  });

  it("an old snapshot (no number_fields) still prints its number into so_hop_dong", () => {
    const result = renderHtml("<p>{{so_hop_dong}}</p>", { fields: {} } as unknown as Snapshot, "HD-2026-001");
    if (!result.ok) throw new Error("render failed");
    expect(result.html).toContain("<p>HD-2026-001</p>");
    expect(result.html).toContain("<title>Hợp đồng</title>");
  });
});
