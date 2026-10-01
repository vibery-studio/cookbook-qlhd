import { formatMoney } from "./format";
import { escapeHtml } from "./merge";
import type { GoodsSnapshotLine } from "./types";

const BLANK = '<td class="num"></td>';

/**
 * The PXK goods table, Mẫu số 02-VT layout (SPEC-09 FR-12, DEC-12 A): columns A–D + 1–4; only (1) "Yêu cầu" is filled —
 * (2) "Thực xuất", (3) "Đơn giá", (4) "Thành tiền" and the "Cộng" row stay blank (filled by hand on paper).
 * Built from snapshot data only, every cell escaped: a trusted-HTML value (PLAN-08 R-5).
 * TODO(build): đối chiếu nhãn cột với Phụ lục I TT 99/2025/TT-BTC (PLAN-09 R-8).
 */
export function renderGoodsTable(lines: ReadonlyArray<Pick<GoodsSnapshotLine, "code" | "name" | "unit" | "qty">>): string {
  const head =
    '<tr><th rowspan="2">STT</th><th rowspan="2">Tên, nhãn hiệu, quy cách, phẩm chất vật tư, dụng cụ, sản phẩm, hàng hóa</th>' +
    '<th rowspan="2">Mã số</th><th rowspan="2">Đơn vị tính</th><th colspan="2">Số lượng</th>' +
    '<th rowspan="2">Đơn giá</th><th rowspan="2">Thành tiền</th></tr>' +
    "<tr><th>Yêu cầu</th><th>Thực xuất</th></tr>" +
    `<tr>${["A", "B", "C", "D", "1", "2", "3", "4"].map((c) => `<td class="center">${c}</td>`).join("")}</tr>`;
  const rows = lines.map(
    (l, i) =>
      `<tr><td class="center">${i + 1}</td><td>${escapeHtml(l.name)}</td><td>${escapeHtml(l.code)}</td><td>${escapeHtml(l.unit)}</td>` +
      `<td class="num">${formatMoney(l.qty)}</td>${BLANK}${BLANK}${BLANK}</tr>`,
  );
  const sum = `<tr><td></td><td class="b">Cộng</td><td></td><td></td>${BLANK}${BLANK}${BLANK}${BLANK}</tr>`;
  return `<table class="lines goods">${head}${rows.join("")}${sum}</table>`;
}
