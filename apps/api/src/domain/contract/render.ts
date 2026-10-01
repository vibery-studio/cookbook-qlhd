import { vatRatesLabel } from "../money/line-pricing";
import { formatMoney } from "./format";
import { escapeHtml, mergeFields } from "./merge";
import type { Snapshot, SnapshotLine } from "./types";

const PRINT_CSS = `
  @page { size: A4; margin: 20mm 18mm; }
  :root { color-scheme: light; }
  body { color: #111; background: #fff; font-family: Arial, sans-serif; line-height: 1.5; }
  .contract-document { max-width: 180mm; margin: 0 auto; }
  .center { text-align: center; }
  .b { font-weight: 700; }
  .sig { width: 100%; border-collapse: collapse; margin-top: 12mm; table-layout: fixed; }
  .lines { width: 100%; border-collapse: collapse; margin: 3mm 0; }
  .lines th, .lines td { border: 1px solid #555; padding: 1.5mm 2mm; vertical-align: top; }
  .lines th { font-weight: 700; text-align: center; }
  .lines td.num { text-align: right; white-space: nowrap; }
  .sig th, .sig td { width: 50%; padding: 0 4mm; text-align: center; vertical-align: top; }
  .sig th { font-weight: 700; }
  .sig td { font-weight: 400; font-style: italic; }
  .draft-watermark { position: fixed; inset: 45% 0 auto; text-align: center; color: #b0b0b0; font-size: 52px; font-weight: 700; transform: rotate(-25deg); opacity: .28; pointer-events: none; }
  .void-band { position: fixed; top: 8mm; left: 0; right: 0; z-index: 2; padding: 7px; color: #fff; background: #a71930; font-weight: 700; text-align: center; letter-spacing: .18em; }
`;

const LINE_HEADS = ["STT", "Tên", "ĐVT", "SL", "Đơn giá chưa VAT", "Thuế suất", "Thành tiền chưa VAT"];

/** The line table (SPEC-08 §3.4, DEC-7): built from snapshot data only, every cell escaped. */
export function renderLinesTable(lines: readonly SnapshotLine[]): string {
  const head = `<tr>${LINE_HEADS.map((h) => `<th>${h}</th>`).join("")}</tr>`;
  const rows = lines.map((l, i) => {
    const cells = [
      `<td class="num">${i + 1}</td>`,
      `<td>${escapeHtml(l.name)}</td>`,
      `<td>${escapeHtml(l.unit)}</td>`,
      `<td class="num">${formatMoney(l.qty)}</td>`,
      `<td class="num">${formatMoney(l.unit_price_ex_vat)}</td>`,
      `<td class="num">${escapeHtml(vatRatesLabel([{ vat_rate_bps: l.vat_rate_bps }]))}</td>`,
      `<td class="num">${formatMoney(l.amount_ex_vat)}</td>`,
    ];
    return `<tr>${cells.join("")}</tr>`;
  });
  return `<table class="lines">${head}${rows.join("")}</table>`;
}

/** Trusted-HTML values for the snapshot's `lines`-type fields. */
export function lineTables(snapshot: Pick<Snapshot, "lines" | "line_table_fields">): Record<string, string> {
  const keys = snapshot.line_table_fields ?? [];
  if (keys.length === 0) return {};
  const table = renderLinesTable(snapshot.lines ?? []);
  return Object.fromEntries(keys.map((k) => [k, table]));
}

export function renderHtml(
  body: string,
  snapshot: Snapshot,
  number: string | null,
): { ok: true; html: string } | { ok: false; placeholders: string[] } {
  const values: Record<string, string> = { ...snapshot.fields, so_hop_dong: number ?? "(chưa có số)" };
  const merged = mergeFields(body, values, lineTables(snapshot));
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
