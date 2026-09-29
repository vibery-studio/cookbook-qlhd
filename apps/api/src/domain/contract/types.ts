export type ContractStatus = "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";

export type FieldType = "text" | "paragraph" | "money" | "number" | "percent" | "date" | "choice";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  source: string;
  options?: string[];
  options_from?: "price_list";
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

export interface PriceRow {
  code: string;
  name: string;
  duration_value: number;
  duration_unit: "day" | "month";
  unit_price: number;
  effective_from: string;
}

export interface Line {
  description: string;
  qty: number;
  unit_price: number;
  discount_bps: number;
  amount: number;
}

export interface Snapshot {
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
  package: {
    code: string;
    name: string;
    duration_value: number;
    duration_unit: "month";
    unit_price: number;
    effective_from: string;
  };
  inputs: Record<string, string | number>;
  fields: Record<string, string>;
  lines: Line[];
  gross: number;
  discount_amount: number;
  total: number;
  total_words: string;
  dates: { doc_date: string; start: string; end: string };
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
