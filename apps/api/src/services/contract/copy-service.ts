import type { Db } from "../../db/client";
import type { ContractDto } from "../../dto/contracts";
import { copyLock } from "../../domain/contract/action-locks";
import { WRITE_PERM } from "../../domain/contract/doc-types";
import type { Snapshot } from "../../domain/contract/types";
import { emitContractEvent } from "../../events/contract-events";
import { generateUlid } from "../../utils/id";
import { todayInVN } from "../../utils/vn-date";
import { getContractForWrite, insertCopy, liveChildOf, templateTypeOf } from "../../dao/contract-write-dao";
import { loadAndBuild, loadAndBuildChild, splitInputs, type LoadAndBuildChildResult } from "./snapshot-builder";
import type { BuildFailure, ChildCopyFailure, CommandCtx, DocTypeFailure, TypeForbidden } from "./types";

export type CopyResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | TypeForbidden
  | { kind: "state-conflict"; current: string } // source not rejected/voided, or voided already replaced
  | DocTypeFailure
  | ChildCopyFailure
  | BuildFailure;

/**
 * Copy a rejected / voided document into a new draft of the same type (current template). Standalone (HĐ, BG, PXK): today's
 * prices. A child (SPEC-09 FR-7): keeps `parent_id` + the parent's frozen money (`buildChildSnapshot`), and the INSERT is
 * guarded by the parent — still issued, a BG still in date (DEC-5 A) — and by the one-live-child UNIQUE (DEC-4).
 */
export async function copyContract(db: Db, ctx: CommandCtx, id: string): Promise<CopyResult> {
  const source = await getContractForWrite(db, id);
  if (source === null) return { kind: "not-found" };
  const permission = WRITE_PERM[source.type];
  // FIX-06: one copy of the rule (`copyLock`) — `GET /contracts/{id}` `can.reason.copy` shows the same answer.
  const lock = copyLock({ type: source.type, status: source.status, createdBy: source.created_by, replacedById: source.replaced_by_id, steps: [] }, ctx.actor);
  if (lock === "no_write_permission") return { kind: "forbidden", permission };
  if (lock !== null) return { kind: "state-conflict", current: source.status };
  const templateType = await templateTypeOf(db, source.template_id);
  if (templateType !== null && templateType !== source.type) return { kind: "template-type" }; // unknown → 404 below

  const snapshot = source.snapshot as unknown as Snapshot;
  const kept = splitInputs(snapshot);
  const manualStart = snapshot.dates.start !== undefined && snapshot.dates.start !== snapshot.dates.doc_date;
  const parentId = source.parent?.id ?? snapshot.parent?.id ?? null;
  const parent = parentId === null ? null : await getContractForWrite(db, parentId);
  if (parentId !== null && parent === null) return { kind: "not-found" };

  let built: LoadAndBuildChildResult;
  if (parent !== null) {
    built = await loadAndBuildChild(db, {
      parent: { id: parent.id, type: parent.type, number: parent.number, doc_date: parent.doc_date, snapshot: parent.snapshot as unknown as Snapshot },
      childType: source.type,
      templateId: source.template_id,
      customerId: source.customer_id,
      values: kept.values,
      now: ctx.now,
      manualStart,
      creatorId: ctx.actor.id,
    });
  } else {
    built = await loadAndBuild(db, {
      templateId: source.template_id,
      customerId: source.customer_id,
      lines: kept.lines,
      values: kept.values,
      now: ctx.now,
      manualStart,
      type: source.type,
      creatorId: ctx.actor.id,
    });
  }
  if (built.kind === "not-found") return { kind: "not-found" };
  if (built.kind !== "ok") return built;

  const today = todayInVN(ctx.now);
  const snap = built.built.snapshot;
  const now = Math.floor(ctx.now.getTime() / 1000);
  const newId = generateUlid();
  const written = await insertCopy(db, {
    row: {
      id: newId,
      type: source.type,
      validUntil: source.type === "quote" ? (snap.dates.valid_until ?? null) : null,
      parentId: parent?.id ?? null,
      templateId: snap.template.id,
      templateVersionId: snap.template.version_id,
      customerId: snap.customer.id,
      sourceContractId: source.id,
      createdBy: ctx.actor.id,
      docDate: snap.dates.doc_date,
      snapshot: built.built.snapshotJson,
      snapshotHash: built.built.snapshotHash,
      customerName: snap.customer.name,
      total: snap.total,
      now,
    },
    sourceId: source.id,
    sourceVoided: source.status === "voided",
    ...(parent === null ? {} : { parent: { id: parent.id, today } }),
    audit: {
      actor: ctx.actor.id,
      ip: ctx.ip,
      ts: now,
      metadata: {
        to: "draft",
        source_id: source.id,
        type: source.type,
        ...(parent === null ? {} : { parent_id: parent.id, parent_number: parent.number }),
      },
    },
  });
  switch (written.kind) {
    case "ok":
      emitContractEvent({ name: "contract.created", contract: written.contract });
      return { kind: "ok", contract: written.contract };
    case "source-conflict": {
      const after = await getContractForWrite(db, id);
      return { kind: "state-conflict", current: after?.status ?? source.status };
    }
    case "child-exists":
      return { kind: "child-exists", existingId: parent === null ? null : await liveChildOf(db, parent.id, source.type) };
    case "parent-guard": {
      // 0 rows: read the parent again to say why (P-10 order: parent-not-issued → quote-expired)
      const fresh = parent === null ? null : await getContractForWrite(db, parent.id);
      if (fresh === null || fresh.status !== "issued") return { kind: "parent-not-issued" };
      return { kind: "quote-expired" };
    }
  }
}
