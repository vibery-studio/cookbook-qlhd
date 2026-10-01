/**
 * FIX-06 — the ONE copy of "may this caller do X to this document, and if not why" (SPEC-03/04b/09). Pure. The write services
 * (decide, update, delete, copy, submit, withdraw) refuse with these, and `GET /contracts/{id}` turns the same answers into
 * `can` + `can.reason` so the web only words a code. Order = the order of each service's checks.
 * State races stay with the CAS of each write (e.g. `one_person_one_step` inside the step CAS).
 */
import { isEligible } from "./assignment";
import { DOC_TYPES, WRITE_PERM, type DocType } from "./doc-types";

export type ContractLock =
  | "no_write_permission"
  | "no_issue_permission"
  | "not_creator"
  | "not_draft"
  | "not_pending"
  | "not_approved"
  | "not_issued"
  | "step_role"
  | "creator_cannot_approve"
  | "one_person_one_step"
  | "step_decided"
  | "replaced"
  | "not_copyable";

export interface LockStep {
  stepNo: number;
  status: string;
  decidedBy: string | null;
  label: string;
  requiredPermission: string;
  requiredRole: string | null;
}

export interface LockDoc {
  type: DocType;
  status: string;
  createdBy: string;
  replacedById: string | null;
  steps: readonly LockStep[];
}

export interface LockActor {
  id: string;
  roles: readonly string[];
  permissions: readonly string[];
}

/** The step being decided now: the lowest-numbered waiting one. */
export function currentStep<S extends { stepNo: number; status: string }>(steps: readonly S[]): S | undefined {
  return [...steps].filter((s) => s.status === "waiting").sort((a, b) => a.stepNo - b.stepNo)[0];
}

/** Approve / reject (decide-service): not pending → step permission/role → creator → one person one step. */
export function decideLock(doc: LockDoc, actor: LockActor): ContractLock | null {
  if (doc.status !== "pending") return "not_pending";
  const step = currentStep(doc.steps);
  if (step === undefined) return "not_pending";
  const required = { step_no: step.stepNo, label: step.label, required_permission: step.requiredPermission, required_role: step.requiredRole };
  if (!isEligible(required, actor, new Set())) return "step_role";
  if (actor.id === doc.createdBy) return "creator_cannot_approve";
  if (doc.steps.some((s) => s.decidedBy === actor.id)) return "one_person_one_step";
  return null;
}

/** Edit / delete a draft (update-service, delete-service): type write permission → creator → draft. */
export function draftWriteLock(doc: LockDoc, actor: LockActor): ContractLock | null {
  if (!actor.permissions.includes(WRITE_PERM[doc.type])) return "no_write_permission";
  if (doc.createdBy !== actor.id) return "not_creator";
  return doc.status === "draft" ? null : "not_draft";
}

/** Submit (submit-service): creator → draft. */
export function submitLock(doc: LockDoc, actor: LockActor): ContractLock | null {
  if (doc.createdBy !== actor.id) return "not_creator";
  return doc.status === "draft" ? null : "not_draft";
}

/** Withdraw (withdraw-service; the state part is its CAS): creator → pending → nobody decided a step. */
export function withdrawLock(doc: LockDoc, actor: LockActor): ContractLock | null {
  if (doc.createdBy !== actor.id) return "not_creator";
  if (doc.status !== "pending") return "not_pending";
  return doc.steps.every((s) => s.decidedBy === null) ? null : "step_decided";
}

/** Issue / void (route gate `contract:issue`, then the status CAS). */
export function issueLock(doc: LockDoc, actor: LockActor, action: "issue" | "void"): ContractLock | null {
  if (!actor.permissions.includes("contract:issue")) return "no_issue_permission";
  if (action === "issue") return doc.status === "approved" ? null : "not_approved";
  return doc.status === "issued" ? null : "not_issued";
}

/** Copy (copy-service): type write permission → rejected, or voided without a replacement. */
export function copyLock(doc: LockDoc, actor: LockActor): ContractLock | null {
  if (!actor.permissions.includes(WRITE_PERM[doc.type])) return "no_write_permission";
  if (doc.status === "rejected") return null;
  if (doc.status === "voided") return doc.replacedById === null ? null : "replaced";
  return "not_copyable";
}

export type ActionKey = "edit" | "submit" | "approve" | "reject" | "issue" | "void" | "copy" | "withdraw" | "delete";

/** Every action's lock for one caller (null = allowed). */
export function actionLocks(doc: LockDoc, actor: LockActor): Record<ActionKey, ContractLock | null> {
  const decide = decideLock(doc, actor);
  const draft = draftWriteLock(doc, actor);
  return {
    edit: draft,
    submit: submitLock(doc, actor),
    approve: decide,
    reject: decide,
    issue: issueLock(doc, actor, "issue"),
    void: issueLock(doc, actor, "void"),
    copy: copyLock(doc, actor),
    withdraw: withdrawLock(doc, actor),
    delete: draft,
  };
}

/** Create a standalone document of `type` (create-service): type write permission → a DNTT needs a parent (made from a HĐ). */
export function createLock(type: DocType, permissions: readonly string[]): "no_write_permission" | "parent_required" | null {
  if (!permissions.includes(WRITE_PERM[type])) return "no_write_permission";
  return type === "payment_request" ? "parent_required" : null;
}

/** The types "+ Tạo" may offer this caller — exactly the ones `POST /contracts` would accept. */
export function creatableTypes(permissions: readonly string[]): DocType[] {
  return DOC_TYPES.filter((t) => createLock(t, permissions) === null);
}
