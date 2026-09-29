import type { NavItem } from "../../app/route-types";

export const rolesNavItems: readonly NavItem[] = [
  {
    id: "roles",
    label: "Phân quyền",
    to: "/phan-quyen",
    icon: "shield",
    section: "system",
  },
];

export const navItems = rolesNavItems;
