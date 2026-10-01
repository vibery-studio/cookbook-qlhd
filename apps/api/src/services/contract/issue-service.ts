/**
 * Issue (SPEC-03 FR-6, §3.3 "Rung B"). Every check lives in the CAS WHERE; a 0-row result is diagnosed afterwards.
 * After the win the paper is rendered + stored once via `renderContract` (C-03-004: deterministic from snapshot +
 * number, `saveRenderedOnce` CAS). A render failure is logged and left to `GET /render` to rebuild — it never
 * un-issues. The event fires after commit.
 */
import { diagnoseIssue, issueCas } from "../../dao/contract-issue-dao";
import type { Db } from "../../db/client";
import { seriesYear } from "../../domain/contract/dates";
import type { ContractDto } from "../../dto/contracts";
import { emitContractEvent } from "../../events/contract-events";
import { deepScrub } from "../../observability/logger";
import { generateUlid } from "../../utils/id";
import { todayInVN } from "../../utils/vn-date";
import { contractDetail } from "./read-service";
import { renderContract } from "./render-service";
import type { CommandCtx } from "./types";

export type IssueResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string }
  | { kind: "changed-after-approval" }
  | { kind: "parent-not-issued" }
  | { kind: "quote-expired" };

/** UNIQUE(type, series_year, seq) backstop: a violation rolled the batch back → retry with a fresh token. */
const MAX_ATTEMPTS = 5;

export async function issueContract(db: Db, ctx: CommandCtx, id: string): Promise<IssueResult> {
  const year = seriesYear(ctx.now);
  const today = todayInVN(ctx.now); // P-6: the BG deadline is the JS business day, bound into the CAS
  let won = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !won; attempt++) {
    const r = await issueCas(db, { id, actor: ctx.actor.id, ip: ctx.ip, token: generateUlid(), year, today, now: ctx.now });
    if (r.kind === "lost") return diagnoseIssue(db, id, today);
    won = r.kind === "won";
  }
  if (!won) throw new Error(`issueContract: number series still colliding after ${MAX_ATTEMPTS} attempts (${id})`);

  try {
    await renderContract(db, id);
  } catch (err) {
    console.error(
      JSON.stringify(
        deepScrub({
          ts: Date.now(),
          kind: "contract.render.store_failed",
          id,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }

  const contract = await contractDetail(db, ctx.actor, id);
  if (contract === null) throw new Error(`issueContract: contract ${id} vanished after issue`);
  emitContractEvent({ name: "contract.issued", contract });
  return { kind: "ok", contract };
}
