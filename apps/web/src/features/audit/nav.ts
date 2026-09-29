import type { NavItem } from "../../app/route-types";

export const auditNavItems: readonly NavItem[] = [
  {
    id: "audit",
    label: "Nhật ký",
    to: "/nhat-ky",
    icon: "journal",
    section: "system",
    requiredPermissions: ["audit:read"],
  },
];

export const navItems = auditNavItems;
