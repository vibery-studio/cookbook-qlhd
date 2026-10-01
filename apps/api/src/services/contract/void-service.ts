/**
 * Void (SPEC-03 FR-7, §3.3 "hủy"): issued→voided with a non-empty reason; the number and the stored paper stay.
 * CAS + audit in one batch; the event fires after commit. SPEC-09 FR-9: a parent with a live child → `has-children`
 * naming those children (read after the CAS missed; the guard itself lives in the CAS).
 */
import { contractStatus, voidCas } from "../../dao/contract-issue-dao";
import { childrenOf } from "../../dao/contract-read-dao";
import type { Db } from "../../db/client";
import { isLiveStatus } from "../../domain/contract/doc-types";
import type { ContractDto, ContractRefDto } from "../../dto/contracts";
import { emitContractEvent } from "../../events/contract-events";
import { contractDetail } from "./read-service";
import type { CommandCtx } from "./types";

export type VoidResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string }
  | { kind: "has-children"; children: ContractRefDto[] };

export async function voidContract(db: Db, ctx: CommandCtx, id: string, reason: string): Promise<VoidResult> {
  const trimmed = reason.trim();
  // the route schema (VoidBody: trimmedNonEmpty) already answers 422; this guards direct callers
  if (trimmed === "") throw new Error("voidContract: reason must not be empty");

  const won = await voidCas(db, { id, actor: ctx.actor.id, ip: ctx.ip, reason: trimmed, now: ctx.now });
  if (!won) {
    const current = await contractStatus(db, id);
    if (current === null) return { kind: "not-found" };
    if (current === "issued") {
      const live = (await childrenOf(db, id)).filter((r) => isLiveStatus(r.status));
      if (live.length > 0) {
        return {
          kind: "has-children",
          children: live.map((r) => ({ id: r.id, type: r.type, number: r.number, status: r.status, total: r.total, doc_date: r.docDate })),
        };
      }
    }
    return { kind: "state-conflict", current };
  }

  const contract = await contractDetail(db, ctx.actor, id);
  if (contract === null) throw new Error(`voidContract: contract ${id} vanished after void`);
  emitContractEvent({ name: "contract.voided", contract });
  return { kind: "ok", contract };
}
