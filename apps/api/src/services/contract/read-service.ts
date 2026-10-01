import { listAudit, type AuditEventDto } from "../../dao/audit-dao";
import {
  countByStatus,
  getContractDetail,
  listApprovalQueue,
  listContracts as listContractsDao,
  type ContractDetailRow,
} from "../../dao/contract-read-dao";
import { listLifecycleEvents, type LifecycleEvent } from "../../dao/contract-withdraw-dao";
import type { Db } from "../../db/client";
import type { ApprovalQueueDto, ContractDto, ContractListDto } from "../../dto/contracts";
import { CONTRACT_ACTIONS, type RequiredStep } from "../../domain/contract/types";
import { isEligible } from "../../domain/contract/assignment";
import type { Principal } from "../../openapi";
import { pdfStatusOf } from "../../domain/contract/pdf";
import type { ValidationErrors } from "./types";

export type ListResult = ({ kind: "ok" } & ContractListDto) | { kind: "invalid"; errors: ValidationErrors };
export type QueueResult = ({ kind: "ok" } & ApprovalQueueDto) | { kind: "invalid"; errors: ValidationErrors };
export type AuditPage =
  | { kind: "ok"; items: AuditEventDto[]; next_cursor: string | null }
  | { kind: "invalid"; errors: ValidationErrors };

const BAD_CURSOR: ValidationErrors = [{ path: "cursor", message: "Invalid cursor" }];

function encodeCursor(n: number, id: string): string {
  return btoa(`${n}:${id}`);
}

function decodeCursor(raw: string): { n: number; id: string } | null {
  try {
    const s = atob(raw);
    const i = s.indexOf(":");
    if (i < 1) return null;
    const n = Number(s.slice(0, i));
    const id = s.slice(i + 1);
    return Number.isInteger(n) && id !== "" ? { n, id } : null;
  } catch {
    return null;
  }
}

export async function listContracts(
  db: Db,
  _actor: Principal,
  q: { status?: ContractDto["status"]; customer_id?: string; created_by?: string; template_id?: string; cursor?: string; limit: number },
): Promise<ListResult> {
  let after: { updatedAt: number; id: string } | undefined;
  if (q.cursor !== undefined) {
    const c = decodeCursor(q.cursor);
    if (c === null) return { kind: "invalid", errors: BAD_CURSOR };
    after = { updatedAt: c.n, id: c.id };
  }
  const filters = { customerId: q.customer_id, createdBy: q.created_by, templateId: q.template_id };
  const [rows, counts] = await Promise.all([
    listContractsDao(db, { ...filters, status: q.status, after, limit: q.limit }),
    countByStatus(db, filters),
  ]);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    kind: "ok",
    items: page.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      customer_name: r.customerName,
      template_name: r.templateName,
      total: r.total,
      created_by: r.createdBy,
      created_by_name: r.createdByName,
      updated_at: r.updatedAt,
    })),
    next_cursor: rows.length > q.limit && last !== undefined ? encodeCursor(last.updatedAt, last.id) : null,
    counts,
  };
}

function buildTimeline(d: ContractDetailRow, life: LifecycleEvent[]): ContractDto["timeline"] {
  const { contract: c, steps, names } = d;
  const who = (id: string | null) => (id === null ? null : (names.get(id) ?? id));
  const out: ContractDto["timeline"] = [
    { action: CONTRACT_ACTIONS.created, at: c.createdAt, actor: who(c.createdBy) },
  ];
  // submitted/withdrawn come from the audit log: withdraw resets `submitted_at`, the history stays
  const submits = life.filter((e) => e.action === CONTRACT_ACTIONS.submitted);
  if (submits.length === 0 && c.submittedAt !== null) {
    out.push({ action: CONTRACT_ACTIONS.submitted, at: c.submittedAt, actor: who(c.createdBy) });
  }
  for (const e of life) out.push({ action: e.action, at: e.at, actor: who(e.actor) });
  for (const s of steps) {
    if (s.decidedAt === null || s.status === "waiting") continue;
    out.push({
      action: s.status === "approved" ? CONTRACT_ACTIONS.approved : CONTRACT_ACTIONS.rejected,
      at: s.decidedAt,
      actor: who(s.decidedBy),
    });
  }
  if (c.issuedAt !== null) out.push({ action: CONTRACT_ACTIONS.issued, at: c.issuedAt, actor: who(c.issuedBy) });
  if (c.voidedAt !== null) out.push({ action: CONTRACT_ACTIONS.voided, at: c.voidedAt, actor: who(c.voidedBy) });
  return out.sort((a, b) => a.at - b.at);
}

function buildCan(d: ContractDetailRow, actor: Principal): ContractDto["can"] {
  const { contract: c, steps } = d;
  const isCreator = c.createdBy === actor.id;
  const has = (p: string) => actor.permissions.includes(p);
  const current = c.status === "pending" ? steps.find((s) => s.status === "waiting") : undefined;
  const lowestWaiting = current !== undefined && steps.every((s) => s.status !== "waiting" || s.stepNo >= current.stepNo);
  let canDecide = false;
  if (current !== undefined && lowestWaiting) {
    const excluded = new Set<string>([c.createdBy]);
    for (const s of steps) if (s.decidedBy !== null) excluded.add(s.decidedBy);
    const req: RequiredStep = {
      step_no: current.stepNo,
      label: current.label,
      required_permission: current.requiredPermission,
      required_role: current.requiredRole,
    };
    canDecide = isEligible(req, actor, excluded);
  }
  return {
    edit: isCreator && c.status === "draft",
    submit: isCreator && c.status === "draft",
    approve: canDecide,
    reject: canDecide,
    issue: has("contract:issue") && c.status === "approved",
    void: has("contract:issue") && c.status === "issued",
    withdraw: isCreator && c.status === "pending" && steps.every((s) => s.decidedBy === null),
    delete: isCreator && c.status === "draft",
    copy: has("contract:write") && (c.status === "rejected" || (c.status === "voided" && c.replacedById === null)),
  };
}

/** `null` → 404. `can` is computed for `actor`. */
export async function contractDetail(db: Db, actor: Principal, id: string): Promise<ContractDto | null> {
  const d = await getContractDetail(db, id);
  if (d === null) return null;
  const c = d.contract;
  const life = await listLifecycleEvents(db, id);
  return {
    id: c.id,
    type: c.type,
    status: c.status as ContractDto["status"],
    number: c.number,
    seq: c.seq,
    series_year: c.seriesYear,
    template_id: c.templateId,
    template_version_id: c.templateVersionId,
    customer_id: c.customerId,
    customer_name: c.customerName,
    total: c.total,
    created_by: c.createdBy,
    doc_date: c.docDate,
    version: c.version,
    snapshot: JSON.parse(c.snapshot) as Record<string, unknown>,
    snapshot_hash: c.snapshotHash,
    source_contract_id: c.sourceContractId,
    replaced_by_id: c.replacedById,
    submitted_at: c.submittedAt,
    decided_at: c.decidedAt,
    issued_by: c.issuedBy,
    issued_at: c.issuedAt,
    rendered_hash: c.renderedHash,
    voided_by: c.voidedBy,
    voided_at: c.voidedAt,
    void_reason: c.voidReason,
    pdf_status: pdfStatusOf(c),
    pdf_size: c.pdfSize,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    steps: d.steps.map((s) => ({
      id: s.id,
      step_no: s.stepNo,
      label: s.label,
      status: s.status as "waiting" | "approved" | "rejected",
      required_permission: s.requiredPermission,
      required_role: s.requiredRole,
      decided_by: s.decidedBy,
      decided_by_name: s.decidedBy === null ? null : (d.names.get(s.decidedBy) ?? null),
      decided_at: s.decidedAt,
      note: s.note,
      snapshot_hash_at_decision: s.snapshotHashAtDecision,
    })),
    timeline: buildTimeline(d, life),
    can: buildCan(d, actor),
  };
}

export async function approvalQueue(
  db: Db,
  actor: Principal,
  q: { cursor?: string; limit: number },
): Promise<QueueResult> {
  let after: { submittedAt: number; id: string } | undefined;
  if (q.cursor !== undefined) {
    const c = decodeCursor(q.cursor);
    if (c === null) return { kind: "invalid", errors: BAD_CURSOR };
    after = { submittedAt: c.n, id: c.id };
  }
  const rows = await listApprovalQueue(db, {
    actorId: actor.id,
    actorRoles: actor.roles,
    actorPermissions: actor.permissions,
    after,
    limit: q.limit,
  });
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    kind: "ok",
    items: page.map((r) => ({
      contract_id: r.contractId,
      step_no: r.stepNo,
      label: r.label,
      customer_name: r.customerName,
      total: r.total,
      created_by: r.createdBy,
      created_by_name: r.createdByName,
      submitted_at: r.submittedAt,
    })),
    next_cursor: rows.length > q.limit && last !== undefined ? encodeCursor(last.submittedAt ?? 0, last.contractId) : null,
  };
}

/** `null` → 404 (contract does not exist). */
export async function contractAudit(
  db: Db,
  id: string,
  q: { cursor?: string; limit: number },
): Promise<AuditPage | null> {
  const d = await getContractDetail(db, id);
  if (d === null) return null;
  const r = await listAudit(db, { target: `contract:${id}`, cursor: q.cursor, limit: q.limit });
  if (r.kind === "bad-cursor") return { kind: "invalid", errors: BAD_CURSOR };
  return { kind: "ok", items: r.items, next_cursor: r.nextCursor };
}
