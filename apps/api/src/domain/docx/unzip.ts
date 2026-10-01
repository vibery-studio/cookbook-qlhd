/**
 * SPEC-10 §3.2 step 1–2 — open the zip package without trusting its headers (PLAN-10 R-5).
 * Own central-directory walk (entry count from EOCD before any inflate; offsets for the few parts we read) +
 * fflate's streaming `Inflate`, counting REAL inflated bytes against one shared budget. `unzipSync` is not used:
 * it inflates into `new Uint8Array(originalSize)` and silently truncates when the header lies.
 */
import { Inflate } from "fflate";

export type DocxErrorReason =
  | "not_docx"
  | "macro_enabled"
  | "no_document"
  | "xml_invalid"
  | "too_large_inflated"
  | "too_many_entries";

export const DOCX_LIMITS = { inflatedBytes: 2_097_152, entries: 1000 } as const;

const MAIN_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const CHUNK = 4096; // deflate expands ≤ ~1032×, so one push yields ≤ ~4 MB before the budget check runs

export interface DocxPackage {
  documentXml: string;
  /** header*.xml / footer*.xml, raw XML (only scanned for text / `{{`) */
  headerFooterXml: string[];
}

export class DocxError extends Error {
  constructor(readonly reason: DocxErrorReason) {
    super(reason);
  }
}

interface Entry {
  name: string;
  method: number;
  csize: number;
  usize: number;
  localOffset: number;
}

const u16 = (d: Uint8Array, o: number) => {
  if (o < 0 || o + 2 > d.length) throw new DocxError("not_docx");
  return d[o]! | (d[o + 1]! << 8);
};
const u32 = (d: Uint8Array, o: number) => {
  if (o < 0 || o + 4 > d.length) throw new DocxError("not_docx");
  return (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;
};

const utf8 = new TextDecoder("utf-8");
const isWanted = (n: string) =>
  n === "[Content_Types].xml" || n === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(n);

function readCentralDirectory(d: Uint8Array): Entry[] {
  let e = d.length - 22;
  const stop = Math.max(0, d.length - 22 - 0xffff);
  while (e >= stop && u32(d, e) !== 0x06054b50) e--;
  if (e < stop) throw new DocxError("not_docx");
  const count = u16(d, e + 10);
  if (count > DOCX_LIMITS.entries) throw new DocxError("too_many_entries"); // 0xFFFF (zip64 marker) lands here too
  let o = u32(d, e + 16);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(d, o) !== 0x02014b50) throw new DocxError("not_docx");
    const n = u16(d, o + 28);
    const x = u16(d, o + 30);
    const c = u16(d, o + 32);
    if (o + 46 + n > d.length) throw new DocxError("not_docx");
    entries.push({
      name: utf8.decode(d.subarray(o + 46, o + 46 + n)),
      method: u16(d, o + 10),
      csize: u32(d, o + 20),
      usize: u32(d, o + 24),
      localOffset: u32(d, o + 42),
    });
    o += 46 + n + x + c;
  }
  return entries;
}

function compressedData(d: Uint8Array, en: Entry): Uint8Array {
  const lo = en.localOffset;
  if (u32(d, lo) !== 0x04034b50) throw new DocxError("not_docx");
  const start = lo + 30 + u16(d, lo + 26) + u16(d, lo + 28);
  const end = start + en.csize;
  if (end > d.length) throw new DocxError("not_docx");
  return d.subarray(start, end);
}

class Budget {
  used = 0;
  take(n: number): void {
    this.used += n;
    if (this.used > DOCX_LIMITS.inflatedBytes) throw new DocxError("too_large_inflated");
  }
}

function inflateCounted(data: Uint8Array, method: number, budget: Budget): string {
  if (method === 0) {
    budget.take(data.length);
    return utf8.decode(data);
  }
  if (method !== 8) throw new DocxError("not_docx");
  const parts: Uint8Array[] = [];
  let done = false;
  const inf = new Inflate((chunk: Uint8Array, final: boolean) => {
    budget.take(chunk.length);
    parts.push(chunk);
    if (final) done = true;
  });
  try {
    if (data.length === 0) inf.push(new Uint8Array(0), true);
    for (let i = 0; i < data.length; i += CHUNK) inf.push(data.subarray(i, i + CHUNK), i + CHUNK >= data.length);
  } catch (err) {
    if (err instanceof DocxError) throw err;
    throw new DocxError("not_docx"); // corrupt deflate stream
  }
  if (!done) throw new DocxError("not_docx");
  if (parts.length === 1) return utf8.decode(parts[0]);
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return utf8.decode(all);
}

/** Throws DocxError only. */
export function openDocx(bytes: Uint8Array): DocxPackage {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new DocxError("not_docx");
  }
  const entries = readCentralDirectory(bytes);
  const wanted = new Map<string, Entry>();
  let hasVba = false;
  for (const en of entries) {
    if (/(^|\/)vbaProject\.bin$/i.test(en.name)) hasVba = true; // noted, never inflated
    if (!isWanted(en.name) || wanted.has(en.name)) continue;
    // declared size over the cap, or "not set" while data is present → refuse before inflating
    if (en.usize > DOCX_LIMITS.inflatedBytes || (en.usize === 0 && en.csize > 0)) throw new DocxError("too_large_inflated");
    wanted.set(en.name, en);
  }

  const budget = new Budget();
  const read = (en: Entry) => inflateCounted(compressedData(bytes, en), en.method, budget);

  const ctEntry = wanted.get("[Content_Types].xml");
  if (!ctEntry) throw new DocxError("not_docx");
  const ct = read(ctEntry);
  if (/<!DOCTYPE/i.test(ct)) throw new DocxError("xml_invalid");
  const types = [...ct.matchAll(/ContentType\s*=\s*"([^"]*)"/g)].map((m) => m[1]!);
  if (hasVba || types.some((t) => /macroEnabled\.main\+xml/i.test(t))) throw new DocxError("macro_enabled");
  if (!types.includes(MAIN_CT)) throw new DocxError("not_docx");

  const docEntry = wanted.get("word/document.xml");
  if (!docEntry) throw new DocxError("no_document");
  const documentXml = read(docEntry);
  const headerFooterXml: string[] = [];
  for (const [name, en] of wanted) {
    if (name.startsWith("word/header") || name.startsWith("word/footer")) headerFooterXml.push(read(en));
  }
  return { documentXml, headerFooterXml };
}
