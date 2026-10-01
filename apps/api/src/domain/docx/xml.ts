/**
 * SPEC-10 §3.2 step 3 — parse WordprocessingML safely. DOCTYPE refused outright (no entity expansion, no external
 * fetch); entities never processed by the library (`processEntities: false`), we decode the 5 standard ones + &#…;.
 * `removeNSPrefix` so a document written with an unusual prefix (ns0:p) still walks; names below are local names.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";

/** preserveOrder node: `{ [localName]: XNode[], ":@"?: { "@_attr": string } }` or `{ "#text": string }`. */
export type XNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  processEntities: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
});

export function hasDoctype(xml: string): boolean {
  return /<!DOCTYPE/i.test(xml);
}

/** null = refused (DOCTYPE / not well-formed). Never throws. */
export function parseXml(xml: string): XNode[] | null {
  if (hasDoctype(xml)) return null;
  try {
    if (XMLValidator.validate(xml) !== true) return null;
    const out: unknown = parser.parse(xml);
    return Array.isArray(out) ? (out as XNode[]) : null;
  } catch {
    return null;
  }
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
      return String.fromCodePoint(cp);
    }
    return NAMED[ref] ?? whole;
  });
}

// ------------------------------------------------------------------ node helpers
export function nameOf(n: XNode): string {
  for (const k in n) if (k !== ":@") return k;
  return "";
}

export function kids(n: XNode): XNode[] {
  const v = n[nameOf(n)];
  return Array.isArray(v) ? (v as XNode[]) : [];
}

export function attr(n: XNode, name: string): string | undefined {
  const a = n[":@"] as Record<string, unknown> | undefined;
  const v = a?.[`@_${name}`];
  return typeof v === "string" ? decodeEntities(v) : undefined;
}

export function child(n: XNode, name: string): XNode | undefined {
  return kids(n).find((k) => nameOf(k) === name);
}

/** Raw text of a `#text`-only element (w:t, w:instrText…), entities decoded. */
export function textOf(n: XNode): string {
  let s = "";
  for (const k of kids(n)) {
    const t = k["#text"];
    if (typeof t === "string") s += t;
  }
  return decodeEntities(s);
}

/** Depth-first search for an element by local name. */
export function contains(n: XNode, name: string): boolean {
  for (const k of kids(n)) {
    if (nameOf(k) === name || contains(k, name)) return true;
  }
  return false;
}
