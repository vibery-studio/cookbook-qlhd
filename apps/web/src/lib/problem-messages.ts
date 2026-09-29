import type { Problem } from "@runway/client";

export const KNOWN_PROBLEM_SLUGS = [
  "not-implemented",
  "validation",
  "unauthorized",
  "forbidden",
  "not-found",
  "conflict",
  "idempotency-conflict",
  "idempotency-in-flight",
  "idempotency-requires-auth",
  "rate-limited",
  "internal",
  "service-unavailable",
  "last-admin",
  "stale",
  "duplicate",
  "already-active",
  "invalid-or-expired-token",
  "template-check-failed",
  "missing-fields",
  "unresolved-placeholder",
  "no-eligible-approver",
  "state-conflict",
  "changed-after-approval",
  "would-block-later-step",
  "already-decided", // TODO(001): drop this literal once the generated client knows the slug
] as const;

export type ProblemSlug = (typeof KNOWN_PROBLEM_SLUGS)[number];

export type ProblemWithExtensions = Problem & {
  existing_id?: string;
  missing_fields?: Array<{ key: string; label: string }>;
  // TODO(001): replace with generated types once the client is regenerated
  rule?: string;
  label?: string;
  current_status?: string;
};

export type ProblemOptions = {
  /** "contract" switches on the contract-app wording (SPEC-04b 3.5) where it differs from the generic 4a copy. */
  resource?: "contract";
};

export type ProblemMessage = {
  message: string;
  fieldErrors: Record<string, string>;
  requestId?: string;
  existingId?: string;
  /** The server state moved under the user: refetch the resource (["contract", id]) and keep the screen. */
  reload?: boolean;
};

const fallbackMessage = "Có lỗi xảy ra. Vui lòng thử lại.";

const fieldLabels: Record<string, string> = {
  email: "Email",
  password: "Mật khẩu",
  password_confirmation: "Mật khẩu nhập lại",
  name: "Tên",
  display_name: "Tên hiển thị",
  phone: "Số điện thoại",
  tax_code: "Mã số thuế",
  token: "Liên kết kích hoạt",
  ma_goi: "Gói dịch vụ",
  so_cua_hang: "Số cửa hàng (1–999)",
  giam_gia: "Giảm giá (0–100%)",
  ngay_bat_dau: "Ngày bắt đầu",
  so_bao_gia: "Số báo giá",
  ngay_bao_gia: "Ngày báo giá",
  chuc_vu_nguoi_ky: "Chức vụ người ký",
};

export const CONTRACT_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "Nháp",
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  issued: "Đã phát hành",
  rejected: "Từ chối",
  voided: "Đã hủy",
};

const PACKAGE_UNAVAILABLE = "Gói này không làm hợp đồng hoặc chưa có giá ngày hôm nay";

export function problemSlug(type: string): string {
  return type.replace(/\/+$/, "").split("/").pop() ?? "";
}

function fieldLabel(path: string): string {
  const normalized = path.replace(/^\w+\./, "");
  return fieldLabels[normalized] ?? "Trường này";
}

function fieldErrorsFor(problem: ProblemWithExtensions, labels: Record<string, string>): Record<string, string> {
  const fieldErrors = new Map<string, string>();
  for (const error of problem.errors ?? []) {
    if (error.path === "values.ma_goi") {
      fieldErrors.set(error.path, PACKAGE_UNAVAILABLE);
      continue;
    }
    const label = labels[error.path] ?? fieldLabel(error.path);
    fieldErrors.set(error.path, `${label} chưa hợp lệ`);
  }
  for (const field of problem.missing_fields ?? []) {
    const label = labels[field.key] ?? field.label ?? fieldLabels[field.key] ?? fieldLabel(field.key);
    fieldErrors.set(field.key, `${label} là bắt buộc`);
  }
  return Object.fromEntries(fieldErrors);
}

function missingFieldsMessage(problem: ProblemWithExtensions): string {
  const names = (problem.missing_fields ?? []).map((f) => f.label || fieldLabels[f.key] || fieldLabel(f.key));
  return names.length > 0 ? `Thiếu: ${names.join(", ")}. Điền rồi tạo lại.` : "Điền đủ các trường bắt buộc.";
}

const RULE_MESSAGES: Record<string, string> = {
  creator_only: "Chỉ người tạo mới làm được việc này.",
  creator_cannot_approve: "Bạn là người tạo hợp đồng này nên không tự duyệt được. Nhờ người khác duyệt.",
  one_person_one_step: "Bạn đã quyết một bước của hợp đồng này; bước tiếp theo cần người khác.",
};

/** Messages that need the problem's extension members (rule, label, current_status). */
function contextMessage(slug: string, problem: ProblemWithExtensions, options: ProblemOptions): string | undefined {
  const step = problem.label ? `«${problem.label}»` : "này";
  switch (slug) {
    case "forbidden": {
      const ruleMessage = problem.rule ? RULE_MESSAGES[problem.rule] : undefined;
      if (ruleMessage) return ruleMessage;
      return options.resource === "contract" ? "🔒 Bạn không có quyền hoặc vai trò cho bước này." : undefined;
    }
    case "missing-fields":
      return missingFieldsMessage(problem);
    case "no-eligible-approver":
      return `Bước ${step} chưa có ai duyệt được — người tạo không tự duyệt và một người không duyệt hai bước. Nhờ người khác tạo hợp đồng này, hoặc nhờ Giám đốc thêm một người có vai trò đó.`;
    case "would-block-later-step":
      return `Chưa duyệt được: nếu bạn quyết bước này, bước ${step} sẽ không còn ai duyệt. Nhờ Giám đốc thêm người duyệt, hoặc để người khác duyệt bước này.`;
    case "state-conflict": {
      const status = problem.current_status ? CONTRACT_STATUS_LABELS[problem.current_status] : undefined;
      return status ? `Hợp đồng vừa được người khác chuyển sang «${status}». Đã tải lại.` : undefined;
    }
    case "stale":
      return options.resource === "contract" ? "Người khác vừa sửa hợp đồng này." : undefined;
    case "not-found":
      return options.resource === "contract" ? "Không tìm thấy hợp đồng (có thể đã bị xóa khỏi danh sách của bạn)." : undefined;
    default:
      return undefined;
  }
}

function baseMessage(slug: string, status: number): string {
  if (status === 401 || slug === "unauthorized") return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403 || slug === "forbidden") return "🔒 Bạn không có quyền thực hiện thao tác này.";
  if (status === 404 || slug === "not-found") return "Không tìm thấy nội dung bạn cần.";
  const specific422 = slug === "unresolved-placeholder" || slug === "template-check-failed" || slug === "missing-fields";
  if ((status === 422 && !specific422) || slug === "validation") return "Kiểm tra lại các ô đánh dấu.";
  if (status >= 500) return "Hệ thống đang bận, thử lại sau.";

  switch (slug) {
    case "not-implemented":
      return "Tính năng này chưa sẵn sàng. Vui lòng thử lại sau.";
    case "conflict":
      return "Thông tin này đã tồn tại. Kiểm tra lại trước khi tiếp tục.";
    case "idempotency-conflict":
      return "Yêu cầu này đã gửi với nội dung khác. Tải lại rồi làm lại.";
    case "idempotency-in-flight":
      return "Yêu cầu đang xử lý, đợi một chút.";
    case "idempotency-requires-auth":
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    case "rate-limited":
      return "Thử quá nhiều lần, đợi khoảng 1 phút rồi thử lại.";
    case "internal":
    case "service-unavailable":
      return "Hệ thống đang bận, thử lại sau.";
    case "last-admin":
      return "Không thể khóa hoặc đổi vai trò tài khoản quản trị cuối cùng.";
    case "stale":
      return "Người khác vừa sửa thông tin này. Tải bản mới trước khi lưu.";
    case "duplicate":
      return "Khách này đã có (trùng SĐT/MST).";
    case "already-active":
      return "Tài khoản này đã được kích hoạt.";
    case "invalid-or-expired-token":
      return "Link đã hết hạn hoặc đã dùng — nhờ Giám đốc tạo lại link.";
    case "template-check-failed":
      return "Mẫu chưa hợp lệ. Kiểm tra lại các ô đánh dấu.";
    case "missing-fields":
      return "Điền đủ các trường bắt buộc.";
    case "unresolved-placeholder":
      return "Mẫu còn chỗ trống chưa điền được. Báo Giám đốc kiểm tra mẫu.";
    case "no-eligible-approver":
      return "Không có người phù hợp để duyệt bước này.";
    case "state-conflict":
      return "Trạng thái đã thay đổi. Tải bản mới trước khi tiếp tục.";
    case "changed-after-approval":
      return "Nội dung đã đổi sau khi duyệt nên chưa phát hành được. Gửi duyệt lại.";
    case "already-decided":
      return "Đã có người duyệt hoặc từ chối một bước nên không rút về nháp được. Đã tải lại.";
    case "would-block-later-step":
      return "Không thể thực hiện vì sẽ chặn bước duyệt sau.";
    default:
      return fallbackMessage;
  }
}

export function problemMessage(
  problem: ProblemWithExtensions,
  labels: Record<string, string> = {},
  options: ProblemOptions = {},
): ProblemMessage {
  const slug = problemSlug(problem.type);
  const requestId = problem.status >= 500 ? problem.request_id : undefined;
  const contextual = contextMessage(slug, problem, options);
  const reload = slug === "already-decided" || (slug === "state-conflict" && contextual !== undefined);
  return {
    message: contextual ?? baseMessage(slug, problem.status),
    ...(reload ? { reload: true } : {}),
    fieldErrors: fieldErrorsFor(problem, labels),
    ...(requestId ? { requestId } : {}),
    ...(problem.existing_id ? { existingId: problem.existing_id } : {}),
  };
}

export function loginProblemMessage(status: number): string {
  if (status === 403) return "Tài khoản chưa kích hoạt hoặc đã bị khóa — liên hệ Giám đốc.";
  if (status === 429) return "Thử quá nhiều lần, đợi khoảng 1 phút rồi thử lại.";
  return "Email hoặc mật khẩu không đúng.";
}

export function networkProblemMessage(): string {
  return "Hệ thống đang bận, thử lại sau.";
}
