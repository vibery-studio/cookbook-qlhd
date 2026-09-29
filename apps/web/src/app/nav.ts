import type { Me } from "./me";
import type { NavItem } from "./route-types";
import { customersNavItems } from "../features/customers/nav";
import { rolesNavItems } from "../features/roles/nav";
import { auditNavItems } from "../features/audit/nav";
import { usersNavItems } from "../features/users/nav";

/**
 * The shell reads one registry. Feature cards replace or extend their own
 * entries without needing to know how the sidebar is laid out.
 */
export const navRegistry: readonly NavItem[] = [
  ...customersNavItems,
  ...rolesNavItems,
  ...auditNavItems,
  ...usersNavItems,
];

export function canAccessNavItem(item: NavItem, me: Me): boolean {
  return (item.requiredPermissions ?? []).every((permission) => me.permissions.includes(permission));
}

export function visibleNavItems(me: Me): NavItem[] {
  return navRegistry.filter((item) => canAccessNavItem(item, me));
}
