/**
 * SPEC-10 §3.2 step 4 — walk w:body into the checkTemplate tag set ONLY (DEC-7): p h1 h2 h3 br strong em ul li
 * table tr td, and `class` ∈ {center, right}. Every character of document text goes through `esc`; no attribute,
 * URL or style from the file is ever copied. Unsupported content is dropped/flattened with one warning per kind.
 */
import { isInternalNote, rewritePlaceholders, type Piece, type Ref } from "./placeholders";
import { attr, child, contains, kids, nameOf, textOf, type XNode } from "./xml";

export type WarningCode =
  | "key_renamed"
  | "key_merged"
  | "image_dropped"
  | "header_footer_dropped"
  | "header_footer_placeholder"
  | "textbox_dropped"
  | "footnote_dropped"
  | "comment_dropped"
  | "merged_cells_flattened"
  | "nested_table_flattened"
  | "numbering_flattened"
  | "page_break_dropped"
  | "tracked_changes_accepted"
  | "field_code_dropped"
  | "altchunk_dropped";

export const WARNING_MESSAGES: Record<WarningCode, string> = {
  key_renamed: "Tên trường không đúng dạng chữ thường không dấu, đã đổi (nhãn giữ tên gốc).",
  key_merged: "Nhiều tên trường khác nhau cho ra cùng một key, đã gộp làm một trường.",
  image_dropped: "Ảnh / hình vẽ không chuyển được, đã bỏ.",
  header_footer_dropped: "Đầu trang / chân trang không chuyển được, đã bỏ.",
  header_footer_placeholder: "Đầu trang / chân trang có trường {{…}} nhưng không được đưa vào mẫu; hãy chuyển trường đó vào thân văn bản.",
  textbox_dropped: "Hộp chữ (text box) không chuyển được, đã bỏ.",
  footnote_dropped: "Chú thích cuối trang đã bỏ.",
  comment_dropped: "Bình luận trong file đã bỏ.",
  merged_cells_flattened: "Ô gộp trong bảng đã tách thành ô thường.",
  nested_table_flattened: "Bảng lồng trong bảng đã làm phẳng thành chữ trong ô.",
  numbering_flattened: "Kiểu đánh số của Word đã đổi thành danh sách gạch đầu dòng.",
  page_break_dropped: "Ngắt trang đã bỏ.",
  tracked_changes_accepted: "Thay đổi đang theo dõi (track changes) đã được chấp nhận hết.",
  field_code_dropped: "Mã trường của Word (field code) đã bỏ.",
  altchunk_dropped: "Nội dung nhúng (altChunk) đã bỏ.",
};

export interface WalkTable {
  index: number;
  rows: number;
  cols: number;
  placeholder_keys: string[];
}

export interface WalkResult {
  body: string;
  refs: Ref[];
  tables: WalkTable[];
  removed: Array<{ kind: "internal_note"; text: string }>;
  warnings: Map<WarningCode, number>;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const OFF = new Set(["0", "false", "off", "none"]);

class Walker {
  refs: Ref[] = [];
  tables: WalkTable[] = [];
  removed: Array<{ kind: "internal_note"; text: string }> = [];
  warnings = new Map<WarningCode, number>();
  private table: number | null = null;
  private topTables = 0;
  private blocks: string[] = [];
  private list: string[] = [];

  constructor(private readonly linesTable: number | undefined) {}

  warn(code: WarningCode, n = 1): void {
    this.warnings.set(code, (this.warnings.get(code) ?? 0) + n);
  }

  // ---------------------------------------------------------------- runs
  private flag(rPr: XNode | undefined, name: string): boolean {
    const n = rPr && child(rPr, name);
    if (!n) return false;
    const v = attr(n, "val");
    return v === undefined || !OFF.has(v.toLowerCase());
  }

  private graphic(n: XNode): void {
    this.warn(contains(n, "txbxContent") ? "textbox_dropped" : "image_dropped");
  }

  private run(r: XNode, out: Piece[]): void {
    const rPr = child(r, "rPr");
    const b = this.flag(rPr, "b");
    const i = this.flag(rPr, "i");
    for (const k of kids(r)) {
      switch (nameOf(k)) {
        case "t":
          out.push({ text: textOf(k), b, i });
          break;
        case "br":
          if (attr(k, "type") === "page") this.warn("page_break_dropped");
          else out.push({ text: "", b: false, i: false, br: true });
          break;
        case "cr":
          out.push({ text: "", b: false, i: false, br: true });
          break;
        case "tab":
        case "ptab":
          out.push({ text: " ", b, i });
          break;
        case "noBreakHyphen":
          out.push({ text: "-", b, i });
          break;
        case "instrText":
          this.warn("field_code_dropped");
          break;
        case "drawing":
        case "pict":
        case "object":
        case "AlternateContent":
          this.graphic(k);
          break;
        case "footnoteReference":
        case "endnoteReference":
          this.warn("footnote_dropped");
          break;
        case "commentReference":
          this.warn("comment_dropped");
          break;
        default: // rPr, delText, fldChar, sym, lastRenderedPageBreak, softHyphen … — nothing printable
          break;
      }
    }
  }

  /** Inline content of a paragraph (or of a hyperlink / ins / sdt inside one). */
  private inline(nodes: XNode[], out: Piece[]): void {
    for (const k of nodes) {
      switch (nameOf(k)) {
        case "r":
          this.run(k, out);
          break;
        case "hyperlink": // text kept, URL (r:id / anchor) never read
        case "smartTag":
        case "customXml":
        case "fldSimple":
          this.inline(kids(k), out);
          break;
        case "ins":
        case "moveTo":
          this.warn("tracked_changes_accepted");
          this.inline(kids(k), out);
          break;
        case "del":
        case "moveFrom":
          this.warn("tracked_changes_accepted");
          break;
        case "sdt": {
          const c = child(k, "sdtContent");
          if (c) this.inline(kids(c), out);
          break;
        }
        case "AlternateContent":
          this.graphic(k);
          break;
        default: // pPr, proofErr, bookmark*, commentRange*, oMath …
          break;
      }
    }
  }

  /** Paragraph → pieces after the internal-note check and placeholder rewrite; null = removed or empty. */
  private paragraph(p: XNode): Piece[] | null {
    const raw: Piece[] = [];
    this.inline(kids(p), raw);
    const text = raw.map((x) => x.text).join("");
    if (!raw.some((x) => x.br || x.text !== "")) return null;
    if (isInternalNote(text)) {
      this.removed.push({ kind: "internal_note", text: text.trim() });
      return null;
    }
    return raw;
  }

  private rewrite(pieces: Piece[]): Piece[] {
    const table = this.table;
    return rewritePlaceholders(pieces, (key, original) => this.refs.push({ key, original, table }));
  }

  // ---------------------------------------------------------------- blocks
  private flushList(): void {
    if (this.list.length === 0) return;
    this.blocks.push(`<ul>${this.list.join("")}</ul>`);
    this.list = [];
  }

  private block(p: XNode): void {
    const pPr = child(p, "pPr");
    const raw = this.paragraph(p);
    if (!raw) return;
    const html = renderInline(this.rewrite(raw));
    const style = pPr && child(pPr, "pStyle");
    const sv = (style && attr(style, "val")) ?? "";
    let tag = "p";
    const h = /^heading\s*([1-9])$/i.exec(sv);
    if (/^title$/i.test(sv)) tag = "h1";
    else if (h) tag = h[1] === "1" ? "h1" : h[1] === "2" ? "h2" : "h3";
    const numPr = pPr && child(pPr, "numPr");
    const numId = numPr && child(numPr, "numId");
    const isList = tag === "p" && numPr !== undefined && (numId === undefined || attr(numId, "val") !== "0");
    if (isList) {
      this.warn("numbering_flattened");
      this.list.push(`<li>${html}</li>`);
      return;
    }
    this.flushList();
    const jcNode = pPr && child(pPr, "jc");
    const jc = (jcNode && attr(jcNode, "val")) ?? "";
    const cls = jc === "center" ? ' class="center"' : jc === "right" || jc === "end" ? ' class="right"' : "";
    this.blocks.push(`<${tag}${cls}>${html}</${tag}>`);
  }

  /** Paragraph pieces of a cell, nested tables flattened into the same cell. */
  private cellParagraphs(nodes: XNode[], out: Piece[][]): void {
    for (const k of nodes) {
      const n = nameOf(k);
      if (n === "p") {
        const raw = this.paragraph(k);
        if (raw) out.push(raw);
      } else if (n === "tbl") {
        this.warn("nested_table_flattened");
        for (const tr of kids(k)) {
          if (nameOf(tr) !== "tr") continue;
          for (const tc of kids(tr)) if (nameOf(tc) === "tc") this.cellParagraphs(kids(tc), out);
        }
      } else if (n === "sdt" || n === "customXml") {
        const c = n === "sdt" ? child(k, "sdtContent") : k;
        if (c) this.cellParagraphs(kids(c), out);
      } else if (n === "altChunk") {
        this.warn("altchunk_dropped");
      }
    }
  }

  private tbl(t: XNode): void {
    this.flushList();
    const index = this.topTables++;
    const isLines = index === this.linesTable;
    const refStart = this.refs.length;
    const warnSnapshot = isLines ? new Map(this.warnings) : null;
    this.table = index;
    const rowsHtml: string[] = [];
    let cols = 0;
    for (const tr of kids(t)) {
      if (nameOf(tr) !== "tr") continue;
      const cells: string[] = [];
      let width = 0;
      for (const tc of kids(tr)) {
        if (nameOf(tc) !== "tc") continue;
        const tcPr = child(tc, "tcPr");
        const span = tcPr && child(tcPr, "gridSpan");
        const spanN = Math.max(1, parseInt((span && attr(span, "val")) ?? "1", 10) || 1);
        if (spanN > 1 || (tcPr && child(tcPr, "vMerge"))) this.warn("merged_cells_flattened");
        width += spanN;
        const paras: Piece[][] = [];
        this.cellParagraphs(kids(tc), paras);
        const joined: Piece[] = [];
        paras.forEach((ps, i) => {
          if (i > 0) joined.push({ text: "", b: false, i: false, br: true });
          joined.push(...ps);
        });
        cells.push(`<td>${renderInline(this.rewrite(joined))}</td>`);
      }
      cols = Math.max(cols, width);
      rowsHtml.push(`<tr>${cells.join("")}</tr>`);
    }
    this.table = null;

    if (isLines) {
      // DEC-4 B: the line table becomes {{bang_hang}}; its keys go — except giam_gia (P-7: kept, printed after it)
      const dropped = this.refs.splice(refStart);
      if (warnSnapshot) this.warnings = warnSnapshot;
      this.blocks.push("<p>{{bang_hang}}</p>");
      this.refs.push({ key: "bang_hang", original: "bang_hang", table: null });
      const giam = dropped.find((r) => r.key === "giam_gia");
      if (giam) {
        this.blocks.push("<p>Giảm giá: {{giam_gia}}%</p>");
        this.refs.push({ key: "giam_gia", original: giam.original, table: null });
      }
      return;
    }
    const keys: string[] = [];
    for (let i = refStart; i < this.refs.length; i++) {
      const k = this.refs[i]!.key;
      if (!keys.includes(k)) keys.push(k);
    }
    if (keys.length > 0) this.tables.push({ index, rows: rowsHtml.length, cols, placeholder_keys: keys });
    this.blocks.push(`<table>${rowsHtml.join("")}</table>`);
  }

  body(nodes: XNode[]): void {
    for (const k of nodes) {
      switch (nameOf(k)) {
        case "p":
          this.block(k);
          break;
        case "tbl":
          this.tbl(k);
          break;
        case "sdt": {
          const c = child(k, "sdtContent");
          if (c) this.body(kids(c));
          break;
        }
        case "customXml":
          this.body(kids(k));
          break;
        case "altChunk":
          this.warn("altchunk_dropped");
          break;
        default: // sectPr, bookmark*, #text whitespace …
          break;
      }
    }
  }

  finish(): string {
    this.flushList();
    return this.blocks.join("\n");
  }
}

export function renderInline(pieces: Piece[]): string {
  let html = "";
  let cur: Piece | null = null;
  const flush = () => {
    if (!cur || cur.text === "") return;
    const t = esc(cur.text);
    html += cur.b && cur.i ? `<strong><em>${t}</em></strong>` : cur.b ? `<strong>${t}</strong>` : cur.i ? `<em>${t}</em>` : t;
  };
  for (const p of pieces) {
    if (p.br) {
      flush();
      cur = null;
      html += "<br>";
    } else if (cur && cur.b === p.b && cur.i === p.i) {
      cur = { text: cur.text + p.text, b: cur.b, i: cur.i };
    } else {
      flush();
      cur = { text: p.text, b: p.b, i: p.i };
    }
  }
  flush();
  return html;
}

/** Walks the parsed document.xml. null = no w:document/w:body (treated as xml_invalid by the caller). */
export function walkDocument(doc: XNode[], linesTable: number | undefined): WalkResult | null {
  const root = doc.find((n) => nameOf(n) === "document");
  const body = root && child(root, "body");
  if (!body) return null;
  const w = new Walker(linesTable);
  w.body(kids(body));
  const html = w.finish();
  return { body: html, refs: w.refs, tables: w.tables, removed: w.removed, warnings: w.warnings };
}
