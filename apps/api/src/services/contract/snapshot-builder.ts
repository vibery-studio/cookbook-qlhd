import { getCustomer } from "../../dao/customer-dao";
import { getCurrentVersion, getTemplateVersionById } from "../../dao/template-dao";
import { priceListAt } from "../../dao/price-list-dao";
import { snapshotHash } from "../../domain/contract/hash";
import { buildSnapshot } from "../../domain/contract/snapshot";
import type {
  ApprovalPolicy,
  CustomerInput,
  FieldRule,
  PriceRow,
  Snapshot,
  TemplateField,
  TemplateVersionInput,
} from "../../domain/contract/types";
import type { Db } from "../../db/client";
import { todayInVN } from "../../utils/vn-date";
import type { BuildFailure } from "./types";

const MAX_SNAPSHOT_BYTES = 256 * 1024;

export interface LoadAndBuildInput {
  templateVersionId?: string;
  templateId?: string;
  customerId: string;
  values: Record<string, unknown>;
  now: Date;
  manualStart: boolean;
}

export interface BuiltSnapshot {
  snapshot: Snapshot;
  snapshotJson: string;
  snapshotHash: string;
  templateVersion: TemplateVersionInput;
}

export type LoadAndBuildResult =
  | { kind: "ok"; built: BuiltSnapshot }
  | BuildFailure
  | { kind: "not-found"; what: "customer" | "template" };

function decodeTemplateVersion(row: Awaited<ReturnType<typeof getTemplateVersionById>>): TemplateVersionInput {
  if (row === null) throw new Error("decodeTemplateVersion: missing row");
  return {
    id: row.id,
    template_id: row.templateId,
    version_no: row.versionNo,
    body: row.body,
    fields: JSON.parse(row.fields) as TemplateField[],
    field_rules: JSON.parse(row.fieldRules) as FieldRule[],
    default_line_items: JSON.parse(row.defaultLineItems) as unknown[],
    default_clauses: JSON.parse(row.defaultClauses) as unknown[],
    approval_policy: JSON.parse(row.approvalPolicy) as ApprovalPolicy,
  };
}

function customerInput(customer: Awaited<ReturnType<typeof getCustomer>>): CustomerInput {
  if (customer === null) throw new Error("customerInput: missing customer");
  return {
    id: customer.id,
    name: customer.name,
    contact_person: customer.contact_person,
    phone: customer.phone,
    email: customer.email,
    tax_code: customer.tax_code,
    address: customer.address,
  };
}

function priceInput(
  row: Awaited<ReturnType<typeof priceListAt>>[number] | undefined,
): PriceRow | null {
  if (row === undefined) return null;
  return {
    code: row.code,
    name: row.name,
    duration_value: row.duration_value,
    duration_unit: row.duration_unit,
    unit_price: row.unit_price,
    effective_from: row.effective_from,
  };
}

function mapBuildFailure(result: Exclude<ReturnType<typeof buildSnapshot>, { ok: true }>): BuildFailure {
  if (result.kind === "missing-fields") return result;
  if (result.kind === "unresolved-placeholder") return result;
  return { kind: "invalid", errors: result.errors };
}

/** Load all live inputs, then build one immutable contract snapshot. */
export async function loadAndBuild(db: Db, input: LoadAndBuildInput): Promise<LoadAndBuildResult> {
  const versionRow =
    input.templateVersionId !== undefined
      ? await getTemplateVersionById(db, input.templateVersionId)
      : input.templateId !== undefined
        ? await getCurrentVersion(db, input.templateId)
        : null;
  if (versionRow === null) return { kind: "not-found", what: "template" };

  const customerRow = await getCustomer(db, input.customerId);
  if (customerRow === null) return { kind: "not-found", what: "customer" };

  const docDate = todayInVN(input.now);
  const requestedCode = typeof input.values.ma_goi === "string" ? input.values.ma_goi : undefined;
  const prices = await priceListAt(db, docDate);
  const price = priceInput(prices.find((item) => item.code === requestedCode));
  const version = decodeTemplateVersion(versionRow);
  const result = buildSnapshot({
    version,
    customer: customerInput(customerRow),
    price,
    values: input.values,
    docDate,
    manualStart: input.manualStart,
  });
  if (!result.ok) return mapBuildFailure(result);

  const snapshotJson = JSON.stringify(result.snapshot);
  const snapshotBytes = new TextEncoder().encode(snapshotJson).byteLength;
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    return {
      kind: "invalid",
      errors: [{ path: "snapshot", message: "Snapshot không được vượt quá 256 KB." }],
    };
  }

  return {
    kind: "ok",
    built: {
      snapshot: result.snapshot,
      snapshotJson,
      snapshotHash: snapshotHash(result.snapshot),
      templateVersion: version,
    },
  };
}
