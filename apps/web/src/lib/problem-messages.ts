import type { Problem } from "@runway/client";
import { permissionLabel } from "../features/roles/permission-labels";
import { DOC_TYPE_LABEL, type DocType } from "../features/contracts/doc-type-labels";

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
  "role-in-use",
  "role-limit",
  "unknown-role",
  "request-pending",
  "not-pending",
  "expired",
  "sod-conflict",
  "jit-active",
  "already-admin",
  "not-active",
  "item-changed",
  "review-closed",
  "review-incomplete",
  "price-backdated",
  "price-in-effect",
  "no-price",
  "product-inactive",
  "product-limit",
  "parent-not-issued",
  "child-exists",
  "quote-expired",
  "child-type",
  "lines-locked",
  "has-children",
  "parent-required",
  "template-type",
  "nothing-to-pay",
  "docx-invalid",
  "payload-too-large",
  "unsupported-media-type",
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
  /** role-in-use: how many people still carry the role. */
  holders?: number;
  /** grant_not_held: the codes the caller lacks. */
  permissions?: string[];
  /** sod-conflict on a role write: the permission pairs the set would hold together. */
  pairs?: string[][];
  /** sod-conflict on POST /sod-pairs: the roles that already hold both permissions. */
  roles?: Array<{ id: string; name: string; label: string }>;
  /** docx-invalid (SPEC-10): why the .docx was refused. */
  reason?: string;
  /** has-children: the children still alive (Ref). */
  children?: Array<{ id: string; type: DocType; number: string | null; status: string; total: number; doc_date: string }>;
};

export type ProblemOptions = {
  /** "contract" switches on the contract-app wording (SPEC-04b 3.5) where it differs from the generic 4a copy. */
  resource?: "contract" | "role" | "product" | "price";
  /** Product names by line index (the form knows them), for «tên» in line errors. */
  lineNames?: readonly string[];
  /** The type of the document being made/edited (SPEC-09): names it in `child-exists` and picks the `lines` rule wording. */
  docType?: DocType;
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

export function problemSlug(type: string): string {
  return type.replace(/\/+$/, "").split("/").pop() ?? "";
}

function fieldLabel(path: string): string {
  const normalized = path.replace(/^\w+\./, "");
  return fieldLabels[normalized] ?? "Trường này";
}

/** SPEC-08 §3.5: line errors come as `lines` (rule) or `lines.i.product_id` / `lines.i.qty`; the slug says which. */
function lineFieldError(path: string, slug: string, lineNames: readonly string[] | undefined, docType?: DocType): string | undefined {
  if (path === "lines") {
    if (docType === "delivery_note") return "Phiếu xuất kho chỉ nhận hàng hóa";
    if (docType === "quote") return "Kiểm tra lại các dòng hàng";
    return "Hợp đồng cần đúng 1 gói dịch vụ theo tháng";
  }
  const m = /^lines\.(\d+)\.(product_id|qty)$/.exec(path);
  if (!m) return undefined;
  const index = Number(m[1]);
  const n = index + 1;
  if (m[2] === "qty") return `Dòng ${n}: số lượng từ 1 đến 9.999`;
  if (slug === "no-price") return `Dòng ${n}: sản phẩm chưa có giá ngày lập`;
  if (slug === "product-inactive") return `Dòng ${n}: «${lineNames?.[index] ?? "sản phẩm này"}» đã ngừng bán`;
  return `Dòng ${n}: chọn một sản phẩm khác (không có hoặc trùng dòng khác)`;
}

function fieldErrorsFor(problem: ProblemWithExtensions, labels: Record<string, string>, options: ProblemOptions = {}): Record<string, string> {
  const fieldErrors = new Map<string, string>();
  const slug = problemSlug(problem.type);
  for (const error of problem.errors ?? []) {
    const lineError = lineFieldError(error.path, slug, options.lineNames, options.docType);
    if (lineError) {
      fieldErrors.set(error.path, lineError);
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
  // FIX-03 (SPEC-06 DEC-5): PATCH/POST /admin/users
  self_role: "🔒 Không tự đổi vai trò của mình. Nhờ người khác có quyền quản lý người dùng đổi giúp.",
  admin_only: "🔒 Chỉ Quản trị hệ thống mới gán vai trò Quản trị hệ thống hoặc sửa tài khoản quản trị.",
  // SPEC-06: /roles and role assignment
  own_role: "🔒 Bạn đang mang vai trò này nên không tự sửa được. Nhờ người khác có quyền quản lý vai trò.",
  admin_role: "🔒 Quản trị hệ thống luôn đủ quyền — không sửa hay xóa được.",
  system_role: "🔒 Vai trò hệ thống — không xóa/đổi tên.",
  // SPEC-07: four-eyes, JIT admin, access review
  self_approve: "🔒 Bạn gửi yêu cầu này nên không tự duyệt được. Nhờ người khác duyệt.",
  jit_actor: "🔒 Bạn đang có quyền quản trị tạm thời nên không làm được việc này.",
  self_grant: "🔒 Không tự cấp quản trị tạm thời cho mình.",
  self_review: "🔒 Không tự rà soát chính mình — người quản trị xác nhận.",
};

const SOD_ROLES_PREFIX = "Đang có vai trò chứa cả hai quyền: ";
const SOD_ROLES_SUFFIX = " — bỏ một quyền khỏi các vai trò đó trước.";
export const SOD_ROLES_TEXT = { prefix: SOD_ROLES_PREFIX, suffix: SOD_ROLES_SUFFIX } as const;

function sodMessage(problem: ProblemWithExtensions): string | undefined {
  if (problem.pairs && problem.pairs.length > 0) {
    return problem.pairs
      .map(([a, b]) => `«${permissionLabel(a ?? "")}» xung đột với «${permissionLabel(b ?? "")}» — bỏ một trong hai.`)
      .join(" ");
  }
  if (problem.roles && problem.roles.length > 0) {
    return `${SOD_ROLES_PREFIX}${problem.roles.map((r) => `«${r.label}»`).join(", ")}${SOD_ROLES_SUFFIX}`;
  }
  return undefined;
}

/** Messages that need the problem's extension members (rule, label, current_status). */
function contextMessage(slug: string, problem: ProblemWithExtensions, options: ProblemOptions): string | undefined {
  const step = problem.label ? `«${problem.label}»` : "này";
  switch (slug) {
    case "forbidden": {
      if (problem.rule === "grant_not_held") {
        const codes = (problem.permissions ?? []).map((c) => `«${permissionLabel(c)}»`);
        return codes.length > 0
          ? `🔒 Bạn không có quyền ${codes.join(", ")} nên không cấp được.`
          : "🔒 Bạn không có đủ quyền của vai trò này nên không cấp được.";
      }
      const ruleMessage = problem.rule ? RULE_MESSAGES[problem.rule] : undefined;
      if (ruleMessage) return ruleMessage;
      return options.resource === "contract" ? "🔒 Bạn không có quyền hoặc vai trò cho bước này." : undefined;
    }
    case "missing-fields":
      return missingFieldsMessage(problem);
    case "sod-conflict":
      return sodMessage(problem);
    case "no-eligible-approver":
      if (options.resource === "role") {
        return "Không còn người nào khác có quyền Quản lý vai trò để duyệt — đổi quyền phải qua người quản trị kỹ thuật (migration).";
      }
      return `Bước ${step} chưa có ai duyệt được — người tạo không tự duyệt và một người không duyệt hai bước. Nhờ người khác tạo hợp đồng này, hoặc nhờ Giám đốc thêm một người có vai trò đó.`;
    case "would-block-later-step":
      return `Chưa duyệt được: nếu bạn quyết bước này, bước ${step} sẽ không còn ai duyệt. Nhờ Giám đốc thêm người duyệt, hoặc để người khác duyệt bước này.`;
    case "state-conflict": {
      const status = problem.current_status ? CONTRACT_STATUS_LABELS[problem.current_status] : undefined;
      return status ? `Hợp đồng vừa được người khác chuyển sang «${status}». Đã tải lại.` : undefined;
    }
    case "stale":
      if (options.resource === "role") return "Người khác vừa sửa vai trò này.";
      if (options.resource === "product") return "Người khác vừa sửa sản phẩm này.";
      return options.resource === "contract" ? "Người khác vừa sửa hợp đồng này." : undefined;
    case "duplicate":
      if (options.resource === "product") return "Mã sản phẩm này đã có. Đặt mã khác.";
      if (options.resource === "price") return "Đã có mức giá áp dụng đúng ngày này. Chọn ngày khác.";
      return options.resource === "role" ? "Đã có vai trò tên này. Đặt tên khác." : undefined;
    case "role-in-use":
      return typeof problem.holders === "number"
        ? `Còn ${problem.holders} người mang vai trò này — đổi vai trò họ ở màn Người dùng trước.`
        : "Còn người đang mang vai trò này — đổi vai trò họ ở màn Người dùng trước.";
    case "child-exists":
      return `Đã có ${options.docType ? DOC_TYPE_LABEL[options.docType].toLocaleLowerCase("vi") : "tài liệu con"} cho tài liệu này`;
    case "has-children": {
      const list = (problem.children ?? []).map(
        (c) => `${DOC_TYPE_LABEL[c.type].toLocaleLowerCase("vi")} ${c.number ?? "nháp"} (${CONTRACT_STATUS_LABELS[c.status] ?? c.status})`,
      );
      return list.length > 0 ? `Còn tài liệu con chưa hủy: ${list.join(", ")}.` : "Còn tài liệu con chưa hủy — hủy tài liệu con trước.";
    }
    case "docx-invalid":
      return (problem.reason ? DOCX_REASONS[problem.reason] : undefined) ?? DOCX_FALLBACK;
    case "not-found":
      return options.resource === "contract" ? "Không tìm thấy hợp đồng (có thể đã bị xóa khỏi danh sách của bạn)." : undefined;
    default:
      return undefined;
  }
}

const DOCX_REASONS: Record<string, string> = {
  not_docx: "File này không phải Word .docx. Lưu lại thành .docx rồi chọn lại.",
  macro_enabled: "File có macro nên không nhận. Lưu thành .docx thường (không macro) rồi chọn lại.",
  no_document: "File Word không có phần nội dung văn bản.",
  xml_invalid: "Nội dung file Word bị lỗi nên không đọc được. Mở bằng Word, lưu lại rồi chọn lại.",
  too_large_inflated: "File Word giải nén ra quá lớn nên không nhận.",
  too_many_entries: "File Word có quá nhiều phần bên trong nên không nhận.",
};
const DOCX_FALLBACK = "Không đọc được file Word này. Chọn file .docx khác.";

const SPEC09_422: ReadonlySet<string> = new Set(["child-type", "lines-locked", "template-type", "parent-required", "nothing-to-pay"]);

function baseMessage(slug: string, status: number): string {
  if (status === 401 || slug === "unauthorized") return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403 || slug === "forbidden") return "🔒 Bạn không có quyền thực hiện thao tác này.";
  if (status === 404 || slug === "not-found") return "Không tìm thấy nội dung bạn cần.";
  if (status === 413 || slug === "payload-too-large") return "File lớn hơn 2 MB";
  if (status === 415 || slug === "unsupported-media-type") return "Chỉ nhận file Word .docx";
  const specific422 = slug === "price-backdated" || slug === "no-price" || slug === "product-inactive" || slug === "unresolved-placeholder" || slug === "template-check-failed" || slug === "missing-fields" || slug === "unknown-role" || slug === "docx-invalid" || SPEC09_422.has(slug);
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
    case "price-backdated":
      return "Ngày áp dụng phải từ ngày mai trở đi (mức đầu tiên của sản phẩm: từ hôm nay).";
    case "price-in-effect":
      return "Mức giá này đang áp dụng nên không hủy được. Đặt mức mới từ ngày mai.";
    case "product-limit":
      return "Đã đủ 500 sản phẩm — ngừng bán bớt trước khi thêm.";
    case "no-price":
      return "Có dòng chưa có giá ngày lập — xem các dòng được đánh dấu.";
    case "product-inactive":
      return "Có dòng đã ngừng bán — xem các dòng được đánh dấu.";
    case "parent-not-issued":
      return "Chỉ lập từ tài liệu đã phát hành";
    case "child-exists":
      return "Đã có tài liệu con cho tài liệu này";
    case "quote-expired":
      return "Báo giá đã hết hạn — hãy sao chép báo giá để lấy giá hôm nay";
    case "child-type":
      return "Không lập được loại tài liệu này từ tài liệu đã chọn.";
    case "lines-locked":
      return "Dòng hàng và giảm giá giữ theo tài liệu gốc";
    case "has-children":
      return "Còn tài liệu con chưa hủy — hủy tài liệu con trước.";
    case "parent-required":
      return "Đề nghị thanh toán chỉ lập từ hợp đồng đã phát hành";
    case "template-type":
      return "Mẫu này không thuộc loại tài liệu đang lập. Chọn mẫu khác.";
    case "nothing-to-pay":
      return "Hợp đồng 0 đồng — không có gì để đề nghị thanh toán";
    case "already-decided":
      return "Đã có người duyệt hoặc từ chối một bước nên không rút về nháp được. Đã tải lại.";
    case "would-block-later-step":
      return "Không thể thực hiện vì sẽ chặn bước duyệt sau.";
    case "role-in-use":
      return "Còn người đang mang vai trò này — đổi vai trò họ ở màn Người dùng trước.";
    case "role-limit":
      return "Đã đủ 50 vai trò tự tạo. Xóa bớt vai trò không dùng rồi thêm.";
    case "unknown-role":
      return "Vai trò này không còn nữa. Tải lại danh sách rồi chọn lại.";
    case "request-pending":
      return "Vai trò này đang có yêu cầu đổi quyền chờ duyệt. Duyệt, từ chối hoặc rút yêu cầu đó trước.";
    case "not-pending":
      return "Yêu cầu này không còn chờ duyệt nữa. Đã tải lại.";
    case "expired":
      return "Yêu cầu này đã hết hạn. Gửi yêu cầu mới.";
    case "sod-conflict":
      return "Tập quyền này xung đột với một cặp quyền đã khai. Bỏ một quyền trong cặp.";
    case "jit-active":
      return "Người này đang có quyền quản trị tạm thời. Thu hồi trước khi cấp lại.";
    case "already-admin":
      return "Người này đã là Quản trị hệ thống thường trực — không cần cấp tạm.";
    case "not-active":
      return "Quyền tạm này đã hết hạn hoặc đã thu hồi. Đã tải lại.";
    case "item-changed":
      return "Tài khoản này vừa thay đổi sau khi mở đợt rà soát nên không quyết được dòng này. Đã tải lại.";
    case "review-closed":
      return "Đợt rà soát đã kết thúc.";
    case "review-incomplete":
      return "Còn dòng chưa rà soát. Quyết hết các dòng rồi kết thúc đợt.";
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
  const reload = slug === "already-decided" || slug === "not-pending" || slug === "not-active" || slug === "item-changed" || (slug === "state-conflict" && contextual !== undefined);
  return {
    message: contextual ?? baseMessage(slug, problem.status),
    ...(reload ? { reload: true } : {}),
    fieldErrors: fieldErrorsFor(problem, labels, options),
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
