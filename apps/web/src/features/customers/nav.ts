import type { NavItem } from "../../app/route-types";

export const customersNavItems: readonly NavItem[] = [
  {
    id: "customers",
    label: "Khách hàng",
    to: "/khach-hang",
    icon: "customers",
    section: "workspace",
    requiredPermissions: ["contract:read"],
  },
];

export const navItems = customersNavItems;
