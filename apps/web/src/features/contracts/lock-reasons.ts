import type { Contract } from "./api";

export type ActionKey = "edit" | "submit" | "approve" | "reject" | "issue" | "void" | "copy" | "withdraw" | "delete";

export type LockContext = {
  contract: Pick<Contract, "status" | "created_by" | "steps" | "can" | "replaced_by_id">;
  meId: string;
  permissions: readonly string[];
};

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

/** The one sentence that explains a locked action; null when `can[action]` is true. Fixed copy, never the server's words. */
export function lockReason(action: ActionKey, ctx: LockContext): string | null {
  const { contract: c, meId, permissions } = ctx;
  if (c.can[action]) return null;
  const isCreator = c.created_by === meId;
  const decided = c.steps.some((s) => s.status !== "waiting");

  switch (action) {
    case "edit":
    case "submit":
      if (!isCreator) return "Chỉ người tạo mới sửa/gửi duyệt hợp đồng nháp.";
      if (c.status !== "draft") {
        return c.can.withdraw
          ? "Hợp đồng đã gửi duyệt, không sửa được nữa. Muốn sửa, hãy Rút về nháp."
          : "Hợp đồng đã gửi duyệt, không sửa được nữa.";
      }
      return NO_PERMISSION;
    case "approve":
    case "reject": {
      if (c.status !== "pending") return "Hợp đồng không ở trạng thái chờ duyệt.";
      if (isCreator) return "Bạn là người tạo nên không tự duyệt được.";
      if (c.steps.some((s) => s.decided_by === meId)) return "Bạn đã quyết một bước của hợp đồng này; mỗi người chỉ quyết một bước.";
      const step = c.steps.filter((s) => s.status === "waiting").sort((a, b) => a.step_no - b.step_no)[0];
      if (step) {
        const role = (step.required_role && ROLE_LABELS[step.required_role]) || "Quản lý hoặc Giám đốc";
        return `Bước «${step.label}» do ${role} duyệt.`;
      }
      return NO_PERMISSION;
    }
    case "issue":
      if (!permissions.includes("contract:issue")) return "Chỉ Quản lý hoặc Giám đốc phát hành.";
      if (c.status !== "approved") return "Cần duyệt xong mọi bước mới phát hành được.";
      return NO_PERMISSION;
    case "void":
      if (!permissions.includes("contract:issue")) return "Chỉ Quản lý hoặc Giám đốc phát hành.";
      if (c.status !== "issued") return "Chỉ hủy được hợp đồng đã phát hành.";
      return NO_PERMISSION;
    case "withdraw":
      if (!isCreator) return "Chỉ người tạo mới rút về nháp được.";
      if (decided) return "Đã có người duyệt/từ chối một bước, không rút về nháp được.";
      return NO_PERMISSION;
    case "delete":
      if (!isCreator) return "Chỉ người tạo mới xóa được nháp.";
      if (c.status !== "draft") return "Chỉ xóa được hợp đồng còn là nháp.";
      return NO_PERMISSION;
    case "copy":
      if (c.status === "voided" && c.replaced_by_id) return "Đã có bản thay thế";
      return NO_PERMISSION;
  }
}
