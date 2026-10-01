/**
 * SPEC-10 §3.2 — pure .docx → template body (DEC-1 B). Contract fixed by PLAN-10 §2b and the head of
 * test/domain/docx-convert.test.ts. No Hono / DB / env. Never throws: package/XML problems → `{ error: reason }`.
 */
import { aggregate, type Placeholder } from "./placeholders";
import { DocxError, openDocx, type DocxErrorReason } from "./unzip";
import { WARNING_MESSAGES, walkDocument, type WalkTable, type WarningCode } from "./walk";
import { decodeEntities, hasDoctype, parseXml } from "./xml";

export { DOCX_LIMITS, type DocxErrorReason } from "./unzip";
export { slugKey, type Placeholder } from "./placeholders";
export { WARNING_MESSAGES, type WarningCode } from "./walk";

export interface DocxWarning {
  code: WarningCode;
  message: string;
  count: number;
}

export interface DocxConversion {
  body: string;
  placeholders: Placeholder[];
  tables: WalkTable[];
  removed: Array<{ kind: "internal_note"; text: string }>;
  warnings: DocxWarning[];
}

export interface ConvertOptions {
  /** index among ALL top-level w:tbl of w:body; out of range → ignored (the service answers 422). */
  linesTable?: number;
}

function headerFooterWarnings(parts: string[], warn: (c: WarningCode) => void): void {
  for (const xml of parts) {
    if (hasDoctype(xml)) continue; // never parsed; content is dropped anyway
    const text = decodeEntities(xml.replace(/<[^>]*>/g, ""));
    if (text.includes("{{")) warn("header_footer_placeholder");
    else if (text.trim() !== "") warn("header_footer_dropped");
  }
}

export function convertDocx(bytes: Uint8Array, opts: ConvertOptions = {}): DocxConversion | { error: DocxErrorReason } {
  try {
    const pkg = openDocx(bytes);
    const doc = parseXml(pkg.documentXml);
    if (!doc) return { error: "xml_invalid" };
    const lt = opts.linesTable;
    const walked = walkDocument(doc, Number.isInteger(lt) && (lt as number) >= 0 ? lt : undefined);
    if (!walked) return { error: "xml_invalid" };

    const { placeholders, renamed, merged } = aggregate(walked.refs);
    const counts = new Map<WarningCode, number>();
    if (renamed > 0) counts.set("key_renamed", renamed);
    if (merged > 0) counts.set("key_merged", merged);
    for (const [c, n] of walked.warnings) counts.set(c, n);
    headerFooterWarnings(pkg.headerFooterXml, (c) => counts.set(c, (counts.get(c) ?? 0) + 1));

    return {
      body: walked.body,
      placeholders,
      tables: walked.tables,
      removed: walked.removed,
      warnings: [...counts].map(([code, count]) => ({ code, message: WARNING_MESSAGES[code], count })),
    };
  } catch (err) {
    if (err instanceof DocxError) return { error: err.reason };
    return { error: "xml_invalid" };
  }
}
