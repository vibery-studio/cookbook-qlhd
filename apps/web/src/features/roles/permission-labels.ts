/** Vietnamese labels for permission codes (mockup PERMS). Unknown code -> the code itself. */
export const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  "contract:read": "Xem hợp đồng",
  "contract:write": "Tạo & sửa nháp",
  "quote:write": "Lập báo giá",
  "payment_request:write": "Lập đề nghị thanh toán",
  "delivery_note:write": "Lập phiếu xuất kho",
  "contract:submit": "Gửi duyệt",
  "contract:approve": "Duyệt / từ chối",
  "contract:issue": "Phát hành & hủy",
  "template:write": "Quản lý mẫu",
  "product:write": "Sửa sản phẩm",
  "price:write": "Đặt giá",
  "users:read": "Xem người dùng",
  "users:write": "Quản lý người dùng",
  "roles:write": "Quản lý vai trò",
  "audit:read": "Xem nhật ký",
  "jit:grant": "Cấp quản trị tạm thời",
  "reviews:write": "Rà soát quyền",
  "security:write": "Cấu hình bảo mật",
  // Base RUNWAY permissions (no contract-app screen uses them): DEC-2.
  "flags:read": "Xem cờ tính năng",
  "flags:write": "Đổi cờ tính năng",
  "notes:read": "Xem ghi chú nền",
  "notes:write": "Sửa ghi chú nền",
  "settings:read": "Xem cài đặt hệ thống",
  "settings:write": "Đổi cài đặt hệ thống",
};

export const PERMISSION_GROUP_INFRA = "Hạ tầng (nền hệ thống)";
export const PERMISSION_GROUP_APP = "Hợp đồng";
export const PERMISSION_GROUP_ADMIN = "Quản trị";

/** Display order of the three groups. */
export const PERMISSION_GROUPS = [PERMISSION_GROUP_APP, PERMISSION_GROUP_ADMIN, PERMISSION_GROUP_INFRA] as const;

const INFRA_RESOURCES = ["flags", "notes", "settings"];
const ADMIN_CODES = ["users:read", "users:write", "roles:write", "audit:read", "jit:grant", "reviews:write", "security:write"];

/** Group heading for a permission code: Hợp đồng · Quản trị (users:*, roles:write, audit:read, jit:grant, reviews:write) · Hạ tầng (base RUNWAY). */
export function permissionGroup(code: string): string {
  const resource = code.split(":")[0] ?? "";
  if (INFRA_RESOURCES.includes(resource)) return PERMISSION_GROUP_INFRA;
  return ADMIN_CODES.includes(code) ? PERMISSION_GROUP_ADMIN : PERMISSION_GROUP_APP;
}

/** The catalog split into the three groups, each in label-table order (unknown codes last). Empty groups are dropped. */
export function groupCatalog(catalog: readonly string[]): Array<{ group: string; codes: string[] }> {
  const order = Object.keys(PERMISSION_LABELS);
  const rank = (c: string) => {
    const i = order.indexOf(c);
    return i === -1 ? order.length : i;
  };
  return PERMISSION_GROUPS.map((group) => ({
    group,
    codes: catalog.filter((c) => permissionGroup(c) === group).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
  })).filter((g) => g.codes.length > 0);
}

export function permissionLabel(code: string): string {
  return PERMISSION_LABELS[code] ?? code;
}

const ROLE_ORDER = ["giam_doc", "quan_ly", "nhan_vien", "admin", "root", "member"];

/** System roles first in ROLE_ORDER, then the self-made ones by label. */
export function sortRoles<T extends { name: string; label?: string }>(roles: readonly T[]): T[] {
  const rank = (n: string) => {
    const i = ROLE_ORDER.indexOf(n);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  return [...roles].sort(
    (a, b) => rank(a.name) - rank(b.name) || (a.label ?? a.name).localeCompare(b.label ?? b.name, "vi"),
  );
}
