/**
 * Withdraw (SPEC-04b §3.2 C): the creator pulls a `pending` contract back to `draft` while no step is decided.
 * CAS + audit + step cleanup in one batch (dao); the classification of a miss is read afterwards.
 */
import { getDecisionState } from "../../dao/approval-dao";
import { writeAuditEvent } from "../../dao/audit-dao";
import { diagnoseWithdraw, withdrawCas } from "../../dao/contract-withdraw-dao";
import type { Db } from "../../db/client";
import type { ContractDto } from "../../dto/contracts";
import { contractDetail } from "./read-service";
import type { CommandCtx } from "./types";

export type WithdrawResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "already-decided" }
  | { kind: "state-conflict"; current: string };

export async function withdrawContract(db: Db, ctx: CommandCtx, id: string): Promise<WithdrawResult> {
  const state = await getDecisionState(db, id);
  if (state === null) return { kind: "not-found" };
  if (state.createdBy !== ctx.actor.id) {
    await writeAuditEvent(db, {
      actor: ctx.actor.id,
      action: "permission.denied",
      target: `contract:${id}`,
      metadata: { rule: "creator_only", permission: "contract:submit" },
      ip: ctx.ip,
    });
    return { kind: "forbidden" };
  }
  const won = await withdrawCas(db, { id, actor: ctx.actor.id, ip: ctx.ip, now: ctx.now });
  if (!won) return diagnoseWithdraw(db, id);
  const contract = await contractDetail(db, ctx.actor, id);
  if (contract === null) throw new Error(`withdrawContract: contract ${id} vanished after withdraw`);
  return { kind: "ok", contract };
}
