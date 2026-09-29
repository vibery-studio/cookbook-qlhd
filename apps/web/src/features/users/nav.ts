import type { NavItem } from "../../app/route-types";

export const usersNavItems: readonly NavItem[] = [
  {
    id: "users",
    label: "Người dùng",
    to: "/nguoi-dung",
    icon: "users",
    section: "system",
    requiredPermissions: ["users:read"],
  },
];

export const navItems = usersNavItems;
