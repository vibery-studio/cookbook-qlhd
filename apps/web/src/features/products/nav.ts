import type { NavItem } from "../../app/route-types";

export const productsNavItems: readonly NavItem[] = [
  {
    id: "products",
    label: "Sản phẩm & giá",
    to: "/san-pham",
    icon: "products",
    section: "workspace",
    requiredPermissions: ["contract:read"],
  },
];

export const navItems = productsNavItems;
