import { formatIsoDate } from "../../lib/vn-date";
import type { Contract } from "./api";
import { DOC_TYPE_LABEL, type DocType } from "./doc-type-labels";
import { statusLabel } from "./status";

export type ActionKey = "edit" | "submit" | "approve" | "reject" | "issue" | "void" | "copy" | "withdraw" | "delete";

/** FIX-06: the API's reason code for a locked action (`GET /contracts/{id}` `can.reason`). */
export type LockCode = NonNullable<Contract["can"]["reason"][ActionKey]>;

/** Which actions make sense for a status; the rest are simply not offered (SPEC-04b 3.4). */
export function visibleActions(status: Contract["status"]): ActionKey[] {
  switch (status) {
    case "draft":
      return ["edit", "submit", "delete"];
    case "pending":
      return ["edit", "approve", "reject", "withdraw"];
    case "approved":
      return ["issue"];
    case "issued":
      return ["void"];
    case "rejected":
    case "voided":
      return ["copy"];
  }
}

const ROLE_LABELS: Record<string, string> = { giam_doc: "Giám đốc", quan_ly: "Quản lý", nhan_vien: "Nhân viên" };

const NO_PERMISSION = "Bạn không có quyền thực hiện thao tác này.";

/**
 * The one sentence that explains a locked action; null when `can[action]` is true. FIX-06: WHY it is locked is decided by
 * the API (`can.reason[action]`, the same functions the write guards refuse with) — this only words the code, using the
 * contract's own data for names (the waiting step, whether Rút về nháp is offered). Fixed copy, never the server's words.
 */
export function lockReason(action: ActionKey, c: Pick<Contract, "can" | "steps">): string | null {
  if (c.can[action]) return null;
  const code: LockCode | null = c.can.reason[action];
  switch (code) {
    case "not_creator":
      if (action === "withdraw") return "Chỉ người tạo mới rút về nháp được.";
      if (action === "delete") return "Chỉ người tạo mới xóa được nháp.";
      return "Chỉ người tạo mới sửa/gửi duyệt hợp đồng nháp.";
    case "not_draft":
      if (action === "delete") return "Chỉ xóa được hợp đồng còn là nháp.";
      return c.can.withdraw
        ? "Hợp đồng đã gửi duyệt, không sửa được nữa. Muốn sửa, hãy Rút về nháp."
        : "Hợp đồng đã gửi duyệt, không sửa được nữa.";
    case "not_pending":
      return "Hợp đồng không ở trạng thái chờ duyệt.";
    case "creator_cannot_approve":
      return "Bạn là người tạo nên không tự duyệt được.";
    case "one_person_one_step":
      return "Bạn đã quyết một bước của hợp đồng này; mỗi người chỉ quyết một bước.";
    case "step_role": {
      const step = c.steps.filter((s) => s.status === "waiting").sort((a, b) => a.step_no - b.step_no)[0];
      if (!step) return NO_PERMISSION;
      const role = (step.required_role && ROLE_LABELS[step.required_role]) || "Quản lý hoặc Giám đốc";
      return `Bước «${step.label}» do ${role} duyệt.`;
    }
    case "no_issue_permission":
      return "Chỉ Quản lý hoặc Giám đốc phát hành.";
    case "not_approved":
      return "Cần duyệt xong mọi bước mới phát hành được.";
    case "not_issued":
      return "Chỉ hủy được hợp đồng đã phát hành.";
    case "step_decided":
      return "Đã có người duyệt/từ chối một bước, không rút về nháp được.";
    case "replaced":
      return "Đã có bản thay thế";
    case "not_copyable":
      return "Chỉ sao chép được hợp đồng bị từ chối hoặc đã hủy.";
    case "no_write_permission":
    case null:
      return NO_PERMISSION;
  }
}

export type CreateChildEntry = Contract["can"]["create_child"][number];

/** "Lập hợp đồng" · "Lập đề nghị thanh toán". */
export function createChildLabel(type: DocType): string {
  return `Lập ${DOC_TYPE_LABEL[type].toLowerCase()}`;
}

/**
 * SPEC-09 3.5: the one sentence under a locked "create child" button (the API decides; this only words it).
 * null when the server allows it.
 */
export function childLockReason(
  entry: CreateChildEntry,
  parent: Pick<Contract, "valid_until" | "children">,
): string | null {
  if (entry.allowed) return null;
  const label = DOC_TYPE_LABEL[entry.type].toLowerCase();
  switch (entry.reason_code) {
    case "quote-expired":
      return `Báo giá đã hết hạn ngày ${formatIsoDate(parent.valid_until)}`;
    case "child-exists": {
      const live = parent.children.filter((ch) => ch !== null && ch.type === entry.type && ch.status !== "voided" && ch.status !== "rejected");
      const ch = live[live.length - 1];
      return ch ? `Đã có ${label} ${ch.number ?? "nháp"} (${statusLabel(ch.status)})` : `Đã có ${label}`;
    }
    case "parent-not-issued":
      return "Chỉ lập từ tài liệu đã phát hành";
    case "forbidden":
      return `Bạn không có quyền lập ${label}`;
    case null:
      return `Chưa lập được ${label}`;
  }
}

/** The copy in this app says "hợp đồng"; for another document type say its own name instead (BG, DNTT, PXK drawers). */
export function retype(text: string, type: DocType): string {
  if (type === "contract") return text;
  return text.replaceAll("Hợp đồng", DOC_TYPE_LABEL[type]).replaceAll("hợp đồng", DOC_TYPE_LABEL[type].toLowerCase());
}
