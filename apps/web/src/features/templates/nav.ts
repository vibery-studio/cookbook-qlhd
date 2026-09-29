import type { NavItem } from "../../app/route-types";

export const templatesNavItems: readonly NavItem[] = [
  {
    id: "templates",
    label: "Mẫu hợp đồng",
    to: "/mau-hop-dong",
    icon: "templates",
    section: "workspace",
    requiredPermissions: ["contract:read"],
  },
];

export const navItems = templatesNavItems;
