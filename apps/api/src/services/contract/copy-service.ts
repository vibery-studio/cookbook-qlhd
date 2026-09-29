import type { Db } from "../../db/client";
import type { ContractDto } from "../../dto/contracts";
import type { Snapshot } from "../../domain/contract/types";
import { emitContractEvent } from "../../events/contract-events";
import { generateUlid } from "../../utils/id";
import { getContractForWrite, insertCopy } from "../../dao/contract-write-dao";
import { loadAndBuild } from "./snapshot-builder";
import type { BuildFailure, CommandCtx } from "./types";

export type CopyResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string } // source not rejected/voided, or voided already replaced
  | BuildFailure;

export async function copyContract(db: Db, ctx: CommandCtx, id: string): Promise<CopyResult> {
  const source = await getContractForWrite(db, id);
  if (source === null) return { kind: "not-found" };
  if (source.status !== "rejected" && source.status !== "voided") {
    return { kind: "state-conflict", current: source.status };
  }
  if (source.status === "voided" && source.replaced_by_id !== null) {
    return { kind: "state-conflict", current: source.status };
  }

  const snapshot = source.snapshot as unknown as Snapshot;
  const built = await loadAndBuild(db, {
    templateId: source.template_id,
    customerId: source.customer_id,
    values: { ...snapshot.inputs },
    now: ctx.now,
    manualStart: snapshot.dates.start !== snapshot.dates.doc_date,
  });
  if (built.kind === "not-found") return { kind: "not-found" };
  if (built.kind !== "ok") return built;

  const now = Math.floor(ctx.now.getTime() / 1000);
  const newId = generateUlid();
  const written = await insertCopy(db, {
    row: {
      id: newId,
      templateId: built.built.snapshot.template.id,
      templateVersionId: built.built.snapshot.template.version_id,
      customerId: built.built.snapshot.customer.id,
      sourceContractId: source.id,
      createdBy: ctx.actor.id,
      docDate: built.built.snapshot.dates.doc_date,
      snapshot: built.built.snapshotJson,
      snapshotHash: built.built.snapshotHash,
      customerName: built.built.snapshot.customer.name,
      total: built.built.snapshot.total,
      now,
    },
    sourceId: source.id,
    sourceVoided: source.status === "voided",
    audit: {
      actor: ctx.actor.id,
      ip: ctx.ip,
      ts: now,
      metadata: { to: "draft", source_id: source.id },
    },
  });
  if (written.kind === "source-conflict") {
    const after = await getContractForWrite(db, id);
    return { kind: "state-conflict", current: after?.status ?? source.status };
  }
  emitContractEvent({ name: "contract.created", contract: written.contract });
  return { kind: "ok", contract: written.contract };
}
