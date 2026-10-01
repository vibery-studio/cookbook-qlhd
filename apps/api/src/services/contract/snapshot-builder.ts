import { getCustomer } from "../../dao/customer-dao";
import { getCurrentVersion, getTemplateVersionById } from "../../dao/template-dao";
import { snapshotHash } from "../../domain/contract/hash";
import { buildSnapshot } from "../../domain/contract/snapshot";
import type {
  ApprovalPolicy,
  CustomerInput,
  FieldRule,
  LineRef,
  Snapshot,
  TemplateField,
  TemplateVersionInput,
} from "../../domain/contract/types";
import type { Db } from "../../db/client";
import { todayInVN } from "../../utils/vn-date";
import { resolveLines } from "../pricing-service";
import type { BuildFailure } from "./types";

const MAX_SNAPSHOT_BYTES = 256 * 1024;

export interface LoadAndBuildInput {
  templateVersionId?: string;
  templateId?: string;
  customerId: string;
  lines: LineRef[];
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

/** A stored snapshot's inputs → the requested lines + the manual values (for edit / copy: re-priced on the new date). */
export function splitInputs(snapshot: Pick<Snapshot, "inputs">): { lines: LineRef[]; values: Record<string, unknown> } {
  const { lines, ...values } = snapshot.inputs ?? { lines: [] };
  return { lines: Array.isArray(lines) ? lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) : [], values };
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
  // PLAN-08 P-2: per-line rules first (unknown / duplicate / inactive / no price), then the document rule in buildSnapshot.
  const resolved = await resolveLines(db, input.lines, docDate);
  if (resolved.kind !== "ok") return resolved;
  const version = decodeTemplateVersion(versionRow);
  const result = buildSnapshot({
    version,
    customer: customerInput(customerRow),
    lines: resolved.lines,
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
