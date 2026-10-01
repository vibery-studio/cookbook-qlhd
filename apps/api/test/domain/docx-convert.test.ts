/**
 * SPEC-10 §3.2 — the pure .docx → template-body converter (C-10-002, DEC-1 B: fflate + fast-xml-parser + own walker).
 * Only what the API acceptance file (test/integration/templates-import-acceptance.test.ts) cannot see: the structure
 * mapping, the slug table, the rejections that need a crafted zip (lying size header, 1001 entries, broken XML, no
 * document part, plain zip, OLE/empty input), De_Nghi + Hop_Dong details, and the 64 KB limit seen through checkTemplate.
 * Written before the code: the module is loaded with a dynamic import so this file compiles before C-10-002.
 *
 * Contract pinned here (PLAN-10 §2b):
 *   convertDocx(bytes, { linesTable? }) → DocxConversion | { error: DocxErrorReason }  — never throws.
 *     DocxConversion = { body, placeholders: [{ key, originals: string[], count, table_index: number|null }],
 *       tables: [{ index, rows, cols, placeholder_keys }] (only tables holding a placeholder; index = position among ALL
 *       top-level w:tbl of w:body), removed: [{ kind: "internal_note", text }], warnings: [{ code, message, count }] }
 *     `count` = every reference of the key, `{{#if k}}` included. A linesTable index out of range is ignored (the service
 *     answers 422 `validation`).
 *   slugKey(original) → string | null — trim, fold (Vietnamese marks, đ), lowercase, non [a-z0-9] runs → "_", trim "_";
 *     null when empty or starting with a digit.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkTemplate } from "../../src/domain/template-check";
import { fixtureBytes } from "../fixtures/docx/fixtures.generated";

type DocxErrorReason = "not_docx" | "macro_enabled" | "no_document" | "xml_invalid" | "too_large_inflated" | "too_many_entries";
interface DocxConversion {
  body: string;
  placeholders: Array<{ key: string; originals: string[]; count: number; table_index: number | null }>;
  tables: Array<{ index: number; rows: number; cols: number; placeholder_keys: string[] }>;
  removed: Array<{ kind: "internal_note"; text: string }>;
  warnings: Array<{ code: string; message: string; count: number }>;
}
interface DocxModule {
  convertDocx(bytes: Uint8Array, opts?: { linesTable?: number }): DocxConversion | { error: DocxErrorReason };
  slugKey(original: string): string | null;
}

let docx: DocxModule;
beforeAll(async () => {
  docx = (await import(/* @vite-ignore */ "../../src/domain/docx/" + "index")) as DocxModule;
});

function ok(bytes: Uint8Array, opts?: { linesTable?: number }): DocxConversion {
  const r = docx.convertDocx(bytes, opts);
  if ("error" in r) throw new Error(`expected a conversion, got error ${r.error}`);
  return r;
}
const keys = (c: DocxConversion) => c.placeholders.map((p) => p.key).sort();
const codes = (c: DocxConversion) => c.warnings.map((w) => w.code);
const manualFields = (c: DocxConversion) =>
  c.placeholders.map((p) => ({ key: p.key, label: p.key, type: "text", required: false, source: "manual" }));

describe("box files (07_Mau_Tai_Lieu)", () => {
  it("all three convert into the checkTemplate tag set, with no internal note left", () => {
    for (const name of ["Bao_Gia.docx", "Hop_Dong_Dich_Vu.docx", "De_Nghi_Thanh_Toan.docx"] as const) {
      const c = ok(fixtureBytes(name));
      const errs = checkTemplate({ body: c.body, fields: manualFields(c), approval_policy: { mode: "none" } });
      expect(errs.map((e) => e.code), name).not.toContain("html_not_allowed");
      expect(errs.map((e) => e.code), name).not.toContain("internal_note");
      expect(errs.map((e) => e.code), name).not.toContain("placeholder_without_field");
    }
  });

  it("De_Nghi_Thanh_Toan: so_de_nghi ×2, the 2-column table keeps '{{ten_goi}} × {{so_cua_hang}} cửa hàng' in one cell", () => {
    const c = ok(fixtureBytes("De_Nghi_Thanh_Toan.docx"));
    expect(c.placeholders).toHaveLength(11);
    expect(c.placeholders.find((p) => p.key === "so_de_nghi")?.count).toBe(2);
    expect(c.tables).toEqual([{ index: 0, rows: 2, cols: 2, placeholder_keys: ["ten_goi", "so_cua_hang", "so_tien"] }]);
    expect(c.body).toContain("<td>{{ten_goi}} × {{so_cua_hang}} cửa hàng</td>");
    expect(c.body).toContain("<h1>ĐỀ NGHỊ THANH TOÁN</h1>");
  });

  it("Hop_Dong_Dich_Vu: Heading1 → 1 <h1>, Heading2 → 7 <h2>, signature table kept but not listed, internal note removed whole", () => {
    const c = ok(fixtureBytes("Hop_Dong_Dich_Vu.docx"));
    expect(c.body.match(/<h1>/g)).toHaveLength(1);
    expect(c.body.match(/<h2>/g)).toHaveLength(7);
    expect(c.body).toContain("<td>ĐẠI DIỆN BÊN A</td>");
    expect(c.tables).toEqual([]);
    expect(c.removed).toHaveLength(1);
    expect(c.removed[0]?.text.startsWith("Ghi chú nội bộ (xóa trước khi gửi khách)")).toBe(true);
    expect(c.placeholders).toHaveLength(16);
  });

  it("Bao_Gia: a linesTable index out of range is ignored (the service answers 422)", () => {
    const c = ok(fixtureBytes("Bao_Gia.docx"), { linesTable: 5 });
    expect(c.body).toContain("<table>");
    expect(keys(c)).not.toContain("bang_hang");
  });
});

describe("structure mapping (§3.2 step 4)", () => {
  let c: DocxConversion;
  beforeAll(() => {
    c = ok(fixtureBytes("structure.docx"));
  });

  it("headings, alignment, merged bold runs, italics, line break, tab", () => {
    expect(c.body).toContain("<h1>TIÊU ĐỀ</h1>"); // Title → h1
    expect(c.body).toContain("<h2>Mục 2</h2>");
    expect(c.body).toContain("<h3>Mục 4</h3>"); // Heading3–9 → h3
    expect(c.body).toContain('<p class="center">Giữa</p>');
    expect(c.body).toContain('<p class="right">Phải</p>'); // jc end → right
    expect(c.body).toContain("<strong>Đậm liền</strong> thường <em>nghiêng</em>");
    expect(c.body).toContain("Dòng một<br>Dòng hai sau tab");
  });

  it("page break, Word numbering, tracked changes, sdt, field codes, footnote/comment marks, text box, nested table", () => {
    expect(c.body).toContain("<p>Sau ngắt trang</p>");
    expect(c.body).toContain("<ul><li>Mục một</li><li>Mục hai</li></ul>");
    expect(c.body).toContain("Giữ chèn");
    expect(c.body).not.toContain("xóa");
    expect(c.body).toContain("Trong sdt");
    expect(c.body).not.toContain("PAGE");
    expect(c.body).toContain("Có chú thích");
    expect(c.body).toContain("bình luận");
    expect(c.body).not.toContain("Trong hộp chữ");
    expect(c.body).toContain("Bảng lồng"); // flattened, text kept
    expect(c.body.match(/<table>/g)).toHaveLength(1);
    for (const code of [
      "page_break_dropped",
      "numbering_flattened",
      "tracked_changes_accepted",
      "field_code_dropped",
      "footnote_dropped",
      "comment_dropped",
      "textbox_dropped",
      "nested_table_flattened",
    ]) {
      expect(codes(c).filter((x) => x === code), code).toHaveLength(1);
    }
    for (const w of c.warnings) expect(w.count, w.code).toBeGreaterThanOrEqual(1);
  });

  it("{{#if}} kept; bad keys: '{{1abc}}' / '{{}}' left as text, 'a-b' → a_b (renamed), '  so_hop_dong  ' trimmed (not a rename)", () => {
    expect(c.body).toContain("{{#if so_bao_gia}}Căn cứ báo giá số {{so_bao_gia}}{{/if}}");
    expect(c.placeholders.find((p) => p.key === "so_bao_gia")?.count).toBe(2);
    expect(c.body).toContain("{{1abc}}");
    expect(c.body).toContain("{{}}");
    expect(c.body).toContain("{{a_b}}");
    expect(c.body).toContain("{{so_hop_dong}}");
    expect(keys(c)).toEqual(["a_b", "so_bao_gia", "so_hop_dong"]);
    expect(c.placeholders.find((p) => p.key === "a_b")?.originals).toEqual(["a-b"]);
    expect(c.warnings.find((w) => w.code === "key_renamed")?.count).toBe(1);
    const errs = checkTemplate({ body: c.body, fields: manualFields(c), approval_policy: { mode: "none" } });
    expect(errs.filter((e) => e.code === "placeholder_without_field").length).toBeGreaterThanOrEqual(2); // {{1abc}}, {{}}
  });
});

describe("slugKey (DEC-3)", () => {
  it.each([
    ["Tên khách", "ten_khach"],
    ["  so_hop_dong ", "so_hop_dong"],
    ["ĐƠN GIÁ", "don_gia"],
    ["Số-HĐ", "so_hd"],
    ["a-b", "a_b"],
    ["ngày  bắt   đầu", "ngay_bat_dau"],
    ["_x_", "x"],
    ["1abc", null],
    ["", null],
    ["   ", null],
    ["---", null],
  ])("%j → %j", (input, expected) => {
    expect(docx.slugKey(input)).toBe(expected);
  });
});

describe("rejections only a crafted zip can show (FR-8, DEC-9) — never throws", () => {
  it.each([
    ["bomb-lying.docx", "too_large_inflated"], // header says 4 KB; real bytes counted
    ["many-entries.docx", "too_many_entries"],
    ["broken-xml.docx", "xml_invalid"],
    ["no-document.docx", "no_document"],
    ["plain.zip", "not_docx"],
  ] as const)("%s → %s", (name, reason) => {
    expect(docx.convertDocx(fixtureBytes(name))).toEqual({ error: reason });
  });

  it("empty input, an OLE file (.doc / password docx), a truncated zip → not_docx", () => {
    expect(docx.convertDocx(new Uint8Array())).toEqual({ error: "not_docx" });
    expect(docx.convertDocx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toEqual({ error: "not_docx" });
    expect(docx.convertDocx(fixtureBytes("Bao_Gia.docx").slice(0, 2000))).toEqual({ error: "not_docx" });
  });
});

describe("edges", () => {
  it("no {{…}} at all → zero placeholders, text kept", () => {
    const c = ok(fixtureBytes("no-fields.docx"));
    expect(c.placeholders).toEqual([]);
    expect(c.body).toBe("<p>Văn bản không có trường nào.</p>");
  });

  it("body > 64 KB after conversion → checkTemplate too_large (shown at preview as check_errors)", () => {
    const c = ok(fixtureBytes("big-body.docx"));
    expect(new TextEncoder().encode(c.body).length).toBeGreaterThan(64 * 1024);
    const errs = checkTemplate({ body: c.body, fields: [], approval_policy: { mode: "none" } });
    expect(errs.map((e) => e.code)).toContain("too_large");
  });
});
