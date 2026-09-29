import { parsePercentToBps } from "../../lib/percent-bps";
import type { ContractValues } from "./api";

/** The only `values` keys SPEC-03 3.5 accepts; anything else a template declares is ignored. */
export const VALUE_KEYS = ["ma_goi", "so_cua_hang", "giam_gia", "chuc_vu_nguoi_ky", "ngay_bat_dau", "so_bao_gia", "ngay_bao_gia"] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];

export const VALUE_LABELS: Record<ValueKey, string> = {
  ma_goi: "Gói dịch vụ",
  so_cua_hang: "Số cửa hàng",
  giam_gia: "Giảm giá (%)",
  chuc_vu_nguoi_ky: "Chức vụ người ký",
  ngay_bat_dau: "Ngày bắt đầu",
  so_bao_gia: "Số báo giá",
  ngay_bao_gia: "Ngày báo giá",
};

export type FormState = Record<ValueKey, string>;
export type FieldSpec = { key: string; required: boolean; source: string };

export function emptyForm(): FormState {
  return { ma_goi: "", so_cua_hang: "", giam_gia: "", chuc_vu_nguoi_ky: "", ngay_bat_dau: "", so_bao_gia: "", ngay_bao_gia: "" };
}

export function isValueKey(key: string): key is ValueKey {
  return (VALUE_KEYS as readonly string[]).includes(key);
}

/** The keys the form shows: manual template fields among the 7 known, plus the two the API always needs. */
export function activeKeys(fields: readonly FieldSpec[]): ValueKey[] {
  const manual = new Set(fields.filter((f) => f.source === "manual").map((f) => f.key));
  return VALUE_KEYS.filter((k) => k === "ma_goi" || k === "so_cua_hang" || manual.has(k));
}

export function requiredKeys(fields: readonly FieldSpec[]): Set<ValueKey> {
  const req = new Set<ValueKey>(["ma_goi", "so_cua_hang"]);
  for (const f of fields) if (f.source === "manual" && f.required && isValueKey(f.key)) req.add(f.key);
  return req;
}

export type BuildResult =
  | { ok: true; values: ContractValues }
  | { ok: false; errors: Partial<Record<ValueKey, string>>; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAIR_MESSAGE = "Nhập cả hai hoặc bỏ trống cả hai";

/** Form text -> the request `values`. Blank fields are dropped; the discount goes as integer bps from the string (no floats). */
export function buildValues(form: FormState, fields: readonly FieldSpec[]): BuildResult {
  const active = new Set(activeKeys(fields));
  const required = requiredKeys(fields);
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
    if (k === "so_cua_hang") {
      const n = /^\d{1,4}$/.test(v) ? Number.parseInt(v, 10) : 0;
      if (n < 1 || n > 999) errors[k] = "Số cửa hàng phải là số nguyên từ 1 đến 999";
      else values[k] = n;
    } else if (k === "giam_gia") {
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
