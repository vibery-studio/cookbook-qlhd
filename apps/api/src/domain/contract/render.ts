import { mergeFields } from "./merge";
import type { Snapshot } from "./types";

const PRINT_CSS = `
  @page { size: A4; margin: 20mm 18mm; }
  :root { color-scheme: light; }
  body { color: #111; background: #fff; font-family: Arial, sans-serif; line-height: 1.5; }
  .contract-document { max-width: 180mm; margin: 0 auto; }
  .draft-watermark { position: fixed; inset: 45% 0 auto; text-align: center; color: #b0b0b0; font-size: 52px; font-weight: 700; transform: rotate(-25deg); opacity: .28; pointer-events: none; }
  .void-band { position: fixed; top: 8mm; left: 0; right: 0; z-index: 2; padding: 7px; color: #fff; background: #a71930; font-weight: 700; text-align: center; letter-spacing: .18em; }
`;

export function renderHtml(
  body: string,
  snapshot: Snapshot,
  number: string | null,
): { ok: true; html: string } | { ok: false; placeholders: string[] } {
  const values: Record<string, string> = { ...snapshot.fields, so_hop_dong: number ?? "(chưa có số)" };
  const merged = mergeFields(body, values);
  if (merged.leftover.length > 0) return { ok: false, placeholders: merged.leftover };

  const watermark = number === null ? '<div class="draft-watermark" aria-hidden="true">NHÁP</div>' : "";
  const html = `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><title>Hợp đồng</title><style>${PRINT_CSS}</style></head>
<body><main class="contract-document">${merged.html}</main>${watermark}</body>
</html>`;
  return { ok: true, html };
}

export function withVoidBand(html: string): string {
  if (html.includes('class="void-band"')) return html;
  const band = '<div class="void-band" aria-label="Hợp đồng đã hủy">ĐÃ HỦY</div>';
  const body = /<body(?:\s[^>]*)?>/i.exec(html);
  if (body === null || body.index === undefined) return `${band}${html}`;
  const at = body.index + body[0].length;
  return `${html.slice(0, at)}${band}${html.slice(at)}`;
}
