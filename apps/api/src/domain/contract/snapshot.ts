import { amountInWords } from "./amount-words";
import { contractEnd } from "./dates";
import { formatDateVN, formatMoney, formatPercentBps } from "./format";
import { LINES_TABLE_SOURCE } from "../template-sources";
import { priceLines, vatRatesLabel, type PricedLines } from "../money/line-pricing";
import { mergeFields } from "./merge";
import type {
  CustomerInput,
  LineRef,
  PricedLineInput,
  Snapshot,
  SnapshotInputs,
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
    case "lines":
      return String(value);
  }
}

function validateManualValue(field: TemplateField, value: Scalar): string | null {
  if (isBlank(value)) return null;
  switch (field.type) {
    case "lines":
      return `Trường ${field.label} là bảng dòng hàng, không nhập tay.`;
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

/** DEC-10 (SPEC-08 §3.3): a contract has exactly one monthly service line (its end date, `ten_goi`) + 0..n goods. */
export function contractLinesRule(lines: readonly Pick<PricedLineInput, "kind" | "duration_unit" | "duration_value">[]): string | null {
  const services = lines.filter((l) => l.kind === "service");
  if (services.length !== 1) return "Hợp đồng cần đúng 1 gói dịch vụ theo tháng (cộng thêm hàng hóa nếu có).";
  const service = services[0]!;
  if (service.duration_unit !== "month" || service.duration_value === null || service.duration_value < 1) {
    return "Gói dịch vụ của hợp đồng phải tính theo tháng.";
  }
  return null;
}

function lineRefs(lines: readonly PricedLineInput[]): LineRef[] {
  return lines.map((l) => ({ product_id: l.product_id, qty: l.qty }));
}

export function buildSnapshot(i: {
  version: TemplateVersionInput;
  customer: CustomerInput;
  /** Lines already resolved to product + level on `docDate` (per-line rules checked by the caller — PLAN-08 P-2). */
  lines: PricedLineInput[];
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
  const manualInputs: Record<string, string | number> = {};
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
    if (!isBlank(value) && (typeof value === "string" || typeof value === "number")) manualInputs[field.key] = value;
  }

  const discountBps = manual.giam_gia;
  const discountBpsNumber = typeof discountBps === "number" ? discountBps : 0;
  if (!Number.isSafeInteger(discountBpsNumber) || discountBpsNumber < 0 || discountBpsNumber > 10_000) {
    errors.push(invalid("giam_gia", "giam_gia phải là basis points từ 0 đến 10000."));
  }

  const rule = contractLinesRule(i.lines);
  if (rule !== null) errors.push(invalid("lines", rule));
  if (errors.length > 0) return { ok: false, kind: "invalid", errors };

  const requiredMissing: Array<{ key: string; label: string }> = [];
  const resolvedWithoutDerived = new Map<string, Scalar>();
  for (const field of i.version.fields) {
    if (field.source === "issue:number" || field.source.startsWith("derived:")) continue;
    const value = sourceValue(field, i.customer, {}, manual);
    resolvedWithoutDerived.set(field.key, value);
    if (field.required && isBlank(value)) requiredMissing.push({ key: field.key, label: field.label });
  }
  if (requiredMissing.length > 0) return { ok: false, kind: "missing-fields", missing: requiredMissing };

  const service = i.lines.find((l) => l.kind === "service")!;
  const start = resolvedWithoutDerived.get("ngay_bat_dau");
  const duration = service.duration_value;
  if (typeof start !== "string" || typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 1) {
    return {
      ok: false,
      kind: "invalid",
      errors: [invalid("ngay_bat_dau", "Ngày bắt đầu hoặc thời hạn gói không hợp lệ.")],
    };
  }

  let priced: PricedLines<PricedLineInput>;
  try {
    priced = priceLines(i.lines, discountBpsNumber);
  } catch (error) {
    return {
      ok: false,
      kind: "invalid",
      errors: [invalid("lines", error instanceof Error ? error.message : "Giá hoặc số tiền không hợp lệ.")],
    };
  }

  let end: string;
  try {
    end = contractEnd(start, duration);
  } catch {
    return { ok: false, kind: "invalid", errors: [invalid("ngay_bat_dau", "Ngày bắt đầu không hợp lệ.")] };
  }
  const totalWords = amountInWords(priced.total);
  const derived: Record<string, Scalar> = {
    doc_date: i.docDate,
    contract_end: end,
    total: priced.total,
    total_in_words: totalWords,
    discount_bps: discountBps,
    subtotal_ex_vat: priced.subtotal_ex_vat,
    discount_amount: priced.discount_amount,
    total_ex_vat: priced.total_ex_vat,
    vat_total: priced.vat_total,
    vat_rates: vatRatesLabel(priced.vat_groups),
    service_name: service.name,
    // plain-text stand-in (drawer, {{#if}}); the paper prints the escaped table instead (line_table_fields)
    lines_table: i.lines.map((l) => `${l.name} × ${l.qty}`).join("; "),
  };

  const resolved = new Map<string, Scalar>();
  for (const field of i.version.fields) {
    if (field.source === "issue:number") continue;
    const value = sourceValue(field, i.customer, derived, manual);
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

  const inputs: SnapshotInputs = { ...manualInputs, lines: lineRefs(i.lines) };
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
    inputs,
    fields,
    line_table_fields: i.version.fields.filter((f) => f.type === "lines" && f.source === LINES_TABLE_SOURCE).map((f) => f.key),
    lines: priced.lines.map((l) => ({
      product_id: l.product_id,
      code: l.code,
      name: l.name,
      kind: l.kind,
      unit: l.unit,
      duration_value: l.duration_value,
      duration_unit: l.duration_unit,
      qty: l.qty,
      unit_price_ex_vat: l.unit_price_ex_vat,
      vat_rate_bps: l.vat_rate_bps,
      price_from: l.price_from,
      amount_ex_vat: l.amount_ex_vat,
      discount_amount: l.discount_amount,
      net_ex_vat: l.net_ex_vat,
    })),
    vat_groups: priced.vat_groups,
    subtotal_ex_vat: priced.subtotal_ex_vat,
    discount_bps: discountBpsNumber,
    discount_amount: priced.discount_amount,
    total_ex_vat: priced.total_ex_vat,
    vat_total: priced.vat_total,
    total: priced.total,
    total_words: totalWords,
    dates: { doc_date: i.docDate, start, end },
    clauses: clone(i.version.default_clauses),
    policy: clone(i.version.approval_policy),
  };
  return { ok: true, snapshot };
}
