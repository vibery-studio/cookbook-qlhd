import { permissionLabel } from "../roles/permission-labels";
import { formatIsoDate } from "../../lib/vn-date";
import { formatPlainMoney, vatLabel } from "../products/product-view";
import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from "../contracts/doc-type-labels";

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
  "role.created": { icon: "🛡", tone: "accent", text: "tạo vai trò" },
  "role.updated": { icon: "🛡", tone: "neutral", text: "sửa vai trò" },
  "role.permissions_changed": { icon: "🛡", tone: "accent", text: "đổi quyền của vai trò" },
  "role.deleted": { icon: "🗑", tone: "neutral", text: "xóa vai trò" },
  "sod.pair_added": { icon: "⚖️", tone: "accent", text: "khai cặp quyền xung đột" },
  "sod.pair_removed": { icon: "⚖️", tone: "neutral", text: "xóa cặp quyền xung đột" },
  "role.change_requested": { icon: "📨", tone: "pending", text: "gửi yêu cầu đổi quyền của vai trò" },
  "role.change_approved": { icon: "✓", tone: "ok", text: "duyệt yêu cầu đổi quyền của vai trò" },
  "role.change_rejected": { icon: "✕", tone: "danger", text: "từ chối yêu cầu đổi quyền của vai trò" },
  "role.change_withdrawn": { icon: "↩", tone: "neutral", text: "rút yêu cầu đổi quyền của vai trò" },
  "role.change_expired": { icon: "⏱", tone: "neutral", text: "yêu cầu đổi quyền của vai trò hết hạn" },
  "jit.granted": { icon: "⏳", tone: "accent", text: "cấp quản trị tạm thời" },
  "jit.revoked": { icon: "↩", tone: "neutral", text: "thu hồi quản trị tạm thời" },
  "jit.expired": { icon: "⏱", tone: "neutral", text: "quản trị tạm thời hết hạn" },
  "review.opened": { icon: "🔍", tone: "accent", text: "mở đợt rà soát quyền" },
  "review.closed": { icon: "✓", tone: "ok", text: "kết thúc đợt rà soát quyền" },
  "review.item_decided": { icon: "🔍", tone: "neutral", text: "rà soát quyền" },
  "product.created": { icon: "📦", tone: "neutral", text: "thêm sản phẩm" },
  "product.updated": { icon: "✏️", tone: "neutral", text: "sửa sản phẩm" },
  "product.deactivated": { icon: "⛔", tone: "neutral", text: "ngừng bán" },
  "product.reactivated": { icon: "✓", tone: "ok", text: "bán lại" },
  "price.added": { icon: "💲", tone: "accent", text: "đặt giá" },
  "price.cancelled": { icon: "↩", tone: "neutral", text: "hủy mức giá" },
  "settings.update": { icon: "⚙️", tone: "neutral", text: "đổi cài đặt hệ thống" },
  "security.two_layer_changed": { icon: "🔐", tone: "accent", text: "đổi cơ chế duyệt 2 lớp khi đổi quyền" },
};

export const KNOWN_AUDIT_ACTIONS: readonly string[] = Object.keys(AUDIT_ACTIONS);

const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** role.* sentences name the role («label» from the event metadata, which survives deletion). */
function roleText(action: string, metadata: Record<string, unknown> | null | undefined, fallback: string): string {
  const label = metadata?.["label"];
  if (typeof label !== "string" || label === "") return fallback;
  if (action === "role.permissions_changed") {
    const on = count(metadata?.["added"]);
    const off = count(metadata?.["removed"]);
    const parts = [...(on > 0 ? [`bật ${on}`] : []), ...(off > 0 ? [`tắt ${off}`] : [])];
    const direct = metadata?.["direct"] === true ? " trực tiếp (cơ chế duyệt 2 lớp đang tắt)" : "";
    return parts.length > 0 ? `${parts.join(" · ")} quyền của «${label}»${direct}` : `${fallback} «${label}»${direct}`;
  }
  return `${fallback} «${label}»`;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

const hhmm = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });

/** role.change_* : "gửi yêu cầu bật 2 · tắt 1 quyền của «Quản lý»" — without the role label, the table phrase. */
function changeText(action: string, metadata: Record<string, unknown> | null | undefined, fallback: string): string {
  const label = str(metadata?.["label"]);
  if (label === null) return fallback;
  const on = count(metadata?.["added"]);
  const off = count(metadata?.["removed"]);
  const parts = [...(on > 0 ? [`bật ${on}`] : []), ...(off > 0 ? [`tắt ${off}`] : [])];
  const what = parts.length > 0 ? `${parts.join(" · ")} quyền của «${label}»` : `đổi quyền của «${label}»`;
  switch (action) {
    case "role.change_requested": return `gửi yêu cầu ${what}`;
    case "role.change_approved": return `duyệt yêu cầu ${what}`;
    case "role.change_rejected": return `từ chối yêu cầu ${what}`;
    case "role.change_withdrawn": return `rút yêu cầu ${what}`;
    default: return `yêu cầu ${what} hết hạn`;
  }
}

function sodText(metadata: Record<string, unknown> | null | undefined, fallback: string): string {
  const a = str(metadata?.["perm_a"]);
  const b = str(metadata?.["perm_b"]);
  return a !== null && b !== null ? `${fallback} «${permissionLabel(a)}» ⟷ «${permissionLabel(b)}»` : fallback;
}

/** jit.granted: "cấp quản trị tạm thời [cho «Bình»] tới 15:30 — lý do: …" (the event stores the user id; a name only if the API sends one). */
function jitGrantText(metadata: Record<string, unknown> | null | undefined, fallback: string): string {
  const name = str(metadata?.["user_name"]);
  const expires = metadata?.["expires_at"];
  const reason = str(metadata?.["reason"]);
  return [
    fallback,
    ...(name !== null ? [`cho «${name}»`] : []),
    ...(typeof expires === "number" ? [`tới ${hhmm.format(new Date(expires * 1000))}`] : []),
  ].join(" ") + (reason !== null ? ` — lý do: ${reason}` : "");
}

/** security.two_layer_changed: "tắt cơ chế duyệt 2 lớp khi đổi quyền — lý do: …". */
function twoLayerText(metadata: Record<string, unknown> | null | undefined, fallback: string): string {
  const enabled = metadata?.["enabled"];
  const reason = str(metadata?.["reason"]);
  const head = enabled === true ? "bật cơ chế duyệt 2 lớp khi đổi quyền" : enabled === false ? "tắt cơ chế duyệt 2 lớp khi đổi quyền" : fallback;
  return reason !== null ? `${head} — lý do: ${reason}` : head;
}

function reviewPeriod(metadata: Record<string, unknown> | null | undefined): string | null {
  const m = /^(\d{4})-(Q[1-4])$/.exec(str(metadata?.["period"]) ?? "");
  return m ? `${m[2]}/${m[1]}` : null;
}

function reviewText(action: string, metadata: Record<string, unknown> | null | undefined, fallback: string): string {
  if (action === "review.item_decided") {
    const d = metadata?.["decision"];
    return d === "keep" ? "rà soát quyền: giữ một tài khoản" : d === "remove" ? "rà soát quyền: gỡ một tài khoản" : fallback;
  }
  const period = reviewPeriod(metadata);
  return period ? `${fallback} ${period}` : fallback;
}

/** product.* / price.*: the sentence names the code «G6»; price.* adds "1.100.000 đ + 10% từ 01/01/2027" (KCT: "… đ KCT từ …"). */
function productText(action: string, metadata: Record<string, unknown> | null | undefined, fallback: string): string {
  const code = str(metadata?.["code"]);
  if (code === null) return fallback;
  const head = `${fallback} «${code}»`;
  if (!action.startsWith("price.")) return head;
  const ex = metadata?.["unit_price_ex_vat"];
  const from = str(metadata?.["effective_from"]);
  const rate = metadata?.["vat_rate_bps"];
  if (typeof ex !== "number" || from === null || !(rate === null || typeof rate === "number")) return head;
  const tax = rate === null ? "KCT" : `+ ${vatLabel(rate)}`;
  return `${head} ${formatPlainMoney(ex)} đ ${tax} từ ${formatIsoDate(from)}`;
}

const docType = (v: unknown): DocType => DOC_TYPES.find((t) => t === v) ?? "contract";
const noun = (t: DocType): string => DOC_TYPE_LABEL[t].toLocaleLowerCase("vi");
/** Which type a child of `t` comes from (CHILD_OF inverted). */
const PARENT_OF: Partial<Record<DocType, DocType>> = { contract: "quote", payment_request: "contract" };

/** contract.* sentences name the document type from `metadata.type` (SPEC-09 FR-10); a child says what it was made from. */
function contractText(action: string, metadata: Record<string, unknown> | null | undefined, fallback: string): string {
  const type = docType(metadata?.["type"]);
  const n = noun(type);
  const parentNumber = str(metadata?.["parent_number"]);
  const parentType = PARENT_OF[type];
  switch (action) {
    case "contract.created":
      return parentNumber !== null && parentType !== undefined ? `lập ${n} từ ${noun(parentType)} ${parentNumber}` : `tạo ${n}`;
    case "contract.updated": return `sửa ${n}`;
    case "contract.submitted": return `gửi duyệt ${n}`;
    case "contract.approved": return `duyệt ${n}`;
    case "contract.rejected": return `từ chối ${n}`;
    case "contract.withdrawn": return `rút ${n} về nháp`;
    case "contract.deleted": return `xóa ${n} nháp`;
    case "contract.issued": return `phát hành ${n}`;
    case "contract.voided": return `hủy ${n} đã phát hành`;
    case "contract.pdf_generated": return `tạo PDF cho ${n}`;
    default: return fallback;
  }
}

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
  if (action.startsWith("product.") || action.startsWith("price.")) return { ...entry, text: productText(action, event.metadata, entry.text) };
  if (action.startsWith("role.change_")) return { ...entry, text: changeText(action, event.metadata, entry.text) };
  if (action.startsWith("sod.")) return { ...entry, text: sodText(event.metadata, entry.text) };
  if (action === "jit.granted") return { ...entry, text: jitGrantText(event.metadata, entry.text) };
  if (action === "security.two_layer_changed") return { ...entry, text: twoLayerText(event.metadata, entry.text) };
  if (action.startsWith("review.")) return { ...entry, text: reviewText(action, event.metadata, entry.text) };
  if (action.startsWith("contract.")) return { ...entry, text: contractText(action, event.metadata, entry.text) };
  if (action.startsWith("role.")) return { ...entry, text: roleText(action, event.metadata, entry.text) };
  return entry;
}
