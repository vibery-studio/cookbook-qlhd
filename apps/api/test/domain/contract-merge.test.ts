import { describe, expect, it } from "vitest";
import { escapeHtml, mergeFields } from "../../src/domain/contract/merge";
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
});
