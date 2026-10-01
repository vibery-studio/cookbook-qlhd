import type { Contract } from "./api";
import { DOC_TYPE_LABEL } from "./doc-type-labels";

export type FlowItem = {
  key: string;
  kind: "created" | "submitted" | "step" | "issued" | "voided";
  label: string;
  /** done = happened; waiting = a step nobody decided yet; rejected = a step that was refused. */
  state: "done" | "waiting" | "rejected";
  actor: string | null;
  at: number | null;
  note: string | null;
  /** The step the contract is waiting on right now (only while `pending`). */
  current: boolean;
};

/**
 * Tạo -> Gửi duyệt -> each step -> Phát hành -> Hủy. Steps carry their own decider (`decided_by_name`), so nothing
 * is guessed by joining `timeline[]` to `steps[]` by time; timeline only supplies created/submitted/issued/voided.
 */
export function buildFlow(c: Pick<Contract, "status" | "steps" | "timeline" | "void_reason"> & Partial<Pick<Contract, "parent">>): FlowItem[] {
  const out: FlowItem[] = [];
  const created = c.timeline.find((t) => t.action === "contract.created");
  // a child draft says where it came from: "Lập từ báo giá BG-2026-001"
  const from = c.parent ? `Lập từ ${DOC_TYPE_LABEL[c.parent.type].toLowerCase()} ${c.parent.number ?? "(nháp)"}` : null;
  if (created) out.push({ key: "created", kind: "created", label: "Tạo", state: "done", actor: created.actor ?? null, at: created.at, note: from, current: false });

  if (c.status !== "draft") {
    const submits = c.timeline.filter((t) => t.action === "contract.submitted");
    const submitted = submits[submits.length - 1];
    if (submitted) out.push({ key: "submitted", kind: "submitted", label: "Gửi duyệt", state: "done", actor: submitted.actor ?? null, at: submitted.at, note: null, current: false });
  }

  const steps = [...c.steps].sort((a, b) => a.step_no - b.step_no);
  const currentNo = c.status === "pending" ? steps.find((s) => s.status === "waiting")?.step_no : undefined;
  for (const s of steps) {
    out.push({
      key: `step-${s.step_no}`,
      kind: "step",
      label: s.label,
      state: s.status === "waiting" ? "waiting" : s.status === "rejected" ? "rejected" : "done",
      actor: s.decided_by_name ?? null,
      at: s.decided_at,
      note: s.note,
      current: s.step_no === currentNo,
    });
  }

  const issued = c.timeline.find((t) => t.action === "contract.issued");
  if (issued) out.push({ key: "issued", kind: "issued", label: "Phát hành", state: "done", actor: issued.actor ?? null, at: issued.at, note: null, current: false });
  const voided = c.timeline.find((t) => t.action === "contract.voided");
  if (voided) out.push({ key: "voided", kind: "voided", label: "Hủy", state: "done", actor: voided.actor ?? null, at: voided.at, note: c.void_reason, current: false });
  return out;
}

export const STEP_STATE_TEXT: Record<FlowItem["state"], string> = { done: "Đã duyệt", waiting: "Chờ duyệt", rejected: "Từ chối" };
