import type { Db } from "../../db/client";
import type { ContractDto, UpdateContractInput } from "../../dto/contracts";
import type { Snapshot } from "../../domain/contract/types";
import { splitInputs } from "./snapshot-builder";
import { writeAuditEvent } from "../../dao/audit-dao";
import { getContractForWrite, updateDraftCas } from "../../dao/contract-write-dao";
import { loadAndBuild } from "./snapshot-builder";
import type { BuildFailure, CommandCtx } from "./types";

export type UpdateResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "forbidden" } // caller is not the creator
  | { kind: "state-conflict"; current: string }
  | { kind: "stale" }
  | BuildFailure;

export async function updateContract(
  db: Db,
  ctx: CommandCtx,
  id: string,
  input: UpdateContractInput,
): Promise<UpdateResult> {
  const current = await getContractForWrite(db, id);
  if (current === null) return { kind: "not-found" };
  if (current.created_by !== ctx.actor.id) {
    await writeAuditEvent(db, {
      actor: ctx.actor.id,
      action: "permission.denied",
      target: `contract:${id}`,
      metadata: { rule: "creator_only", permission: "contract:write" },
      ip: ctx.ip,
    });
    return { kind: "forbidden" };
  }
  if (current.status !== "draft") return { kind: "state-conflict", current: current.status };

  const previous = current.snapshot as unknown as Snapshot;
  const kept = splitInputs(previous);
  const values = {
    ...kept.values,
    ...(input.values === undefined ? {} : { ...input.values }),
  };
  const suppliedStart = input.values !== undefined && Object.prototype.hasOwnProperty.call(input.values, "ngay_bat_dau");
  const previousStartWasManual = previous.dates.start !== previous.dates.doc_date;
  const built = await loadAndBuild(db, {
    ...(input.use_latest_template === true
      ? { templateId: current.template_id }
      : { templateVersionId: current.template_version_id }),
    customerId: input.customer_id ?? current.customer_id,
    lines: input.lines ?? kept.lines,
    values,
    now: ctx.now,
    manualStart: suppliedStart || previousStartWasManual,
  });
  if (built.kind === "not-found") return { kind: "not-found" };
  if (built.kind !== "ok") return built;

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
      templateId: built.built.snapshot.template.id,
      templateVersionId: built.built.snapshot.template.version_id,
      customerId: built.built.snapshot.customer.id,
      docDate: built.built.snapshot.dates.doc_date,
      snapshot: built.built.snapshotJson,
      snapshotHash: built.built.snapshotHash,
      customerName: built.built.snapshot.customer.name,
      total: built.built.snapshot.total,
      now,
    },
  });
  if (updated !== null) return { kind: "ok", contract: updated };

  const after = await getContractForWrite(db, id);
  if (after === null) return { kind: "not-found" };
  if (after.created_by !== ctx.actor.id) return { kind: "forbidden" };
  if (after.status !== "draft") return { kind: "state-conflict", current: after.status };
  return { kind: "stale" };
}
