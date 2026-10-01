/** Delete a draft (SPEC-04b §3.2 E): write code of the type (DEC-10 B, P-3), creator only, hard delete, id-only audit row. */
import { writeAuditEvent } from "../../dao/audit-dao";
import { deleteDraft } from "../../dao/contract-delete-dao";
import { contractStatus } from "../../dao/contract-issue-dao";
import { getContractForWrite } from "../../dao/contract-write-dao";
import type { Db } from "../../db/client";
import { WRITE_PERM } from "../../domain/contract/doc-types";
import type { CommandCtx, TypeForbidden } from "./types";

export type DeleteResult =
  | { kind: "ok" }
  | { kind: "not-found" }
  | TypeForbidden
  | { kind: "not-creator" }
  | { kind: "state-conflict"; current: string };

export async function deleteContract(db: Db, ctx: CommandCtx, id: string): Promise<DeleteResult> {
  const doc = await getContractForWrite(db, id);
  if (doc === null) return { kind: "not-found" };
  const permission = WRITE_PERM[doc.type];
  if (!ctx.actor.permissions.includes(permission)) return { kind: "forbidden", permission };
  if (doc.created_by !== ctx.actor.id) {
    await writeAuditEvent(db, {
      actor: ctx.actor.id,
      action: "permission.denied",
      target: `contract:${id}`,
      metadata: { rule: "creator_only", permission },
      ip: ctx.ip,
    });
    return { kind: "not-creator" };
  }
  if (await deleteDraft(db, { id, actor: ctx.actor.id, ip: ctx.ip, now: ctx.now })) return { kind: "ok" };
  const current = await contractStatus(db, id);
  return current === null ? { kind: "not-found" } : { kind: "state-conflict", current };
}
