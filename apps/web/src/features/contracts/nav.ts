import type { NavItem } from "../../app/route-types";

export const contractsNavItems: readonly NavItem[] = [
  {
    id: "contracts",
    label: "Tài liệu",
    to: "/hop-dong",
    icon: "contracts",
    section: "workspace",
    requiredPermissions: ["contract:read"],
  },
];

export const navItems = contractsNavItems;
