import { amountInWords } from "./amount-words";
import { contractEnd } from "./dates";
import { formatDateVN, formatMoney, formatPercentBps } from "./format";
import { mergeFields } from "./merge";
import { computeAmounts } from "./pricing";
import type {
  CustomerInput,
  PriceRow,
  Snapshot,
  TemplateField,
  TemplateVersionInput,
} from "./types";

export type BuildResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; kind: "missing-fields"; missing: Array<{ key: string; label: string }> }
  | { ok: false; kind: "invalid"; errors: Array<{ path: string; message: string }> }
  | { ok: false; kind: "unresolved-placeholder"; placeholders: string[] };

type Scalar = string | number | null | undefined;

function isBlank(value: Scalar): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function invalid(path: string, message: string): { path: string; message: string } {
  return { path, message };
}

function formatField(field: TemplateField, value: Scalar): string {
  if (isBlank(value)) return "";
  switch (field.type) {
    case "money":
      return formatMoney(value as number);
    case "number":
      return String(value);
    case "percent":
      return formatPercentBps(value as number);
    case "date":
      return formatDateVN(value as string);
    case "text":
    case "paragraph":
    case "choice":
      return String(value);
  }
}

function validateManualValue(field: TemplateField, value: Scalar): string | null {
  if (isBlank(value)) return null;
  switch (field.type) {
    case "text":
    case "paragraph":
    case "date":
    case "choice":
      if (typeof value !== "string") return `Trường ${field.label} phải là chữ.`;
      if (field.type === "date") {
        try {
          formatDateVN(value);
        } catch {
          return `Trường ${field.label} phải là ngày ISO hợp lệ.`;
        }
      }
      if (field.type === "choice" && field.options !== undefined && !field.options.includes(value)) {
        return `Giá trị của ${field.key} không nằm trong danh sách cho phép.`;
      }
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) return `Trường ${field.label} phải là số nguyên.`;
      return null;
    case "money":
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return `Trường ${field.label} phải là số tiền nguyên không âm.`;
      }
      return null;
    case "percent":
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
        return `Trường ${field.label} phải là basis points từ 0 đến 10000.`;
      }
      return null;
  }
}

function sourceValue(
  field: TemplateField,
  customer: CustomerInput,
  price: PriceRow | null,
  derived: Record<string, Scalar>,
  manual: Record<string, Scalar>,
): Scalar {
  if (field.source === "manual") return manual[field.key];
  if (field.source === "issue:number") return undefined;
  const separator = field.source.indexOf(":");
  if (separator < 0) return undefined;
  const kind = field.source.slice(0, separator);
  const ref = field.source.slice(separator + 1);
  if (kind === "subject") return customer[ref as keyof CustomerInput] as Scalar;
  if (kind === "price_list") return price === null ? undefined : (price[ref as keyof PriceRow] as Scalar);
  if (kind === "derived") return derived[ref];
  return undefined;
}

function defaultValue(field: TemplateField, docDate: string): Scalar {
  if (field.default === undefined) return undefined;
  if (field.default === "derived:doc_date") return docDate;
  return field.default;
}

function fieldsForMerge(fields: Record<string, string>): Record<string, string> {
  return { ...fields, so_hop_dong: "" };
}

export function buildSnapshot(i: {
  version: TemplateVersionInput;
  customer: CustomerInput;
  price: PriceRow | null;
  values: Record<string, unknown>;
  docDate: string;
  manualStart: boolean;
}): BuildResult {
  const errors: Array<{ path: string; message: string }> = [];
  try {
    formatDateVN(i.docDate);
  } catch {
    errors.push(invalid("docDate", "docDate phải là ngày ISO hợp lệ."));
  }

  const manualFields = i.version.fields.filter((field) => field.source === "manual");
  const manualKeys = new Set(manualFields.map((field) => field.key));
  for (const key of Object.keys(i.values)) {
    if (!manualKeys.has(key)) errors.push(invalid(key, `Không được gửi trường không phải manual: ${key}.`));
  }
  if (errors.length > 0) return { ok: false, kind: "invalid", errors };

  const manual: Record<string, Scalar> = {};
  const inputs: Record<string, string | number> = {};
  for (const field of manualFields) {
    const supplied = i.values[field.key];
    let value: Scalar = supplied as Scalar;
    if (field.key === "ngay_bat_dau" && !i.manualStart) {
      value = i.docDate;
    } else if (isBlank(value)) {
      value = defaultValue(field, i.docDate);
    }
    manual[field.key] = value;
    const error = validateManualValue(field, value);
    if (error !== null) errors.push(invalid(field.key, error));
    if (!isBlank(value) && (typeof value === "string" || typeof value === "number")) inputs[field.key] = value;
  }

  const maGoi = manual.ma_goi;
  if (maGoi !== undefined && typeof maGoi !== "string") {
    errors.push(invalid("ma_goi", "ma_goi phải là một mã gói."));
  }
  if (typeof maGoi === "string" && !["G3", "G6", "G12"].includes(maGoi)) {
    errors.push(invalid("ma_goi", `ma_goi "${maGoi}" không được phép; chỉ nhận G3, G6 hoặc G12.`));
  }

  const quantity = manual.so_cua_hang;
  const quantityNumber = typeof quantity === "number" ? quantity : undefined;
  if (quantityNumber !== undefined && (!Number.isSafeInteger(quantityNumber) || quantityNumber < 1 || quantityNumber > 999)) {
    errors.push(invalid("so_cua_hang", "so_cua_hang phải là số nguyên từ 1 đến 999."));
  }
  const discountBps = manual.giam_gia;
  const discountBpsNumber = typeof discountBps === "number" ? discountBps : undefined;
  if (
    discountBpsNumber !== undefined &&
    (!Number.isSafeInteger(discountBpsNumber) || discountBpsNumber < 0 || discountBpsNumber > 10_000)
  ) {
    errors.push(invalid("giam_gia", "giam_gia phải là basis points từ 0 đến 10000."));
  }

  if (i.price === null && typeof maGoi === "string") {
    errors.push(invalid("ma_goi", `Không có giá áp dụng cho ma_goi "${maGoi}" vào ngày ${i.docDate}.`));
  }
  if (i.price !== null && typeof maGoi === "string" && i.price.code !== maGoi) {
    errors.push(invalid("ma_goi", "Dòng giá không khớp với ma_goi."));
  }
  if (i.price !== null && i.price.duration_unit !== "month") {
    errors.push(invalid("ma_goi", "Chỉ gói theo tháng mới được dùng cho hợp đồng."));
  }

  if (errors.length > 0) return { ok: false, kind: "invalid", errors };

  const requiredMissing: Array<{ key: string; label: string }> = [];
  const resolvedWithoutDerived = new Map<string, Scalar>();
  for (const field of i.version.fields) {
    if (field.source === "issue:number" || field.source.startsWith("derived:")) continue;
    const value = sourceValue(field, i.customer, i.price, {}, manual);
    resolvedWithoutDerived.set(field.key, value);
    if (field.required && isBlank(value)) requiredMissing.push({ key: field.key, label: field.label });
  }
  if (requiredMissing.length > 0) return { ok: false, kind: "missing-fields", missing: requiredMissing };

  const start = resolvedWithoutDerived.get("ngay_bat_dau");
  const duration = i.price?.duration_value;
  if (typeof start !== "string" || typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 1) {
    return {
      ok: false,
      kind: "invalid",
      errors: [invalid("ngay_bat_dau", "Ngày bắt đầu hoặc thời hạn gói không hợp lệ.")],
    };
  }

  let amounts: { gross: number; discountAmount: number; total: number };
  try {
    amounts = computeAmounts({
      unitPrice: i.price!.unit_price,
      qty: quantityNumber as number,
      discountBps: discountBpsNumber as number,
    });
  } catch (error) {
    return {
      ok: false,
      kind: "invalid",
      errors: [invalid("price", error instanceof Error ? error.message : "Giá hoặc số tiền không hợp lệ.")],
    };
  }

  let end: string;
  try {
    end = contractEnd(start, duration);
  } catch {
    return { ok: false, kind: "invalid", errors: [invalid("ngay_bat_dau", "Ngày bắt đầu không hợp lệ.")] };
  }
  const totalWords = amountInWords(amounts.total);
  const derived: Record<string, Scalar> = {
    doc_date: i.docDate,
    contract_end: end,
    total: amounts.total,
    total_in_words: totalWords,
    discount_bps: discountBps,
  };

  const resolved = new Map<string, Scalar>();
  for (const field of i.version.fields) {
    if (field.source === "issue:number") continue;
    const value = sourceValue(field, i.customer, i.price, derived, manual);
    resolved.set(field.key, value);
    if (field.required && isBlank(value)) requiredMissing.push({ key: field.key, label: field.label });
  }

  if (requiredMissing.length > 0) return { ok: false, kind: "missing-fields", missing: requiredMissing };

  for (const [index, rule] of i.version.field_rules.entries()) {
    const left = resolved.get(rule.all_or_none[0]);
    const right = resolved.get(rule.all_or_none[1]);
    if (isBlank(left) !== isBlank(right)) {
      errors.push(invalid(`field_rules[${index}]`, `Hai trường ${rule.all_or_none.join(" và ")} phải cùng có hoặc cùng không có giá trị.`));
    }
  }
  if (errors.length > 0) return { ok: false, kind: "invalid", errors };

  const fields: Record<string, string> = {};
  for (const field of i.version.fields) {
    if (field.source === "issue:number") continue;
    const value = resolved.get(field.key);
    try {
      fields[field.key] = formatField(field, value);
    } catch (error) {
      errors.push(invalid(field.key, error instanceof Error ? error.message : `Giá trị ${field.key} không hợp lệ.`));
    }
  }
  if (errors.length > 0) return { ok: false, kind: "invalid", errors };

  const merged = mergeFields(i.version.body, fieldsForMerge(fields));
  if (merged.leftover.length > 0) return { ok: false, kind: "unresolved-placeholder", placeholders: merged.leftover };

  const snapshot: Snapshot = {
    template: { id: i.version.template_id, version_id: i.version.id, version_no: i.version.version_no },
    customer: {
      id: i.customer.id,
      name: i.customer.name,
      contact_person: i.customer.contact_person,
      phone: i.customer.phone,
      email: i.customer.email,
      tax_code: i.customer.tax_code,
      address: i.customer.address,
    },
    package: {
      code: i.price!.code,
      name: i.price!.name,
      duration_value: i.price!.duration_value,
      duration_unit: "month",
      unit_price: i.price!.unit_price,
      effective_from: i.price!.effective_from,
    },
    inputs,
    fields,
    lines: [
      {
        description: i.price!.name,
        qty: quantityNumber as number,
        unit_price: i.price!.unit_price,
        discount_bps: discountBpsNumber as number,
        amount: amounts.total,
      },
    ],
    gross: amounts.gross,
    discount_amount: amounts.discountAmount,
    total: amounts.total,
    total_words: totalWords,
    dates: { doc_date: i.docDate, start, end },
    clauses: clone(i.version.default_clauses),
    policy: clone(i.version.approval_policy),
  };
  return { ok: true, snapshot };
}
