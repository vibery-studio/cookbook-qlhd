import { amountInWords } from "./amount-words";
import { contractEnd } from "./dates";
import type { DocType } from "./doc-types";
import { formatDateVN, formatMoney, formatPercentBps } from "./format";
import { GOODS_TABLE_SOURCE, LINES_TABLE_SOURCE } from "../template-sources";
import { MAX_LINES, MAX_QTY, priceLines, vatRatesLabel, type VatGroup } from "../money/line-pricing";
import { isValidIsoDate } from "../../utils/vn-date";
import { mergeFields } from "./merge";
import type {
  CustomerInput,
  DocLineInput,
  GoodsSnapshotLine,
  LineRef,
  ParentRef,
  PricedLineInput,
  Snapshot,
  SnapshotInputs,
  SnapshotLine,
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

/** `iso` + `days` calendar days (UTC arithmetic on a date-only value: no DST, crosses month/year ends). */
export function addDays(iso: string, days: number): string {
  if (!isValidIsoDate(iso)) throw new RangeError(`invalid ISO date: ${iso}`);
  if (!Number.isSafeInteger(days)) throw new RangeError("days must be an integer");
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** DEC-5: a BG is valid through doc_date + 15. */
export const QUOTE_VALID_DAYS = 15;
/** DEC-8: a DNTT is due doc_date + 7. */
export const PAYMENT_DUE_DAYS = 7;

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
    case "goods":
      return String(value);
  }
}

function validateManualValue(field: TemplateField, value: Scalar): string | null {
  if (isBlank(value)) return null;
  switch (field.type) {
    case "lines":
    case "goods":
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

interface SourceCtx {
  customer: CustomerInput;
  parent: ParentRef | null;
  creatorName: string | undefined;
  derived: Record<string, Scalar>;
  manual: Record<string, Scalar>;
}

function sourceValue(field: TemplateField, ctx: SourceCtx): Scalar {
  if (field.source === "manual") return ctx.manual[field.key];
  if (field.source === "issue:number") return undefined;
  const separator = field.source.indexOf(":");
  if (separator < 0) return undefined;
  const kind = field.source.slice(0, separator);
  const ref = field.source.slice(separator + 1);
  if (kind === "subject") return ctx.customer[ref as keyof CustomerInput] as Scalar;
  if (kind === "derived") return ctx.derived[ref];
  // SPEC-09 §3.3: blank on a standalone document (`{{#if}}` drops the "Căn cứ …" line — DEC-14)
  if (kind === "parent") {
    if (ctx.parent === null) return undefined;
    if (ref === "number") return ctx.parent.number;
    if (ref === "doc_date") return ctx.parent.doc_date;
    return undefined;
  }
  if (kind === "creator" && ref === "name") return ctx.creatorName;
  return undefined;
}

function defaultValue(field: TemplateField, docDate: string): Scalar {
  if (field.default === undefined) return undefined;
  if (field.default === "derived:doc_date") return docDate;
  return field.default;
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

/** SPEC-09 FR-12, P-1: a delivery note carries goods only, 1..50 lines, integer qty 1..9999. */
export function deliveryLinesRule(lines: readonly Pick<DocLineInput, "kind" | "qty">[]): string | null {
  if (lines.length < 1 || lines.length > MAX_LINES) return `Phiếu xuất kho cần từ 1 đến ${MAX_LINES} dòng hàng hóa.`;
  if (lines.some((l) => l.kind !== "goods")) return "Phiếu xuất kho chỉ gồm hàng hóa, không có gói dịch vụ.";
  if (lines.some((l) => !Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY)) {
    return `Số lượng mỗi dòng phải là số nguyên từ 1 đến ${MAX_QTY}.`;
  }
  return null;
}

function isPricedInput(l: DocLineInput): l is PricedLineInput {
  return (
    typeof l.unit_price_ex_vat === "number" &&
    (l.vat_rate_bps === null || typeof l.vat_rate_bps === "number") &&
    typeof l.price_from === "string"
  );
}

/** A priced line without its computed amounts (what `priceLines` takes; what a child freezes). */
export function pricedInput(l: PricedLineInput): PricedLineInput {
  return {
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
  };
}

function lineRefs(lines: readonly DocLineInput[]): LineRef[] {
  return lines.map((l) => ({ product_id: l.product_id, qty: l.qty }));
}

/**
 * Where the lines + money come from:
 * - `lines`: resolved lines (HĐ/BG priced today; PXK unpriced) — a standalone document;
 * - `frozen`: a child HĐ re-priced from its BG's frozen lines + discount (SPEC-09 FR-5) — never looked up again;
 * - `copy`: a DNTT copies lines, VAT groups and totals verbatim from its HĐ (DEC-8).
 */
export type MoneySource =
  | { kind: "lines"; lines: readonly DocLineInput[] }
  | { kind: "frozen"; lines: readonly PricedLineInput[]; discountBps: number; frozenFrom: string }
  | { kind: "copy"; from: Snapshot; frozenFrom: string };

interface Money {
  lines: SnapshotLine[] | GoodsSnapshotLine[];
  vat_groups: VatGroup[];
  subtotal_ex_vat: number;
  discount_amount: number;
  total_ex_vat: number;
  vat_total: number;
  total: number;
  total_words: string | undefined;
}

/** Shared core of `buildSnapshot` and `buildChildSnapshot` (child-snapshot.ts). Pure. */
export function buildDocument(i: {
  type: DocType;
  version: TemplateVersionInput;
  customer: CustomerInput;
  values: Record<string, unknown>;
  docDate: string;
  manualStart: boolean;
  creatorName?: string;
  parent: ParentRef | null;
  source: MoneySource;
}): BuildResult {
  const isPxk = i.type === "delivery_note";
  const errors: Array<{ path: string; message: string }> = [];
  try {
    formatDateVN(i.docDate);
  } catch {
    errors.push(invalid("docDate", "docDate phải là ngày ISO hợp lệ."));
  }

  // P-1: a PXK has no discount — any giam_gia (even 0) is refused at `values.giam_gia`
  if (isPxk && i.values.giam_gia !== undefined) {
    errors.push(invalid("values.giam_gia", "Phiếu xuất kho không có giảm giá."));
  }
  const manualFields = i.version.fields.filter((field) => field.source === "manual");
  const manualKeys = new Set(manualFields.map((field) => field.key));
  for (const key of Object.keys(i.values)) {
    if (isPxk && key === "giam_gia") continue;
    if (!manualKeys.has(key)) errors.push(invalid(key, `Không được gửi trường không phải manual: ${key}.`));
  }
  if (errors.length > 0) return { ok: false, kind: "invalid", errors };

  const forcedDiscount =
    i.source.kind === "frozen" ? i.source.discountBps : i.source.kind === "copy" ? i.source.from.discount_bps : isPxk ? 0 : undefined;

  const manual: Record<string, Scalar> = {};
  const manualInputs: Record<string, string | number> = {};
  for (const field of manualFields) {
    const supplied = i.values[field.key];
    let value: Scalar = supplied as Scalar;
    if (field.key === "giam_gia" && forcedDiscount !== undefined) {
      value = forcedDiscount;
    } else if (field.key === "ngay_bat_dau" && !i.manualStart) {
      value = i.docDate;
    } else if (isBlank(value)) {
      value = defaultValue(field, i.docDate);
    }
    manual[field.key] = value;
    const error = validateManualValue(field, value);
    if (error !== null) errors.push(invalid(field.key, error));
    if (!isBlank(value) && (typeof value === "string" || typeof value === "number")) manualInputs[field.key] = value;
  }

  const discountBps = forcedDiscount ?? manual.giam_gia;
  const discountBpsNumber = typeof discountBps === "number" ? discountBps : 0;
  if (!Number.isSafeInteger(discountBpsNumber) || discountBpsNumber < 0 || discountBpsNumber > 10_000) {
    errors.push(invalid("giam_gia", "giam_gia phải là basis points từ 0 đến 10000."));
  }

  // the document's line rule
  let toPrice: PricedLineInput[] | null = null;
  let goods: GoodsSnapshotLine[] | null = null;
  if (i.source.kind === "lines") {
    if (isPxk) {
      const rule = deliveryLinesRule(i.source.lines);
      if (rule !== null) errors.push(invalid("lines", rule));
      else goods = i.source.lines.map((l) => ({ product_id: l.product_id, code: l.code, name: l.name, unit: l.unit, qty: l.qty }));
    } else if (!i.source.lines.every(isPricedInput)) {
      errors.push(invalid("lines", "Dòng hàng chưa có giá áp dụng."));
    } else {
      toPrice = i.source.lines.map(pricedInput);
    }
  } else if (i.source.kind === "frozen") {
    toPrice = i.source.lines.map(pricedInput);
  }
  if (i.type === "contract" && toPrice !== null) {
    const rule = contractLinesRule(toPrice);
    if (rule !== null) errors.push(invalid("lines", rule));
  }
  if (errors.length > 0) return { ok: false, kind: "invalid", errors };

  const baseCtx = { customer: i.customer, parent: i.parent, creatorName: i.creatorName, manual };
  const requiredMissing: Array<{ key: string; label: string }> = [];
  const resolvedWithoutDerived = new Map<string, Scalar>();
  for (const field of i.version.fields) {
    if (field.source === "issue:number" || field.source.startsWith("derived:")) continue;
    const value = sourceValue(field, { ...baseCtx, derived: {} });
    resolvedWithoutDerived.set(field.key, value);
    if (field.required && isBlank(value)) requiredMissing.push({ key: field.key, label: field.label });
  }
  if (requiredMissing.length > 0) return { ok: false, kind: "missing-fields", missing: requiredMissing };

  // money (integer đồng only via priceLines — SPEC-08 FR-11)
  let money: Money;
  if (i.source.kind === "copy") {
    const from = i.source.from;
    money = {
      lines: clone(from.lines),
      vat_groups: clone(from.vat_groups),
      subtotal_ex_vat: from.subtotal_ex_vat,
      discount_amount: from.discount_amount,
      total_ex_vat: from.total_ex_vat,
      vat_total: from.vat_total,
      total: from.total,
      total_words: from.total_words,
    };
  } else if (goods !== null) {
    money = { lines: goods, vat_groups: [], subtotal_ex_vat: 0, discount_amount: 0, total_ex_vat: 0, vat_total: 0, total: 0, total_words: undefined };
  } else {
    try {
      const priced = priceLines(toPrice!, discountBpsNumber);
      money = {
        lines: priced.lines.map((l) => ({
          ...pricedInput(l),
          amount_ex_vat: l.amount_ex_vat,
          discount_amount: l.discount_amount,
          net_ex_vat: l.net_ex_vat,
        })),
        vat_groups: priced.vat_groups,
        subtotal_ex_vat: priced.subtotal_ex_vat,
        discount_amount: priced.discount_amount,
        total_ex_vat: priced.total_ex_vat,
        vat_total: priced.vat_total,
        total: priced.total,
        total_words: amountInWords(priced.total),
      };
    } catch (error) {
      return {
        ok: false,
        kind: "invalid",
        errors: [invalid("lines", error instanceof Error ? error.message : "Giá hoặc số tiền không hợp lệ.")],
      };
    }
  }

  // dates by type
  const dates: Snapshot["dates"] = { doc_date: i.docDate };
  const allLines: ReadonlyArray<SnapshotLine | GoodsSnapshotLine> = money.lines;
  const services = allLines.filter((l): l is SnapshotLine => (l as SnapshotLine).kind === "service");
  if (i.type === "contract") {
    const start = resolvedWithoutDerived.get("ngay_bat_dau");
    const duration = services[0]?.duration_value;
    if (typeof start !== "string" || typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 1) {
      return { ok: false, kind: "invalid", errors: [invalid("ngay_bat_dau", "Ngày bắt đầu hoặc thời hạn gói không hợp lệ.")] };
    }
    try {
      dates.start = start;
      dates.end = contractEnd(start, duration);
    } catch {
      return { ok: false, kind: "invalid", errors: [invalid("ngay_bat_dau", "Ngày bắt đầu không hợp lệ.")] };
    }
  } else if (i.type === "quote") {
    dates.valid_until = addDays(i.docDate, QUOTE_VALID_DAYS);
  } else if (i.type === "payment_request") {
    dates.payment_due = addDays(i.docDate, PAYMENT_DUE_DAYS);
  }

  const amountRequested = i.type === "payment_request" ? (i.parent?.total ?? money.total) : undefined;
  const derived: Record<string, Scalar> = {
    doc_date: i.docDate,
    contract_end: dates.end,
    valid_until: dates.valid_until,
    payment_due: dates.payment_due,
    total: money.total,
    total_in_words: money.total_words,
    discount_bps: isPxk ? 0 : discountBps,
    subtotal_ex_vat: money.subtotal_ex_vat,
    discount_amount: money.discount_amount,
    total_ex_vat: money.total_ex_vat,
    vat_total: money.vat_total,
    vat_rates: vatRatesLabel(money.vat_groups),
    service_name: services.length > 0 ? services.map((l) => l.name).join(", ") : undefined,
    amount_requested: amountRequested,
    amount_requested_in_words: amountRequested === undefined ? undefined : amountInWords(amountRequested),
    // plain-text stand-ins (drawer, {{#if}}); the paper prints the escaped tables instead (line/goods_table_fields)
    lines_table: allLines.map((l) => `${l.name} × ${l.qty}`).join("; "),
    goods_table: isPxk ? allLines.map((l) => `${l.name} × ${l.qty}`).join("; ") : undefined,
  };

  const resolved = new Map<string, Scalar>();
  for (const field of i.version.fields) {
    if (field.source === "issue:number") continue;
    const value = sourceValue(field, { ...baseCtx, derived });
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

  const numberFields = i.version.fields.filter((f) => f.source === "issue:number").map((f) => f.key);
  // a DNTT's so_hop_dong is its parent's number (a field), not its own number
  const mergeValues: Record<string, string> = { so_hop_dong: "", ...fields };
  for (const key of numberFields) mergeValues[key] = "";
  const merged = mergeFields(i.version.body, mergeValues);
  if (merged.leftover.length > 0) return { ok: false, kind: "unresolved-placeholder", placeholders: merged.leftover };

  let inputs: SnapshotInputs;
  if (i.source.kind === "lines") {
    inputs = { ...manualInputs, lines: lineRefs(i.source.lines) };
  } else {
    const frozen = i.source.kind === "frozen" ? toPrice! : (i.source.from.lines as SnapshotLine[]).map(pricedInput);
    inputs = { ...manualInputs, lines: frozen, frozen_from: i.source.frozenFrom };
  }

  const snapshot: Snapshot = {
    type: i.type,
    parent: i.parent === null ? null : { ...i.parent },
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
    line_table_fields: isPxk ? [] : i.version.fields.filter((f) => f.type === "lines" && f.source === LINES_TABLE_SOURCE).map((f) => f.key),
    goods_table_fields: isPxk ? i.version.fields.filter((f) => f.type === "goods" && f.source === GOODS_TABLE_SOURCE).map((f) => f.key) : [],
    number_fields: numberFields,
    lines: money.lines,
    vat_groups: money.vat_groups,
    subtotal_ex_vat: money.subtotal_ex_vat,
    discount_bps: isPxk ? 0 : discountBpsNumber,
    discount_amount: money.discount_amount,
    total_ex_vat: money.total_ex_vat,
    vat_total: money.vat_total,
    total: money.total,
    ...(money.total_words === undefined ? {} : { total_words: money.total_words }),
    ...(i.type === "quote" ? { creator_name: i.creatorName ?? null } : {}),
    ...(amountRequested === undefined ? {} : { amount_requested: amountRequested }),
    dates,
    clauses: clone(i.version.default_clauses),
    policy: clone(i.version.approval_policy),
  };
  return { ok: true, snapshot };
}

/**
 * A standalone document (no parent). `type` defaults to `contract` (today's DEC-10 rule) so pre-SPEC-09 callers keep working.
 * BG: free lines 1–50, `valid_until` = doc_date + 15, `creator_name`. PXK: goods only, no price needed, money 0, no discount.
 * A DNTT is never standalone (→ `invalid` `type`; the service answers `parent-required` first).
 */
export function buildSnapshot(i: {
  version: TemplateVersionInput;
  customer: CustomerInput;
  /** Lines already resolved to product (+ level on `docDate` for priced types; per-line rules checked by the caller — PLAN-08 P-2). */
  lines: DocLineInput[];
  values: Record<string, unknown>;
  docDate: string;
  manualStart: boolean;
  type?: DocType;
  /** `creator:name` — the document's creator (BG "Nhân viên phụ trách"). */
  creatorName?: string;
}): BuildResult {
  const type = i.type ?? "contract";
  if (type === "payment_request") {
    return { ok: false, kind: "invalid", errors: [invalid("type", "Đề nghị thanh toán chỉ lập từ hợp đồng đã phát hành.")] };
  }
  return buildDocument({
    type,
    version: i.version,
    customer: i.customer,
    values: i.values,
    docDate: i.docDate,
    manualStart: i.manualStart,
    ...(i.creatorName === undefined ? {} : { creatorName: i.creatorName }),
    parent: null,
    source: { kind: "lines", lines: i.lines },
  });
}
