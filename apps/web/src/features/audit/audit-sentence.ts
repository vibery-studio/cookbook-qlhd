export type AuditTone = "neutral" | "danger" | "accent" | "ok" | "pending";

export type AuditEventLike = {
  action: string;
  metadata?: Record<string, unknown> | null;
};

export type AuditSentence = {
  icon: string;
  tone: AuditTone;
  /** Vietnamese phrase that follows the actor's name. Never empty. */
  text: string;
  /** Permission code to show as a small code chip (permission.denied only). */
  code?: string;
};

type Entry = { icon: string; tone: AuditTone; text: string };

/** The ONE table: action code -> Vietnamese phrase. Add new actions here. */
export const AUDIT_ACTIONS: Readonly<Record<string, Entry>> = {
  "auth.login": { icon: "🔑", tone: "neutral", text: "đăng nhập thành công" },
  "auth.login.rate_limited": { icon: "⏱", tone: "danger", text: "đăng nhập bị chặn do thử quá nhiều lần" },
  "auth.refresh.reuse_detected": { icon: "⚠️", tone: "danger", text: "phiên đăng nhập bị dùng lại bất thường, đã thu hồi phiên" },
  "permission.denied": { icon: "🔒", tone: "danger", text: "bị chặn: thử thao tác khi thiếu quyền" },
  "customer.created": { icon: "✏️", tone: "neutral", text: "thêm khách hàng" },
  "customer.updated": { icon: "✏️", tone: "neutral", text: "cập nhật khách hàng" },
  "user.invited": { icon: "✉️", tone: "accent", text: "mời người dùng" },
  "user.activated": { icon: "✓", tone: "ok", text: "kích hoạt tài khoản" },
  "user.renamed": { icon: "✏️", tone: "neutral", text: "đổi tên người dùng" },
  "user.role_changed": { icon: "🛡", tone: "accent", text: "đổi vai trò người dùng" },
  "user.disabled": { icon: "⛔", tone: "danger", text: "khóa tài khoản người dùng" },
  "user.enabled": { icon: "✓", tone: "ok", text: "mở khóa tài khoản người dùng" },
  "user.deletion_requested": { icon: "🗑", tone: "pending", text: "yêu cầu xóa tài khoản" },
  "user.deletion_cancelled": { icon: "↩", tone: "neutral", text: "hủy yêu cầu xóa tài khoản" },
  "user.deletion_completed": { icon: "🗑", tone: "neutral", text: "hoàn tất xóa tài khoản" },
  "template.created": { icon: "📄", tone: "accent", text: "tạo mẫu hợp đồng" },
  "template.version_created": { icon: "📄", tone: "accent", text: "tạo phiên bản mẫu hợp đồng" },
  "contract.created": { icon: "✏️", tone: "neutral", text: "tạo hợp đồng" },
  "contract.updated": { icon: "✏️", tone: "neutral", text: "sửa hợp đồng" },
  "contract.submitted": { icon: "📨", tone: "pending", text: "gửi duyệt hợp đồng" },
  "contract.approved": { icon: "✓", tone: "ok", text: "duyệt hợp đồng" },
  "contract.rejected": { icon: "✕", tone: "danger", text: "từ chối hợp đồng" },
  "contract.withdrawn": { icon: "↩", tone: "neutral", text: "rút hợp đồng về nháp" },
  "contract.deleted": { icon: "🗑", tone: "neutral", text: "xóa hợp đồng nháp" },
  "contract.issued": { icon: "📤", tone: "accent", text: "phát hành hợp đồng" },
  "contract.voided": { icon: "⛔", tone: "danger", text: "hủy hợp đồng đã phát hành" },
  "contract.pdf_generated": { icon: "📄", tone: "neutral", text: "tạo PDF cho hợp đồng" },
  "settings.update": { icon: "⚙️", tone: "neutral", text: "đổi cài đặt hệ thống" },
};

export const KNOWN_AUDIT_ACTIONS: readonly string[] = Object.keys(AUDIT_ACTIONS);

export function auditSentence(event: AuditEventLike): AuditSentence {
  const action = event.action.trim();
  const entry = AUDIT_ACTIONS[action];
  if (!entry) {
    return { icon: "•", tone: "neutral", text: `thực hiện ${action || "một thao tác"}` };
  }
  if (action === "permission.denied") {
    const permission = event.metadata?.["permission"];
    if (typeof permission === "string" && permission) {
      return { ...entry, text: "bị chặn: thử thao tác khi thiếu quyền", code: permission };
    }
  }
  return entry;
}
