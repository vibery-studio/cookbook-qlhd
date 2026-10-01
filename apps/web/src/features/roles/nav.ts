import type { NavItem } from "../../app/route-types";
import { useMe } from "../../app/me";
import { approvableCount, useChangeRequests } from "./requests";

/** Nav pill: pending permission requests the caller may approve. No request without roles:write. */
export function useRolesBadge(): number | undefined {
  const me = useMe();
  const allowed = me.data?.permissions.includes("roles:write") ?? false;
  const requests = useChangeRequests(allowed);
  return allowed ? approvableCount(requests.data) : undefined;
}

export const rolesNavItems: readonly NavItem[] = [
  {
    id: "roles",
    label: "Phân quyền",
    to: "/phan-quyen",
    icon: "shield",
    section: "system",
    badge: useRolesBadge,
    badgeLabel: (n) => `${n} yêu cầu đổi quyền chờ bạn duyệt`,
  },
];

export const navItems = rolesNavItems;
