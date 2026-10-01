import type { Me } from "./me";
import type { NavItem } from "./route-types";
import { contractsNavItems } from "../features/contracts/nav";
import { templatesNavItems } from "../features/templates/nav";
import { approvalsNavItems } from "../features/approvals/nav";
import { customersNavItems } from "../features/customers/nav";
import { rolesNavItems } from "../features/roles/nav";
import { auditNavItems } from "../features/audit/nav";
import { usersNavItems } from "../features/users/nav";
import { accessReviewNavItems } from "../features/access-review/nav";

/**
 * The shell reads one registry. Feature cards replace or extend their own
 * entries without needing to know how the sidebar is laid out.
 */
export const navRegistry: readonly NavItem[] = [
  ...contractsNavItems,
  ...templatesNavItems,
  ...approvalsNavItems,
  ...customersNavItems,
  ...rolesNavItems,
  ...accessReviewNavItems,
  ...auditNavItems,
  ...usersNavItems,
];

export function canAccessNavItem(item: NavItem, me: Me): boolean {
  const all = (item.requiredPermissions ?? []).every((permission) => me.permissions.includes(permission));
  const any = item.anyPermissions === undefined || item.anyPermissions.some((permission) => me.permissions.includes(permission));
  return all && any;
}

export function visibleNavItems(me: Me): NavItem[] {
  return navRegistry.filter((item) => canAccessNavItem(item, me));
}
