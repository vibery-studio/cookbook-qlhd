import { parsePercentToBps } from "../../lib/percent-bps";
import type { ContractValues, Product } from "./api";
import type { DocType } from "./doc-type-labels";

/** The only `values` keys SPEC-08 §2b accepts; anything else a template declares is ignored. */
export const VALUE_KEYS = [
  "giam_gia", "chuc_vu_nguoi_ky", "ngay_bat_dau", "so_bao_gia", "ngay_bao_gia", "ly_do_xuat_kho", "xuat_tai_kho", "dia_diem",
] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];

export const VALUE_LABELS: Record<ValueKey, string> = {
  giam_gia: "Giảm giá (%)",
  chuc_vu_nguoi_ky: "Chức vụ người ký",
  ngay_bat_dau: "Ngày bắt đầu",
  so_bao_gia: "Số báo giá",
  ngay_bao_gia: "Ngày báo giá",
  ly_do_xuat_kho: "Lý do xuất kho",
  xuat_tai_kho: "Xuất tại kho",
  dia_diem: "Địa điểm",
};

export type FormState = Record<ValueKey, string>;
export type FieldSpec = { key: string; required: boolean; source: string };

export function emptyForm(): FormState {
  return { giam_gia: "", chuc_vu_nguoi_ky: "", ngay_bat_dau: "", so_bao_gia: "", ngay_bao_gia: "", ly_do_xuat_kho: "", xuat_tai_kho: "", dia_diem: "" };
}

export function isValueKey(key: string): key is ValueKey {
  return (VALUE_KEYS as readonly string[]).includes(key);
}

export type FormOptions = {
  /** A child whose lines and discount are frozen from its parent (SPEC-09 FR-5): no `giam_gia`. */
  frozen?: boolean;
};

/** Keys a type never shows or sends: PXK carries no money (no discount), BG has no signer yet (the contract made from it asks). */
function hiddenKeys(type: DocType | undefined, opts: FormOptions): ReadonlySet<ValueKey> {
  const hidden = new Set<ValueKey>();
  if (type === "delivery_note" || opts.frozen) hidden.add("giam_gia");
  if (type === "quote") hidden.add("chuc_vu_nguoi_ky");
  return hidden;
}

/** The keys the form shows: manual template fields among the known ones, minus what the type hides (products + quantities live in the line block, not in `values`). */
export function activeKeys(fields: readonly FieldSpec[], type?: DocType, opts: FormOptions = {}): ValueKey[] {
  const manual = new Set(fields.filter((f) => f.source === "manual").map((f) => f.key));
  const hidden = hiddenKeys(type, opts);
  return VALUE_KEYS.filter((k) => manual.has(k) && !hidden.has(k));
}

/** PXK = goods only (SPEC-09 FR-12); every other type offers the whole price list. */
export function productsFor<P extends Pick<Product, "kind">>(type: DocType | undefined, items: readonly P[]): P[] {
  return type === "delivery_note" ? items.filter((p) => p.kind === "goods") : [...items];
}

const SERVER_DEFAULTED: ReadonlySet<ValueKey> = new Set<ValueKey>(["ngay_bat_dau", "giam_gia"]);

export function requiredKeys(fields: readonly FieldSpec[], type?: DocType, opts: FormOptions = {}): Set<ValueKey> {
  const req = new Set<ValueKey>();
  const hidden = hiddenKeys(type, opts);
  // Fields the template gives a default (ngay_bat_dau = Ngày lập, giam_gia = 0): blank is valid, the server fills it.
  for (const f of fields) if (f.source === "manual" && f.required && isValueKey(f.key) && !SERVER_DEFAULTED.has(f.key) && !hidden.has(f.key)) req.add(f.key);
  return req;
}

export type BuildResult =
  | { ok: true; values: ContractValues }
  | { ok: false; errors: Partial<Record<ValueKey, string>>; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAIR_MESSAGE = "Nhập cả hai hoặc bỏ trống cả hai";

/** Form text -> the request `values`. Blank fields are dropped; the discount goes as integer bps from the string (no floats). */
export function buildValues(form: FormState, fields: readonly FieldSpec[], type?: DocType, opts: FormOptions = {}): BuildResult {
  const active = new Set(activeKeys(fields, type, opts));
  const required = requiredKeys(fields, type, opts);
  const errors: Partial<Record<ValueKey, string>> = {};
  const missing: string[] = [];
  const text = (k: ValueKey): string => form[k].trim();

  for (const k of active) {
    if (required.has(k) && text(k) === "") {
      missing.push(VALUE_LABELS[k]);
      errors[k] = `${VALUE_LABELS[k]} là bắt buộc`;
    }
  }

  const values: Partial<Record<ValueKey, string | number>> = {};
  for (const k of active) {
    const v = text(k);
    if (v === "" || errors[k]) continue;
    if (k === "giam_gia") {
      const bps = parsePercentToBps(v);
      if (bps === null) errors[k] = "Giảm giá phải từ 0 đến 100%, tối đa 2 số lẻ";
      else values[k] = bps;
    } else if (k === "ngay_bat_dau" || k === "ngay_bao_gia") {
      if (!ISO_DATE.test(v)) errors[k] = `${VALUE_LABELS[k]} chưa hợp lệ`;
      else values[k] = v;
    } else {
      values[k] = v;
    }
  }

  if (active.has("so_bao_gia") && active.has("ngay_bao_gia") && !errors.so_bao_gia && !errors.ngay_bao_gia) {
    if ((text("so_bao_gia") === "") !== (text("ngay_bao_gia") === "")) {
      errors.so_bao_gia = PAIR_MESSAGE;
      errors.ngay_bao_gia = PAIR_MESSAGE;
    }
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      message: missing.length > 0 ? `Thiếu: ${missing.join(", ")}. Điền rồi tạo lại.` : "Kiểm tra lại các ô đánh dấu.",
    };
  }
  return { ok: true, values: values as ContractValues };
}

/** 750 -> "7,5"; 500 -> "5"; 1234 -> "12,34" (integer arithmetic only). */
export function bpsToPercentText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const rest = bps % 100;
  if (rest === 0) return String(whole);
  const frac = String(rest).padStart(2, "0").replace(/0$/, "");
  return `${whole},${frac}`;
}

/** Fill the edit form from `snapshot.inputs` (what the user typed last time). */
export function formFromInputs(inputs: Record<string, string | number>): FormState {
  const form = emptyForm();
  for (const k of VALUE_KEYS) {
    const v = inputs[k];
    if (v === undefined || v === null) continue;
    form[k] = k === "giam_gia" && typeof v === "number" ? bpsToPercentText(v) : String(v);
  }
  return form;
}

/** One row of the "Dòng hàng" block: a product id (empty until picked) and the quantity as typed. */
export type LineRow = { key: string; productId: string; qty: string };
export type LineBody = { product_id: string; qty: number };

let rowSeq = 0;
export function newRow(productId = "", qty = "1"): LineRow {
  rowSeq += 1;
  return { key: `row-${rowSeq}`, productId, qty };
}

/** Edit form: rows rebuilt from `snapshot.inputs.lines`; a fresh empty row when there are none. */
export function rowsFromInputs(lines: readonly { productId: string; qty: number }[]): LineRow[] {
  return lines.length > 0 ? lines.map((l) => newRow(l.productId, String(l.qty))) : [newRow()];
}

const QTY = /^\d{1,4}$/;
const parseQty = (text: string): number | null => {
  const t = text.trim();
  if (!QTY.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return n >= 1 && n <= 9999 ? n : null;
};

export type LinesResult = { ok: true; lines: LineBody[] } | { ok: false; errors: Record<number, string>; message: string };

/** Rows -> request `lines`. Only product ids + integer quantities are ever sent — never a price (DEC-13 A, I4). */
export function buildLines(rows: readonly LineRow[]): LinesResult {
  if (rows.length === 0) return { ok: false, errors: {}, message: "Thêm ít nhất một dòng hàng." };
  const errors: Record<number, string> = {};
  const lines: LineBody[] = [];
  rows.forEach((r, i) => {
    const qty = parseQty(r.qty);
    if (r.productId === "") errors[i] = "Chọn sản phẩm";
    else if (qty === null) errors[i] = "Số lượng phải là số nguyên từ 1 đến 9999";
    else lines.push({ product_id: r.productId, qty });
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors, message: "Kiểm tra lại các dòng hàng đánh dấu." };
  return { ok: true, lines };
}

/** Body of POST /pricing/preview: complete rows only; null while there is nothing to price or the discount is not valid yet. */
export function previewBody(rows: readonly LineRow[], discountText: string): { lines: LineBody[]; discount_bps: number } | null {
  const lines = rows.flatMap((r) => {
    const qty = parseQty(r.qty);
    return r.productId !== "" && qty !== null ? [{ product_id: r.productId, qty }] : [];
  });
  if (lines.length === 0) return null;
  const text = discountText.trim();
  const bps = text === "" ? 0 : parsePercentToBps(text);
  return bps === null ? null : { lines, discount_bps: bps };
}
