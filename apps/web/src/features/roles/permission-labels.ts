/** Vietnamese labels for permission codes (mockup PERMS). Unknown code -> the code itself. */
export const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  "contract:read": "Xem hợp đồng",
  "contract:write": "Tạo & sửa nháp",
  "contract:submit": "Gửi duyệt",
  "contract:approve": "Duyệt / từ chối",
  "contract:issue": "Phát hành & hủy",
  "template:write": "Quản lý mẫu",
  "users:read": "Xem người dùng",
  "users:write": "Quản lý người dùng",
  "audit:read": "Xem nhật ký",
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

const INFRA_RESOURCES = ["flags", "notes", "settings"];

/** Group heading for a permission code: base RUNWAY codes go under "Hạ tầng (nền hệ thống)". */
export function permissionGroup(code: string): string {
  const resource = code.split(":")[0] ?? "";
  return INFRA_RESOURCES.includes(resource) ? PERMISSION_GROUP_INFRA : PERMISSION_GROUP_APP;
}

export function permissionLabel(code: string): string {
  return PERMISSION_LABELS[code] ?? code;
}

const ROLE_ORDER = ["giam_doc", "quan_ly", "nhan_vien", "admin"];

export function sortRoles<T extends { name: string }>(roles: readonly T[]): T[] {
  const rank = (n: string) => {
    const i = ROLE_ORDER.indexOf(n);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  return [...roles].sort((a, b) => rank(a.name) - rank(b.name));
}
