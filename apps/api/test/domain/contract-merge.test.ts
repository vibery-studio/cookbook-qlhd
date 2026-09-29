import { describe, expect, it } from "vitest";
import { escapeHtml, mergeFields } from "../../src/domain/contract/merge";
import { renderHtml, withVoidBand } from "../../src/domain/contract/render";
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
});
