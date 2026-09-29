/** Delete a draft (SPEC-04b §3.2 E): creator only, hard delete, id-only audit row. */
import { getDecisionState } from "../../dao/approval-dao";
import { writeAuditEvent } from "../../dao/audit-dao";
import { deleteDraft } from "../../dao/contract-delete-dao";
import { contractStatus } from "../../dao/contract-issue-dao";
import type { Db } from "../../db/client";
import type { CommandCtx } from "./types";

export type DeleteResult =
  | { kind: "ok" }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "state-conflict"; current: string };

export async function deleteContract(db: Db, ctx: CommandCtx, id: string): Promise<DeleteResult> {
  const state = await getDecisionState(db, id);
  if (state === null) return { kind: "not-found" };
  if (state.createdBy !== ctx.actor.id) {
    await writeAuditEvent(db, {
      actor: ctx.actor.id,
      action: "permission.denied",
      target: `contract:${id}`,
      metadata: { rule: "creator_only", permission: "contract:write" },
      ip: ctx.ip,
    });
    return { kind: "forbidden" };
  }
  if (await deleteDraft(db, { id, actor: ctx.actor.id, ip: ctx.ip, now: ctx.now })) return { kind: "ok" };
  const current = await contractStatus(db, id);
  return current === null ? { kind: "not-found" } : { kind: "state-conflict", current };
}
