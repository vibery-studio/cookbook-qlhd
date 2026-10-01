#!/usr/bin/env node
/**
 * SPEC-10 test fixtures (PLAN-10 §1). Builds the hand-made .docx cases next to the 3 box files
 * (Bao_Gia.docx, Hop_Dong_Dich_Vu.docx, De_Nghi_Thanh_Toan.docx — copied verbatim from owner-box/07_Mau_Tai_Lieu),
 * then writes fixtures.generated.ts (base64 of every fixture) so tests inside the Workers pool can read them
 * without node:fs.
 *
 *   node apps/api/test/fixtures/docx/build-fixtures.mjs
 *
 * No dependencies: a tiny zip writer (stored/deflate via node:zlib) lives below. Output is deterministic
 * (fixed DOS timestamp), so re-running leaves git clean.
 */
import { deflateRawSync } from "node:zlib";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- zip writer
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 1; // 2026-10-01

/**
 * entries: [{ name, data: string|Buffer, store?: boolean, declaredSize?: number }]
 * `declaredSize` lies about the uncompressed size in both headers (zip-bomb case: header says small, data inflates big).
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const method = e.store ? 0 : 8;
    const comp = e.store ? raw : deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const size = e.declaredSize ?? raw.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------------------------------------------------------------- WordprocessingML helpers
const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const MACRO_CT = "application/vnd.ms-word.document.macroEnabled.main+xml";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const t = (s) => `<w:t xml:space="preserve">${esc(s)}</w:t>`;
const run = (s, rpr = "") => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}${t(s)}</w:r>`;
const para = (inner, ppr = "") => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${inner}</w:p>`;
const p = (s) => para(run(s));
const cell = (inner, tcpr = "") => `<w:tc>${tcpr ? `<w:tcPr>${tcpr}</w:tcPr>` : ""}${inner}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.join("")}</w:tr>`;
const table = (...rows) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.join("")}</w:tbl>`;
const documentXml = (body) => `${XML_DECL}<w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`;

function contentTypes({ main = MAIN_CT, extra = "" } = {}) {
  return (
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/word/document.xml" ContentType="${main}"/>${extra}</Types>`
  );
}
const ROOT_RELS =
  `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";
function docRels(rels = "") {
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}
/** A minimal valid .docx around a body string. */
function docx(body, { ct = {}, rels = "", parts = [] } = {}) {
  return zip([
    { name: "[Content_Types].xml", data: contentTypes(ct) },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "word/document.xml", data: documentXml(body) },
    { name: "word/_rels/document.xml.rels", data: docRels(rels) },
    ...parts,
  ]);
}

// ---------------------------------------------------------------- the fixtures
const fixtures = {};

// AC-2 — split runs, Vietnamese keys (one no template has), duplicates, a placeholder broken across two paragraphs
fixtures["split-run.docx"] = docx(
  [
    para(
      run("Kính gửi {{ten_", "<w:b/>") +
        '<w:proofErr w:type="spellStart"/>' +
        '<w:r w:rsidR="00A1B2C3">' + t("khach") + "</w:r>" +
        '<w:proofErr w:type="spellEnd"/>' +
        run("}}, chủ cửa hàng {{Tên khách}}."),
    ),
    p("Số đề nghị: {{so_de_nghi}}"),
    p("Nội dung chuyển khoản: NM {{so_de_nghi}}"),
    p("Mã nội bộ: {{Mã nội bộ}}"),
    p("Kết thúc {{ten"),
    p("khach}} — dòng này vắt qua hai đoạn."),
  ].join(""),
);

// AC-5 — script text, javascript: hyperlink, image, header with a placeholder, merged cells
fixtures["xss-and-drops.docx"] = docx(
  [
    p("<script>alert(1)</script>"),
    para('<w:hyperlink r:id="rId20">' + run("bấm đây") + "</w:hyperlink>" + run(" để xem {{ten_khach}}")),
    para(
      '<w:r><w:drawing><wp:inline><wp:extent cx="1" cy="1"/><wp:docPr id="1" name="logo"/>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"/></a:graphic>' +
        "</wp:inline></w:drawing></w:r>" + run("Logo công ty"),
    ),
    table(
      row(cell(p("Gộp hai cột {{so_hop_dong}}"), '<w:gridSpan w:val="2"/>')),
      row(cell(p("A")), cell(p("B"))),
    ),
  ].join(""),
  {
    ct: {
      extra:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    },
    rels:
      '<Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>' +
      '<Relationship Id="rId21" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
    parts: [
      {
        name: "word/header1.xml",
        data: `${XML_DECL}<w:hdr ${NS}>${p("Đầu trang {{x}}")}</w:hdr>`,
      },
    ],
  },
);

// unit — structure mapping (§3.2 step 4): headings, alignment, bold/italic merge, br/tab, lists, tracked changes, sdt,
// field codes, footnote/comment marks, nested table, text box, page break, #if
fixtures["structure.docx"] = docx(
  [
    para(run("TIÊU ĐỀ"), '<w:pStyle w:val="Title"/>'),
    para(run("Mục 2"), '<w:pStyle w:val="Heading2"/>'),
    para(run("Mục 4"), '<w:pStyle w:val="Heading4"/>'),
    para(run("Giữa"), '<w:jc w:val="center"/>'),
    para(run("Phải"), '<w:jc w:val="end"/>'),
    para(run("Đậm ", "<w:b/>") + run("liền", "<w:b/>") + run(" thường ") + run("nghiêng", "<w:i/>")),
    para(run("Dòng một") + "<w:r><w:br/></w:r>" + run("Dòng hai") + "<w:r><w:tab/></w:r>" + run("sau tab")),
    para('<w:r><w:br w:type="page"/></w:r>' + run("Sau ngắt trang")),
    para(run("Mục một"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    para(run("Mục hai"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    para(run("Giữ ") + '<w:ins w:id="1" w:author="A">' + run("chèn") + "</w:ins>" + '<w:del w:id="2" w:author="A"><w:r><w:delText>xóa</w:delText></w:r></w:del>'),
    para('<w:sdt><w:sdtContent>' + run("Trong sdt") + "</w:sdtContent></w:sdt>"),
    para('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' + run("Sau field")),
    para(run("Có chú thích") + '<w:r><w:footnoteReference w:id="1"/></w:r>' + '<w:commentRangeStart w:id="0"/>' + run("bình luận") + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>'),
    para('<w:r><w:pict><v:shape><v:textbox><w:txbxContent>' + p("Trong hộp chữ") + "</w:txbxContent></v:textbox></v:shape></w:pict></w:r>"),
    table(row(cell(p("Ngoài") + table(row(cell(p("Bảng lồng"))))), cell(p("Ô 2")))),
    p("{{#if so_bao_gia}}Căn cứ báo giá số {{so_bao_gia}}{{/if}}"),
    p("Sai: {{1abc}} {{}} {{a-b}} {{  so_hop_dong  }}"),
  ].join(""),
);

// unit — a doc with no placeholder at all
fixtures["no-fields.docx"] = docx(p("Văn bản không có trường nào."));

// AC-4 / unit — .docm: macro-enabled main part + vbaProject.bin
fixtures["macro.docm"] = docx(p("Có macro {{ten_khach}}"), {
  ct: {
    main: MACRO_CT,
    extra: '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>',
  },
  rels: '<Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>',
  parts: [{ name: "word/vbaProject.bin", data: Buffer.from("not really VBA"), store: true }],
});

// AC-4 — document.xml inflates to ~3 MB (honest header)
const HUGE = documentXml(p("x".repeat(3 * 1024 * 1024)));
fixtures["bomb-declared.docx"] = zip([
  { name: "[Content_Types].xml", data: contentTypes() },
  { name: "_rels/.rels", data: ROOT_RELS },
  { name: "word/document.xml", data: HUGE },
]);
// unit — same data, header LIES (says 4 KB) → the real inflated byte count must catch it
fixtures["bomb-lying.docx"] = zip([
  { name: "[Content_Types].xml", data: contentTypes() },
  { name: "_rels/.rels", data: ROOT_RELS },
  { name: "word/document.xml", data: HUGE, declaredSize: 4096 },
]);

// AC-4 — DOCTYPE with nested entities (billion laughs)
fixtures["doctype.docx"] = zip([
  { name: "[Content_Types].xml", data: contentTypes() },
  { name: "_rels/.rels", data: ROOT_RELS },
  {
    name: "word/document.xml",
    data:
      `${XML_DECL}<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">` +
      '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>' +
      `<w:document ${NS}><w:body>${para('<w:r><w:t>&lol3;</w:t></w:r>')}</w:body></w:document>`,
  },
]);

// unit — malformed XML
fixtures["broken-xml.docx"] = zip([
  { name: "[Content_Types].xml", data: contentTypes() },
  { name: "_rels/.rels", data: ROOT_RELS },
  { name: "word/document.xml", data: `${XML_DECL}<w:document ${NS}><w:body><w:p><w:r><w:t>mở mà không đóng` },
]);

// unit — content types say docx, but no word/document.xml
fixtures["no-document.docx"] = zip([
  { name: "[Content_Types].xml", data: contentTypes() },
  { name: "_rels/.rels", data: ROOT_RELS },
]);

// unit — an ordinary zip (no [Content_Types].xml main part) → not_docx
fixtures["plain.zip"] = zip([{ name: "readme.txt", data: "chỉ là zip thường" }]);

// unit — 1001 entries → too_many_entries
fixtures["many-entries.docx"] = zip([
  { name: "[Content_Types].xml", data: contentTypes() },
  { name: "_rels/.rels", data: ROOT_RELS },
  { name: "word/document.xml", data: documentXml(p("ok")) },
  ...Array.from({ length: 998 }, (_, i) => ({ name: `f/${i}`, data: "", store: true })),
]);

// unit — body > 64 KB after conversion (still < 2 MB inflated) → checkTemplate `too_large`
fixtures["big-body.docx"] = docx(
  Array.from({ length: 700 }, (_, i) => p(`Đoạn ${i}: ${"Nội dung dài để vượt 64 KB. ".repeat(4)}`)).join(""),
);

// AC-4 — a PDF
fixtures["not-a-docx.pdf"] = Buffer.from(
  "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
  "latin1",
);

for (const [name, buf] of Object.entries(fixtures)) writeFileSync(join(DIR, name), buf);

// ---------------------------------------------------------------- fixtures.generated.ts (box files + the above)
const files = readdirSync(DIR)
  .filter((f) => /\.(docx|docm|zip|pdf)$/.test(f))
  .sort();
const lines = files.map((f) => `  ${JSON.stringify(f)}: ${JSON.stringify(readFileSync(join(DIR, f)).toString("base64"))},`);
writeFileSync(
  join(DIR, "fixtures.generated.ts"),
  `// GENERATED by build-fixtures.mjs — do not edit. Base64 of every fixture so Workers-pool tests can read them without node:fs.
export const DOCX_FIXTURES = {
${lines.join("\n")}
} as const;

export type DocxFixtureName = keyof typeof DOCX_FIXTURES;

export function fixtureBytes(name: DocxFixtureName): Uint8Array {
  const bin = atob(DOCX_FIXTURES[name]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
`,
);
console.log(`wrote ${Object.keys(fixtures).length} fixtures + fixtures.generated.ts (${files.length} files)`);
