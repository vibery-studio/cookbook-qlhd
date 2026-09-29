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
] as const;

export type ProblemSlug = (typeof KNOWN_PROBLEM_SLUGS)[number];

export type ProblemWithExtensions = Problem & {
  existing_id?: string;
  missing_fields?: Array<{ key: string; label: string }>;
};

export type ProblemMessage = {
  message: string;
  fieldErrors: Record<string, string>;
  requestId?: string;
  existingId?: string;
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
};

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
    const label = labels[error.path] ?? fieldLabel(error.path);
    fieldErrors.set(error.path, `${label} chưa hợp lệ`);
  }
  for (const field of problem.missing_fields ?? []) {
    const label = labels[field.key] ?? fieldLabels[field.key] ?? field.label ?? fieldLabel(field.key);
    fieldErrors.set(field.key, `${label} là bắt buộc`);
  }
  return Object.fromEntries(fieldErrors);
}

function baseMessage(slug: string, status: number): string {
  if (status === 401 || slug === "unauthorized") return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403 || slug === "forbidden") return "🔒 Bạn không có quyền thực hiện thao tác này.";
  if (status === 404 || slug === "not-found") return "Không tìm thấy nội dung bạn cần.";
  if (status === 422 || slug === "validation") return "Kiểm tra lại các ô đánh dấu.";
  if (status >= 500) return "Hệ thống đang bận, thử lại sau.";

  switch (slug) {
    case "not-implemented":
      return "Tính năng này chưa sẵn sàng. Vui lòng thử lại sau.";
    case "conflict":
      return "Thông tin này đã tồn tại. Kiểm tra lại trước khi tiếp tục.";
    case "idempotency-conflict":
      return "Yêu cầu này đã được gửi trước đó. Tải lại trang để xem kết quả.";
    case "idempotency-in-flight":
      return "Yêu cầu đang được xử lý. Đợi một chút rồi thử lại.";
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
      return "Mẫu còn trường chưa thể điền. Kiểm tra lại dữ liệu.";
    case "no-eligible-approver":
      return "Không có người phù hợp để duyệt bước này.";
    case "state-conflict":
      return "Trạng thái đã thay đổi. Tải bản mới trước khi tiếp tục.";
    case "changed-after-approval":
      return "Nội dung đã thay đổi sau khi duyệt. Tải bản mới trước khi tiếp tục.";
    case "would-block-later-step":
      return "Không thể thực hiện vì sẽ chặn bước duyệt sau.";
    default:
      return fallbackMessage;
  }
}

export function problemMessage(
  problem: ProblemWithExtensions,
  labels: Record<string, string> = {},
): ProblemMessage {
  const slug = problemSlug(problem.type);
  const requestId = problem.status >= 500 ? problem.request_id : undefined;
  return {
    message: baseMessage(slug, problem.status),
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
