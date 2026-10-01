import type { NavItem } from "../../app/route-types";

/** C-11-001: only the Root admin (security:write) sees it. */
export const securityNavItems: readonly NavItem[] = [
  {
    id: "security",
    label: "Bảo mật",
    to: "/bao-mat",
    icon: "shield",
    section: "system",
    requiredPermissions: ["security:write"],
  },
];

export const navItems = securityNavItems;
