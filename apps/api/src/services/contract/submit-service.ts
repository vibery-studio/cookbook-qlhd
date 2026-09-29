/**
 * Submit a draft for approval (SPEC-03 FR-4, §3.3 "gửi duyệt", I9). Creator only; the steps come from the policy
 * pinned on the snapshot; a distinct eligible approver must exist for EVERY step (never the creator, one person per
 * step) or nothing is written.
 */
import { listCandidates, getDecisionState, submitCas } from "../../dao/approval-dao";
import { writeAuditEvent } from "../../dao/audit-dao";
import type { Db } from "../../db/client";
import { eligibleAssignment } from "../../domain/contract/assignment";
import { requiredSteps } from "../../domain/contract/policy";
import type { Snapshot } from "../../domain/contract/types";
import type { ContractDto } from "../../dto/contracts";
import { emitContractEvent } from "../../events/contract-events";
import { contractDetail } from "./read-service";
import type { CommandCtx } from "./types";

export type SubmitResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "forbidden" } // caller is not the creator
  | { kind: "state-conflict"; current: string }
  | { kind: "no-eligible-approver"; step: { step_no: number; label: string } };

/** A concurrent draft edit between our read and our CAS → recompute from the new snapshot (bounded). */
const MAX_ATTEMPTS = 3;

/** Policy variables (SPEC-03 §3.2): the largest line discount + the total. Unknown → undefined → fail-closed step. */
function policyVars(s: Snapshot): Record<string, number | undefined> {
  const bps = s.lines.map((l) => l.discount_bps).filter((n) => Number.isFinite(n));
  return { discount_bps: bps.length > 0 ? Math.max(...bps) : undefined, total: s.total };
}

export async function submitContract(db: Db, ctx: CommandCtx, id: string): Promise<SubmitResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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
    if (state.status !== "draft") return { kind: "state-conflict", current: state.status };

    const snapshot = JSON.parse(state.snapshot) as Snapshot;
    const steps = requiredSteps(snapshot.policy, policyVars(snapshot));
    // SPEC-03 FR-4: always ≥ 1 step; a pinned policy yielding none is a broken template, not "no approval needed".
    if (steps.length === 0) throw new Error(`submitContract: pinned policy yields no approval step (contract ${id})`);

    const candidates = await listCandidates(db);
    const assignment = eligibleAssignment(steps, candidates, new Set([state.createdBy]));
    if (!assignment.ok) {
      return { kind: "no-eligible-approver", step: { step_no: assignment.step.step_no, label: assignment.step.label } };
    }

    const moved = await submitCas(db, {
      id,
      actor: ctx.actor.id,
      ip: ctx.ip,
      expectedVersion: state.version,
      expectedHash: state.snapshotHash,
      steps,
      now: ctx.now,
    });
    if (moved) {
      const contract = await contractDetail(db, ctx.actor, id);
      if (contract === null) throw new Error(`submitContract: contract ${id} vanished after submit`);
      emitContractEvent({ name: "contract.submitted", contract });
      return { kind: "ok", contract };
    }
    // CAS missed: re-read decides (submitted by a parallel request → 409; edited meanwhile → recompute).
  }
  const last = await getDecisionState(db, id);
  if (last === null) return { kind: "not-found" };
  return { kind: "state-conflict", current: last.status };
}
