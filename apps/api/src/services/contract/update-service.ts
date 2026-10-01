import type { Db } from "../../db/client";
import type { ContractDto, UpdateContractInput } from "../../dto/contracts";
import { WRITE_PERM } from "../../domain/contract/doc-types";
import type { Snapshot } from "../../domain/contract/types";
import { writeAuditEvent } from "../../dao/audit-dao";
import { getContractForWrite, templateTypeOf, updateDraftCas } from "../../dao/contract-write-dao";
import { loadAndBuild, loadAndBuildChild, splitInputs, type LoadAndBuildChildResult } from "./snapshot-builder";
import type { BuildFailure, CommandCtx, DocTypeFailure, TypeForbidden } from "./types";

export type UpdateResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | TypeForbidden // lacks WRITE_PERM[type] (DEC-10 B, P-3)
  | { kind: "not-creator" } // caller is not the creator
  | { kind: "state-conflict"; current: string }
  | { kind: "stale" }
  | DocTypeFailure
  | BuildFailure;

/**
 * Edit a draft (creator only, optimistic lock). Order: 404 → 403 write code of the type → 403 creator_only → 409 state →
 * child: 422 `lines-locked` (lines / giam_gia / another customer — they come from the parent, DEC-6) → 422 `template-type` → build.
 * A child is rebuilt from its parent's stored snapshot (frozen price), never re-priced.
 */
export async function updateContract(
  db: Db,
  ctx: CommandCtx,
  id: string,
  input: UpdateContractInput,
): Promise<UpdateResult> {
  const current = await getContractForWrite(db, id);
  if (current === null) return { kind: "not-found" };
  const permission = WRITE_PERM[current.type];
  if (!ctx.actor.permissions.includes(permission)) return { kind: "forbidden", permission };
  if (current.created_by !== ctx.actor.id) {
    await writeAuditEvent(db, {
      actor: ctx.actor.id,
      action: "permission.denied",
      target: `contract:${id}`,
      metadata: { rule: "creator_only", permission },
      ip: ctx.ip,
    });
    return { kind: "not-creator" };
  }
  if (current.status !== "draft") return { kind: "state-conflict", current: current.status };

  const previous = current.snapshot as unknown as Snapshot;
  const parentId = current.parent?.id ?? previous.parent?.id ?? null;
  if (
    parentId !== null &&
    (input.lines !== undefined ||
      (input.values !== undefined && Object.prototype.hasOwnProperty.call(input.values, "giam_gia")) ||
      (input.customer_id !== undefined && input.customer_id !== current.customer_id))
  ) {
    return { kind: "lines-locked" };
  }
  if (input.use_latest_template === true) {
    const templateType = await templateTypeOf(db, current.template_id);
    if (templateType !== null && templateType !== current.type) return { kind: "template-type" }; // unknown → 404 below
  }

  const kept = splitInputs(previous);
  const values = {
    ...kept.values,
    ...(input.values === undefined ? {} : { ...input.values }),
  };
  const suppliedStart = input.values !== undefined && Object.prototype.hasOwnProperty.call(input.values, "ngay_bat_dau");
  const previousStartWasManual = previous.dates.start !== undefined && previous.dates.start !== previous.dates.doc_date;
  const template =
    input.use_latest_template === true ? { templateId: current.template_id } : { templateVersionId: current.template_version_id };
  const manualStart = suppliedStart || previousStartWasManual;

  let built: LoadAndBuildChildResult;
  if (parentId !== null) {
    const parent = await getContractForWrite(db, parentId);
    if (parent === null) return { kind: "not-found" };
    built = await loadAndBuildChild(db, {
      parent: { id: parent.id, type: parent.type, number: parent.number, doc_date: parent.doc_date, snapshot: parent.snapshot as unknown as Snapshot },
      childType: current.type,
      ...template,
      customerId: current.customer_id,
      values,
      now: ctx.now,
      manualStart,
      creatorId: current.created_by,
    });
  } else {
    built = await loadAndBuild(db, {
      ...template,
      customerId: input.customer_id ?? current.customer_id,
      lines: input.lines ?? kept.lines,
      values,
      now: ctx.now,
      manualStart,
      type: current.type,
      creatorId: current.created_by,
    });
  }
  if (built.kind === "not-found") return { kind: "not-found" };
  if (built.kind !== "ok") return built;

  const snapshot = built.built.snapshot;
  const fieldNames = input.values === undefined ? [] : Object.keys(input.values);
  if (input.lines !== undefined) fieldNames.push("lines");
  if (input.customer_id !== undefined) fieldNames.push("customer_id");
  if (input.use_latest_template === true) fieldNames.push("template_version_id");
  const now = Math.floor(ctx.now.getTime() / 1000);
  const updated = await updateDraftCas(db, {
    id,
    expectedVersion: input.expected_version,
    actor: ctx.actor.id,
    ip: ctx.ip,
    fieldNames,
    patch: {
      validUntil: current.type === "quote" ? (snapshot.dates.valid_until ?? null) : null,
      templateId: snapshot.template.id,
      templateVersionId: snapshot.template.version_id,
      customerId: snapshot.customer.id,
      docDate: snapshot.dates.doc_date,
      snapshot: built.built.snapshotJson,
      snapshotHash: built.built.snapshotHash,
      customerName: snapshot.customer.name,
      total: snapshot.total,
      now,
    },
  });
  if (updated !== null) return { kind: "ok", contract: updated };

  const after = await getContractForWrite(db, id);
  if (after === null) return { kind: "not-found" };
  if (after.created_by !== ctx.actor.id) return { kind: "not-creator" };
  if (after.status !== "draft") return { kind: "state-conflict", current: after.status };
  return { kind: "stale" };
}
