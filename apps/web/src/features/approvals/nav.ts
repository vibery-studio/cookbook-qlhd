import type { NavItem } from "../../app/route-types";
import { useApprovalsBadge } from "./use-approvals-badge";

export const approvalsNavItems: readonly NavItem[] = [
  {
    id: "approvals",
    label: "Chờ tôi duyệt",
    to: "/cho-toi-duyet",
    icon: "approvals",
    section: "workspace",
    requiredPermissions: ["contract:approve"],
    badge: useApprovalsBadge,
    badgeLabel: (n) => `${n} hợp đồng chờ bạn duyệt`,
  },
];

export const navItems = approvalsNavItems;
