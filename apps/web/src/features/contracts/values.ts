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

export type FormState = Record<string, string>;
/** A template field as the form needs it; `label`/`type` come from the template (known keys keep their built-in label and input). */
export type FieldSpec = { key: string; required: boolean; source: string; label?: string; type?: string };
export type FieldKind = "text" | "paragraph" | "money" | "number" | "percent" | "date" | "choice";

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
function hiddenKeys(type: DocType | undefined, opts: FormOptions): ReadonlySet<string> {
  const hidden = new Set<string>();
  if (type === "delivery_note" || opts.frozen) hidden.add("giam_gia");
  if (type === "quote") hidden.add("chuc_vu_nguoi_ky");
  return hidden;
}

/** Line-block fields (products, quantities) live in `lines`, never in `values`. */
const isLineField = (f: FieldSpec): boolean => f.type === "lines" || f.type === "goods";

/** The keys the form shows: every manual template field in template order (SPEC-10 imports can declare any), minus what the type hides and the line block. */
export function activeKeys(fields: readonly FieldSpec[], type?: DocType, opts: FormOptions = {}): string[] {
  const hidden = hiddenKeys(type, opts);
  const keys: string[] = [];
  for (const f of fields) if (f.source === "manual" && !isLineField(f) && !hidden.has(f.key) && !keys.includes(f.key)) keys.push(f.key);
  return keys;
}

function fieldOf(fields: readonly FieldSpec[], key: string): FieldSpec | undefined {
  return fields.find((f) => f.key === key);
}

/** Label of a form key: the built-in one for known keys, else the template's label, else the key. */
export function labelOf(fields: readonly FieldSpec[], key: string): string {
  return isValueKey(key) ? VALUE_LABELS[key] : (fieldOf(fields, key)?.label ?? key);
}

/** Input kind of a form key: known keys keep their behaviour; the rest follow the template field `type`. */
export function kindOf(fields: readonly FieldSpec[], key: string): FieldKind {
  if (key === "giam_gia") return "percent";
  if (key === "ngay_bat_dau" || key === "ngay_bao_gia") return "date";
  if (isValueKey(key)) return "text";
  const t = fieldOf(fields, key)?.type;
  return t === "paragraph" || t === "money" || t === "number" || t === "percent" || t === "date" || t === "choice" ? t : "text";
}

/** PXK = goods only (SPEC-09 FR-12); every other type offers the whole price list. */
export function productsFor<P extends Pick<Product, "kind">>(type: DocType | undefined, items: readonly P[]): P[] {
  return type === "delivery_note" ? items.filter((p) => p.kind === "goods") : [...items];
}

const SERVER_DEFAULTED: ReadonlySet<string> = new Set(["ngay_bat_dau", "giam_gia"]);

export function requiredKeys(fields: readonly FieldSpec[], type?: DocType, opts: FormOptions = {}): Set<string> {
  const req = new Set<string>();
  const hidden = hiddenKeys(type, opts);
  // Fields the template gives a default (ngay_bat_dau = Ngày lập, giam_gia = 0): blank is valid, the server fills it.
  for (const f of fields) if (f.source === "manual" && !isLineField(f) && f.required && !SERVER_DEFAULTED.has(f.key) && !hidden.has(f.key)) req.add(f.key);
  return req;
}

export type BuildResult =
  | { ok: true; values: ContractValues }
  | { ok: false; errors: Record<string, string>; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** "1.500.000" / "1 500 000" / "1500000" -> 1500000 (whole dong only); anything else -> null. */
export function parseMoney(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(?:[. ]\d{3})+$|^\d+$/.test(t)) return null;
  const n = Number.parseInt(t.replace(/[. ]/g, ""), 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** "12", "-3", "7,5", "7.5" -> number; anything else -> null. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const PAIR_MESSAGE = "Nhập cả hai hoặc bỏ trống cả hai";

/** Form text -> the request `values`. Blank fields are dropped; the discount goes as integer bps from the string (no floats). */
export function buildValues(form: FormState, fields: readonly FieldSpec[], type?: DocType, opts: FormOptions = {}): BuildResult {
  const active = new Set(activeKeys(fields, type, opts));
  const required = requiredKeys(fields, type, opts);
  const errors: Record<string, string> = {};
  const missing: string[] = [];
  const text = (k: string): string => (form[k] ?? "").trim();

  for (const k of active) {
    if (required.has(k) && text(k) === "") {
      missing.push(labelOf(fields, k));
      errors[k] = `${labelOf(fields, k)} là bắt buộc`;
    }
  }

  const values: Record<string, string | number> = {};
  for (const k of active) {
    const v = text(k);
    if (v === "" || errors[k]) continue;
    const kind = kindOf(fields, k);
    const label = labelOf(fields, k);
    if (k === "giam_gia") {
      const bps = parsePercentToBps(v);
      if (bps === null) errors[k] = "Giảm giá phải từ 0 đến 100%, tối đa 2 số lẻ";
      else values[k] = bps;
    } else if (kind === "percent") {
      const bps = parsePercentToBps(v);
      if (bps === null) errors[k] = `${label} phải từ 0 đến 100%, tối đa 2 số lẻ`;
      else values[k] = bps;
    } else if (kind === "date") {
      if (!ISO_DATE.test(v)) errors[k] = `${label} chưa hợp lệ`;
      else values[k] = v;
    } else if (kind === "money") {
      const n = parseMoney(v);
      if (n === null) errors[k] = `${label} phải là số tiền (số nguyên, ví dụ 1.500.000)`;
      else values[k] = n;
    } else if (kind === "number") {
      const n = parseNumber(v);
      if (n === null) errors[k] = `${label} phải là số`;
      else values[k] = n;
    } else {
      values[k] = v;
    }
  }

  if (active.has("so_bao_gia") && active.has("ngay_bao_gia") && !errors["so_bao_gia"] && !errors["ngay_bao_gia"]) {
    if ((text("so_bao_gia") === "") !== (text("ngay_bao_gia") === "")) {
      errors["so_bao_gia"] = PAIR_MESSAGE;
      errors["ngay_bao_gia"] = PAIR_MESSAGE;
    }
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      message: missing.length > 0 ? `Thiếu: ${missing.join(", ")}. Điền rồi tạo lại.` : "Kiểm tra lại các ô đánh dấu.",
    };
  }
  // the generated type lists the 8 known keys; unknown manual keys of an imported template ride along as-is
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
export function formFromInputs(inputs: Record<string, string | number>, fields: readonly FieldSpec[] = []): FormState {
  const form = emptyForm();
  const keys = new Set<string>([...VALUE_KEYS, ...fields.filter((f) => f.source === "manual").map((f) => f.key)]);
  for (const k of keys) {
    const v = inputs[k];
    if (v === undefined || v === null) continue;
    form[k] = typeof v === "number" && kindOf(fields, k) === "percent" ? bpsToPercentText(v) : String(v);
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
