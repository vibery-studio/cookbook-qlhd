/**
 * Approve / reject the CURRENT step (SPEC-03 FR-5, §3.3 "duyệt" / "từ chối", SoD, DEC-10).
 *
 * Check order: not found → contract not pending (409) → current step → actor lacks the step's permission/role (403)
 * → actor is the creator (403 `creator_cannot_approve`) → actor already decided another step (403
 * `one_person_one_step`) → approve only: after this decision the remaining steps would have no distinct eligible
 * approver (409 `would-block-later-step`, DEC-10) → CAS. SoD is a domain check for EVERY role (never
 * `requirePerm({ownerId})`); each refusal leaves a `permission.denied` row (target `contract:<id>`) before the 403.
 * `one_person_one_step` is ALSO inside the step CAS, so two parallel requests by one person cannot both win.
 */
import { decideCas, getDecisionState, listCandidates, type DecisionState, type DecisionStep } from "../../dao/approval-dao";
import { writeAuditEvent } from "../../dao/audit-dao";
import type { Db } from "../../db/client";
import { eligibleAssignment, isEligible } from "../../domain/contract/assignment";
import type { RequiredStep } from "../../domain/contract/types";
import type { ContractDto } from "../../dto/contracts";
import { emitContractEvent } from "../../events/contract-events";
import { contractDetail } from "./read-service";
import type { CommandCtx } from "./types";

export type DecideResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "forbidden-permission"; permission: string; label?: string } // missing step permission / role
  | { kind: "sod"; rule: "creator_cannot_approve" | "one_person_one_step" }
  | { kind: "would-block-later-step"; step: { step_no: number; label: string } }
  | { kind: "state-conflict"; current: string };

const toRequired = (s: DecisionStep): RequiredStep => ({
  step_no: s.stepNo,
  label: s.label,
  required_permission: s.requiredPermission,
  required_role: s.requiredRole,
});

async function denied(db: Db, ctx: CommandCtx, id: string, metadata: Record<string, unknown>): Promise<void> {
  // awaited BEFORE the 403 so the row exists when the client sees the response (PLAN-03 risk 4)
  await writeAuditEvent(db, {
    actor: ctx.actor.id,
    action: "permission.denied",
    target: `contract:${id}`,
    metadata,
    ip: ctx.ip,
  });
}

async function sod(
  db: Db,
  ctx: CommandCtx,
  id: string,
  rule: "creator_cannot_approve" | "one_person_one_step",
): Promise<DecideResult> {
  await denied(db, ctx, id, { rule, permission: "contract:approve" });
  return { kind: "sod", rule };
}

const currentStep = (state: DecisionState): DecisionStep | undefined => state.steps.find((s) => s.status === "waiting");

export async function decideContract(
  db: Db,
  ctx: CommandCtx,
  id: string,
  decision: { action: "approve" | "reject"; note?: string },
): Promise<DecideResult> {
  const actor = ctx.actor;
  const state = await getDecisionState(db, id);
  if (state === null) return { kind: "not-found" };
  if (state.status !== "pending") return { kind: "state-conflict", current: state.status };
  const step = currentStep(state);
  if (step === undefined) return { kind: "state-conflict", current: state.status };

  // the step's permission + role, checked on the caller's live principal (creator is checked separately below)
  const required = toRequired(step);
  if (!isEligible(required, { id: actor.id, roles: actor.roles, permissions: actor.permissions }, new Set())) {
    await denied(db, ctx, id, {
      permission: step.requiredPermission,
      ...(step.requiredRole !== null ? { role: step.requiredRole } : {}),
      step_no: step.stepNo,
    });
    return { kind: "forbidden-permission", permission: step.requiredPermission, label: step.label };
  }
  if (actor.id === state.createdBy) return sod(db, ctx, id, "creator_cannot_approve");
  if (state.steps.some((s) => s.decidedBy === actor.id)) return sod(db, ctx, id, "one_person_one_step");

  const waiting = state.steps.filter((s) => s.status === "waiting");
  const isLast = waiting.length === 1;

  if (decision.action === "approve" && !isLast) {
    // DEC-10: after this approval the remaining steps still need a distinct eligible person each, excluding the
    // creator, everyone who already decided, and the caller.
    const excluded = new Set<string>([state.createdBy, actor.id]);
    for (const s of state.steps) if (s.decidedBy !== null) excluded.add(s.decidedBy);
    const later = waiting.filter((s) => s.id !== step.id).map(toRequired);
    const fits = eligibleAssignment(later, await listCandidates(db), excluded);
    if (!fits.ok) return { kind: "would-block-later-step", step: { step_no: fits.step.step_no, label: fits.step.label } };
  }

  const approved = decision.action === "approve";
  const to = approved ? (isLast ? "approved" : "pending") : "rejected";
  const won = await decideCas(db, {
    contractId: id,
    stepId: step.id,
    stepNo: step.stepNo,
    label: step.label,
    actor: actor.id,
    ip: ctx.ip,
    decision: approved ? "approved" : "rejected",
    note: decision.note ?? null,
    to,
    now: ctx.now,
  });

  if (!won) {
    // Someone else decided first (or this person, in a parallel request). Re-read to say which.
    const after = await getDecisionState(db, id);
    if (after === null) return { kind: "not-found" };
    if (after.status !== "pending") return { kind: "state-conflict", current: after.status };
    if (after.steps.some((s) => s.decidedBy === actor.id)) return sod(db, ctx, id, "one_person_one_step");
    return { kind: "state-conflict", current: after.status };
  }

  const contract = await contractDetail(db, actor, id);
  if (contract === null) throw new Error(`decideContract: contract ${id} vanished after decision`);
  emitContractEvent({ name: approved ? "contract.approved" : "contract.rejected", contract });
  return { kind: "ok", contract };
}
