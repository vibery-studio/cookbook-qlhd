import type { Db } from "../../db/client";
import type { ContractDto, CreateChildInput } from "../../dto/contracts";
import { buildChildSnapshot } from "../../domain/contract/child-snapshot";
import { CHILD_OF, WRITE_PERM, type DocType } from "../../domain/contract/doc-types";
import { snapshotHash } from "../../domain/contract/hash";
import type { ApprovalPolicy, CustomerInput, FieldRule, Snapshot, TemplateField, TemplateVersionInput } from "../../domain/contract/types";
import { emitContractEvent } from "../../events/contract-events";
import { generateUlid } from "../../utils/id";
import { todayInVN } from "../../utils/vn-date";
import { createChildCas, getChildParent, getTemplateHead, seedTemplateIdOf, type ChildParentDto } from "../../dao/contract-children-dao";
import { getCustomer } from "../../dao/customer-dao";
import { getCurrentVersion } from "../../dao/template-dao";
import { findUserById } from "../../dao/user-dao";
import { contractDetail } from "./read-service";
import type { BuildFailure, CommandCtx } from "./types";

const MAX_SNAPSHOT_BYTES = 256 * 1024;

export type CreateChildResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found"; what: "contract" | "template" | "customer" }
  | { kind: "child-type" }
  | { kind: "forbidden"; permission: string }
  | { kind: "lines-locked" }
  | { kind: "template-type" }
  | { kind: "parent-not-issued"; current: string }
  | { kind: "quote-expired"; validUntil: string | null }
  | { kind: "nothing-to-pay" }
  | { kind: "child-exists"; existingId: string | null }
  | BuildFailure;

type Version = NonNullable<Awaited<ReturnType<typeof getCurrentVersion>>>;

function decodeVersion(row: Version): TemplateVersionInput {
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

/** Diagnosis of the parent half of the CAS (read only — the guard itself is the CAS in `createChildCas`). */
function parentBlock(parent: ChildParentDto, today: string): CreateChildResult | null {
  if (parent.status !== "issued") return { kind: "parent-not-issued", current: parent.status };
  if (parent.type === "quote" && (parent.validUntil === null || parent.validUntil < today)) {
    return { kind: "quote-expired", validUntil: parent.validUntil };
  }
  return null;
}

/**
 * `POST /contracts/{id}/children` (SPEC-09 FR-4..FR-8). Error order = PLAN-09 P-10: 404 → child-type → 403 (write code of the
 * child type) → lines-locked → template-type → parent-not-issued → quote-expired → nothing-to-pay → validation `lines` →
 * missing-fields → child-exists (live-child UNIQUE, caught at the batch).
 */
export async function createChild(db: Db, ctx: CommandCtx, parentId: string, input: CreateChildInput): Promise<CreateChildResult> {
  const type: DocType = input.type;
  const values: Record<string, unknown> = { ...(input.values ?? {}) };

  const parent = await getChildParent(db, parentId);
  if (parent === null) return { kind: "not-found", what: "contract" };
  if (!CHILD_OF[parent.type].includes(type)) return { kind: "child-type" };
  const permission = WRITE_PERM[type];
  if (!ctx.actor.permissions.includes(permission)) return { kind: "forbidden", permission };
  if (values.giam_gia !== undefined) return { kind: "lines-locked" };

  let templateId: string;
  if (input.template_id !== undefined) {
    const head = await getTemplateHead(db, input.template_id);
    if (head === null) return { kind: "not-found", what: "template" };
    if (head.type !== type) return { kind: "template-type" };
    templateId = head.id;
  } else {
    const seed = await seedTemplateIdOf(db, type);
    if (seed === null) return { kind: "not-found", what: "template" };
    templateId = seed;
  }

  const today = todayInVN(ctx.now);
  const blocked = parentBlock(parent, today);
  if (blocked !== null) return blocked;

  const [versionRow, customerRow, creator] = await Promise.all([
    getCurrentVersion(db, templateId),
    getCustomer(db, parent.customerId),
    findUserById(db, ctx.actor.id),
  ]);
  if (versionRow === null) return { kind: "not-found", what: "template" };
  if (customerRow === null) return { kind: "not-found", what: "customer" };
  const customer: CustomerInput = {
    id: customerRow.id,
    name: customerRow.name,
    contact_person: customerRow.contact_person,
    phone: customerRow.phone,
    email: customerRow.email,
    tax_code: customerRow.tax_code,
    address: customerRow.address,
  };

  const built = buildChildSnapshot({
    parent: { id: parent.id, type: parent.type, number: parent.number, doc_date: parent.docDate, snapshot: parent.snapshot as unknown as Snapshot },
    childType: type,
    version: decodeVersion(versionRow),
    customer,
    values,
    docDate: today,
    ...(creator?.displayName ? { creatorName: creator.displayName } : {}),
  });
  if (!built.ok) {
    switch (built.kind) {
      case "child-type":
      case "lines-locked":
      case "nothing-to-pay":
        return { kind: built.kind };
      case "missing-fields":
        return { kind: "missing-fields", missing: built.missing };
      case "unresolved-placeholder":
        return { kind: "unresolved-placeholder", placeholders: built.placeholders };
      case "invalid":
        return { kind: "invalid", errors: built.errors };
    }
  }

  const snapshot = built.snapshot;
  const snapshotJson = JSON.stringify(snapshot);
  if (new TextEncoder().encode(snapshotJson).byteLength > MAX_SNAPSHOT_BYTES) {
    return { kind: "invalid", errors: [{ path: "snapshot", message: "Snapshot không được vượt quá 256 KB." }] };
  }

  const now = Math.floor(ctx.now.getTime() / 1000);
  const id = generateUlid();
  const written = await createChildCas(db, {
    row: {
      id,
      type,
      parentId: parent.id,
      parentType: parent.type,
      templateId: snapshot.template.id,
      templateVersionId: snapshot.template.version_id,
      customerId: snapshot.customer.id,
      createdBy: ctx.actor.id,
      docDate: snapshot.dates.doc_date,
      snapshot: snapshotJson,
      snapshotHash: snapshotHash(snapshot),
      customerName: snapshot.customer.name,
      total: snapshot.total,
      now,
    },
    today,
    audit: {
      actor: ctx.actor.id,
      ip: ctx.ip,
      ts: now,
      metadata: { to: "draft", type, parent_id: parent.id, parent_number: parent.number },
    },
  });

  if (written.kind === "child-exists") return { kind: "child-exists", existingId: written.existingId };
  if (written.kind === "lost") {
    // the parent moved between the diagnosis and the batch (voided, or the BG's day ended)
    const after = await getChildParent(db, parentId);
    if (after === null) return { kind: "not-found", what: "contract" };
    return parentBlock(after, today) ?? { kind: "parent-not-issued", current: after.status };
  }

  const contract = await contractDetail(db, ctx.actor, id, ctx.now);
  if (contract === null) throw new Error(`createChild: child ${id} missing right after its batch`);
  emitContractEvent({ name: "contract.created", contract });
  return { kind: "ok", contract };
}
