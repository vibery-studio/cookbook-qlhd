/**
 * Delete-draft DAO (SPEC-04b §3.2 E, §5 hard delete). Pure `(db, input)`. One batch; every statement is guarded by
 * "this contract is still a draft of this creator" so a concurrent submit (which makes it `pending` with steps)
 * turns the whole batch into a no-op. The audit row carries the id only — never customer data.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { approvalSteps, auditEvents, contracts } from "../db/schema";
import { generateUlid } from "../utils/id";

export async function deleteDraft(db: Db, input: { id: string; actor: string; ip: string | null; now: Date }): Promise<boolean> {
  const now = Math.floor(input.now.getTime() / 1000);
  const stillMine = sql`EXISTS (SELECT 1 FROM contracts d WHERE d.id = ${input.id} AND d.status = 'draft' AND d.created_by = ${input.actor})`;
  const [, , , deleted] = await db.batch([
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${generateUlid()}`.as("id"),
          ts: sql<number>`${now}`.as("ts"),
          actor: sql<string>`${input.actor}`.as("actor"),
          action: sql<string>`${"contract.deleted"}`.as("action"),
          target: sql<string>`${`contract:${input.id}`}`.as("target"),
          metadata: sql<string>`json_object('id', ${contracts.id}, 'type', ${contracts.type})`.as("metadata"),
          ip: sql<string | null>`${input.ip}`.as("ip"),
        })
        .from(contracts)
        .where(and(eq(contracts.id, input.id), eq(contracts.status, "draft"), eq(contracts.createdBy, input.actor))),
    ),
    db
      .update(contracts)
      .set({ replacedById: null })
      .where(and(eq(contracts.replacedById, input.id), stillMine)),
    db.delete(approvalSteps).where(and(eq(approvalSteps.contractId, input.id), stillMine)),
    db
      .delete(contracts)
      .where(and(eq(contracts.id, input.id), eq(contracts.status, "draft"), eq(contracts.createdBy, input.actor)))
      .returning({ id: contracts.id }),
  ]);
  return deleted.length > 0;
}
