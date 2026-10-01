import type { DocType } from "./doc-types";

export type ContractStatus = "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";

export type FieldType = "text" | "paragraph" | "money" | "number" | "percent" | "date" | "choice" | "lines" | "goods";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  source: string;
  options?: string[];
  default?: string | number;
}

export interface FieldRule {
  all_or_none: [string, string];
}

export interface PolicyStep {
  step_no: number;
  label: string;
  permission: string;
  role?: string;
}

export interface PolicyRule {
  when: { var: string; op: "gt" | "gte" | "lt" | "lte" | "eq"; value: number };
  add_steps: Array<{ label: string; permission: string; role?: string }>;
}

export interface ApprovalPolicy {
  mode: "none" | "steps" | "threshold" | "combined";
  steps?: PolicyStep[];
  rules?: PolicyRule[];
}

export interface TemplateVersionInput {
  id: string;
  template_id: string;
  version_no: number;
  body: string;
  fields: TemplateField[];
  field_rules: FieldRule[];
  default_line_items: unknown[];
  default_clauses: unknown[];
  approval_policy: ApprovalPolicy;
}

export interface CustomerInput {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  tax_code: string | null;
  address: string | null;
}

/** One requested line (`inputs.lines`, API body): the client sends only these two (I4). */
export interface LineRef {
  product_id: string;
  qty: number;
}

/** A line with the product + the price level in force on the doc date (SPEC-08 §3.2), before the money is computed. */
export interface PricedLineInput {
  product_id: string;
  code: string;
  name: string;
  kind: "service" | "goods";
  unit: string;
  duration_value: number | null;
  duration_unit: "day" | "month" | null;
  qty: number;
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
  /** effective_from of the level used. */
  price_from: string;
}

/**
 * A line as the builder receives it. Priced documents (HĐ, BG) need the three price keys (checked at runtime → `validation`
 * `lines`); a delivery note (PXK, DEC-12 A) needs none.
 */
export type DocLineInput = Omit<PricedLineInput, "unit_price_ex_vat" | "vat_rate_bps" | "price_from"> &
  Partial<Pick<PricedLineInput, "unit_price_ex_vat" | "vat_rate_bps" | "price_from">>;

/** A PXK line (SPEC-09 §3.3, P-8): goods only, no money. */
export interface GoodsSnapshotLine {
  product_id: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
}

/** The parent a child was made from, copied at creation (SPEC-09 §3.3). */
export interface ParentRef {
  id: string;
  type: DocType;
  number: string | null;
  doc_date: string;
  total: number;
}

export interface SnapshotLine extends PricedLineInput {
  amount_ex_vat: number;
  discount_amount: number;
  net_ex_vat: number;
}

export interface SnapshotVatGroup {
  vat_rate_bps: number | null;
  base: number;
  vat: number;
}

/**
 * Manual values as entered + the requested lines (for edit / copy). A child (SPEC-09 §3.3) stores its frozen lines here
 * (with price, VAT rate, `price_from` — still `LineRef`-compatible) + `frozen_from` = parent id: never re-priced.
 */
export type SnapshotInputs = { lines: LineRef[]; frozen_from?: string } & Record<string, string | number | LineRef[]>;

export interface Snapshot {
  /** SPEC-09: document type; absent on pre-row-4 snapshots (= contract). */
  type: DocType;
  /** The parent ref copied when the child was made; `null` for a standalone document. */
  parent: ParentRef | null;
  template: { id: string; version_id: string; version_no: number };
  customer: {
    id: string;
    name: string;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    tax_code: string | null;
    address: string | null;
  };
  inputs: SnapshotInputs;
  fields: Record<string, string>;
  /** Keys of `lines`-type fields: their placeholder takes the server-built table of `lines` (PLAN-08 R-5). */
  line_table_fields: string[];
  /** Keys of `goods`-type fields (`derived:goods_table`): their placeholder takes the server-built 02-VT table. */
  goods_table_fields: string[];
  /** Keys of `issue:number` fields: blank in a draft, the issued number on print. Absent on old snapshots (= so_hop_dong). */
  number_fields: string[];
  /** Priced lines (HĐ, BG, DNTT) or PXK goods lines. */
  lines: SnapshotLine[] | GoodsSnapshotLine[];
  vat_groups: SnapshotVatGroup[];
  subtotal_ex_vat: number;
  discount_bps: number;
  discount_amount: number;
  total_ex_vat: number;
  vat_total: number;
  /** Payable total, VAT included (= contracts.total). */
  total: number;
  /** Absent on a PXK (no money, DEC-12 A). */
  total_words?: string;
  /** BG: Nhân viên phụ trách (`creator:name`). */
  creator_name?: string | null;
  /** DNTT: = parent total (DEC-8). */
  amount_requested?: number;
  /** HĐ: start/end · BG: valid_until (= doc_date + 15) · DNTT: payment_due (= doc_date + 7) · PXK: doc_date only. */
  dates: { doc_date: string; start?: string; end?: string; valid_until?: string; payment_due?: string };
  clauses: unknown[];
  policy: ApprovalPolicy;
}

export interface RequiredStep {
  step_no: number;
  label: string;
  required_permission: string;
  required_role: string | null;
}

export interface Candidate {
  id: string;
  roles: readonly string[];
  permissions: readonly string[];
}

export const CONTRACT_ACTIONS = {
  created: "contract.created",
  updated: "contract.updated",
  submitted: "contract.submitted",
  approved: "contract.approved",
  rejected: "contract.rejected",
  issued: "contract.issued",
  voided: "contract.voided",
  withdrawn: "contract.withdrawn",
  deleted: "contract.deleted",
} as const;
