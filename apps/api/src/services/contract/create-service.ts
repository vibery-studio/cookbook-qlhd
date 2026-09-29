import { generateUlid } from "../../utils/id";
import type { Db } from "../../db/client";
import type { ContractDto, CreateContractInput } from "../../dto/contracts";
import { emitContractEvent } from "../../events/contract-events";
import { insertContract } from "../../dao/contract-write-dao";
import { loadAndBuild } from "./snapshot-builder";
import type { BuildFailure, CommandCtx } from "./types";

export type CreateResult =
  | { kind: "ok"; contract: ContractDto }
  | BuildFailure
  | { kind: "not-found"; what: "customer" | "template" };

export async function createContract(db: Db, ctx: CommandCtx, input: CreateContractInput): Promise<CreateResult> {
  const built = await loadAndBuild(db, {
    templateId: input.template_id,
    customerId: input.customer_id,
    values: { ...input.values },
    now: ctx.now,
    manualStart: Object.prototype.hasOwnProperty.call(input.values, "ngay_bat_dau"),
  });
  if (built.kind !== "ok") return built;

  const now = Math.floor(ctx.now.getTime() / 1000);
  const id = generateUlid();
  const contract = await insertContract(
    db,
    {
      id,
      templateId: built.built.snapshot.template.id,
      templateVersionId: built.built.snapshot.template.version_id,
      customerId: built.built.snapshot.customer.id,
      sourceContractId: null,
      createdBy: ctx.actor.id,
      docDate: built.built.snapshot.dates.doc_date,
      snapshot: built.built.snapshotJson,
      snapshotHash: built.built.snapshotHash,
      customerName: built.built.snapshot.customer.name,
      total: built.built.snapshot.total,
      now,
    },
    { actor: ctx.actor.id, ip: ctx.ip, ts: now, metadata: { to: "draft" } },
  );
  emitContractEvent({ name: "contract.created", contract });
  return { kind: "ok", contract };
}
