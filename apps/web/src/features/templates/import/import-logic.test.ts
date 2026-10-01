import { describe, expect, it } from "vitest";
import type { components } from "@runway/client";
import {
  badgesFor,
  buildFields,
  createBody,
  errorsByRow,
  highlightPlaceholders,
  importNote,
  mergeRows,
  rowsFromPreview,
  touchRow,
  unresolvedErrors,
  templateNameFromFile,
  versionBody,
  type FieldRow,
} from "./import-logic";

type Preview = components["schemas"]["TemplateImportPreview"];
type Placeholder = components["schemas"]["TemplateImportPlaceholder"];

const ph = (key: string, over: Partial<Placeholder> = {}, suggested: Partial<Placeholder["suggested"]> = {}): Placeholder => ({
  key,
  original: key,
  count: 1,
  table_index: null,
  suggestion_from: "none",
  suggested: { key, label: key, type: "text", required: true, source: "manual", ...suggested },
  ...over,
});

const preview = (placeholders: Placeholder[], over: Partial<Preview> = {}): Preview => ({
  body: "<p>{{a}}</p>",
  placeholders,
  tables: [],
  removed: [],
  warnings: [],
  sources: ["manual", "derived:total"],
  base: {
    template_id: null,
    version_no: null,
    approval_policy: { mode: "none" },
    field_rules: [{ all_or_none: ["a", "b"] }],
    default_line_items: [],
    default_clauses: [],
  },
  check_errors: [],
  stats: { body_bytes: 12, fields: placeholders.length },
  ...over,
});

describe("templateNameFromFile", () => {
  it("drops .docx and turns _ into spaces", () => {
    expect(templateNameFromFile("Bao_Gia.docx")).toBe("Bao Gia");
    expect(templateNameFromFile("De__nghi_thanh_toan.DOCX")).toBe("De nghi thanh toan");
    expect(templateNameFromFile("mau")).toBe("mau");
  });
});

describe("save payload (P-3: web sets the note)", () => {
  const p = preview([ph("a", {}, { label: "Nhãn A" })]);
  const rows = rowsFromPreview(p);
  it("note", () => expect(importNote("Bao_Gia.docx")).toBe("Nhập từ Bao_Gia.docx"));
  it("new template body", () => {
    const body = createBody({ type: "contract", name: "Bao Gia", fileName: "Bao_Gia.docx", preview: p, rows });
    expect(body).toMatchObject({
      type: "contract",
      name: "Bao Gia",
      subject_type: "customer",
      version: {
        body: p.body,
        fields: [{ key: "a", label: "Nhãn A", type: "text", required: true, source: "manual" }],
        field_rules: p.base.field_rules,
        default_line_items: [],
        default_clauses: [],
        approval_policy: { mode: "none" },
        note: "Nhập từ Bao_Gia.docx",
      },
    });
  });
  it("new version body carries expected_version_no from base", () => {
    const withBase = preview([ph("a")], { base: { ...p.base, template_id: "T1", version_no: 3 } });
    const body = versionBody({ fileName: "Bao_Gia.docx", preview: withBase, rows: rowsFromPreview(withBase) });
    expect(body.expected_version_no).toBe(3);
    expect(body.note).toBe("Nhập từ Bao_Gia.docx");
    expect(body.body).toBe(withBase.body);
  });
  it("version without a base version number is refused", () => {
    expect(() => versionBody({ fileName: "x.docx", preview: p, rows })).toThrow();
  });
  it("choice options come from the text box; other types carry none", () => {
    const r: FieldRow[] = [
      { ...rows[0]!, type: "choice", optionsText: " Có , Không,, " },
      { ...rows[0]!, key: "b", type: "text", optionsText: "x" },
    ];
    const f = buildFields(r);
    expect(f[0]!.options).toEqual(["Có", "Không"]);
    expect(f[1]).not.toHaveProperty("options");
  });
  it("keeps a suggested default", () => {
    const p2 = preview([ph("a", {}, { default: "x" })]);
    expect(buildFields(rowsFromPreview(p2))[0]!.default).toBe("x");
  });
});

describe("badges", () => {
  const row = (over: Partial<FieldRow>): FieldRow => ({ ...rowsFromPreview(preview([ph("a")]))[0]!, ...over });
  it("suggestion origin", () => {
    expect(badgesFor(row({ from: "current_version" }))).toContain("gợi ý từ: phiên bản hiện tại");
    expect(badgesFor(row({ from: "other_template" }))).toContain("gợi ý từ: mẫu khác");
    expect(badgesFor(row({ from: "none" }))).toContain("mới");
  });
  it("manual → Người lập nhập tay; money + manual → Tiền nhập tay too", () => {
    expect(badgesFor(row({ source: "manual", type: "text" }))).toContain("Người lập nhập tay");
    expect(badgesFor(row({ source: "manual", type: "text" }))).not.toContain("Tiền nhập tay");
    const money = badgesFor(row({ source: "manual", type: "money" }));
    expect(money).toContain("Người lập nhập tay");
    expect(money).toContain("Tiền nhập tay");
    const derived = badgesFor(row({ source: "derived:total", type: "money" }));
    expect(derived).not.toContain("Người lập nhập tay");
    expect(derived).not.toContain("Tiền nhập tay");
  });
});

describe("errors → rows", () => {
  it("maps by key; keyless go to general", () => {
    const m = errorsByRow([
      { key: "a", message: "A sai" },
      { key: "a", message: "A nữa" },
      { key: "b", message: "B sai" },
      { path: "version.body", message: "Quá dài" },
    ]);
    expect(m.byKey["a"]).toEqual(["A sai", "A nữa"]);
    expect(m.byKey["b"]).toEqual(["B sai"]);
    expect(m.general).toEqual(["Quá dài"]);
  });
  it("editing a row clears its (stale) preview errors; keyless remain; Lưu blocked while any remain", () => {
    const errs = [
      { key: "a", message: "A sai" },
      { message: "Quá dài" },
    ];
    expect(unresolvedErrors(errs, new Set(["a"]))).toEqual([{ message: "Quá dài" }]);
    expect(unresolvedErrors(errs, new Set())).toHaveLength(2);
  });
});

describe("re-preview keeps the user's edits (409 stale / lines_table)", () => {
  it("applies label/type/required/source/options by key to touched rows only", () => {
    const first = rowsFromPreview(preview([ph("a"), ph("b"), ph("c")]));
    let edited = touchRow(first, "a", { label: "Nhãn mới", source: "derived:total", required: false });
    edited = touchRow(edited, "b", { type: "choice", optionsText: "x,y" });
    const next = preview([ph("a", {}, { label: "server-a" }), ph("b", {}, { label: "server-b" }), ph("c", {}, { label: "server-c" }), ph("d")]);
    const merged = mergeRows(edited, next);
    expect(merged.map((r) => r.key)).toEqual(["a", "b", "c", "d"]);
    expect(merged[0]).toMatchObject({ label: "Nhãn mới", source: "derived:total", required: false, touched: true });
    expect(merged[1]).toMatchObject({ type: "choice", optionsText: "x,y", label: "server-b" === merged[1]!.label ? "server-b" : merged[1]!.label });
    expect(merged[2]!.label).toBe("server-c"); // untouched → fresh suggestion
    expect(merged[3]!.touched).toBe(false);
  });
  it("a key gone from the new preview is dropped", () => {
    const first = touchRow(rowsFromPreview(preview([ph("a"), ph("don_gia")])), "don_gia", { label: "x" });
    expect(mergeRows(first, preview([ph("a")])).map((r) => r.key)).toEqual(["a"]);
  });
});

describe("highlightPlaceholders", () => {
  it("wraps {{…}} on the string, leaves escaped text alone", () => {
    const html = highlightPlaceholders("<p>Kính gửi {{ten_khach}} &lt;b&gt; {{a}}</p>");
    expect(html).toContain("<mark>{{ten_khach}}</mark>");
    expect(html).toContain("<mark>{{a}}</mark>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<script");
  });
});
