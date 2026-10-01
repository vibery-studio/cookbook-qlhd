import type { NavItem } from "../../app/route-types";
import { useMe } from "../../app/me";
import { useCurrentReview } from "./api";

/** Nav pill: rows still open, shown only while the review is overdue and the caller holds reviews:write. */
export function useReviewBadge(): number | undefined {
  const me = useMe();
  const allowed = me.data?.permissions.includes("reviews:write") ?? false;
  const current = useCurrentReview(allowed);
  const data = current.data;
  if (!allowed || !data?.review || !data.overdue || data.review.status !== "open") return undefined;
  const left = data.progress.total - data.progress.decided;
  return left > 0 ? left : undefined;
}

export const accessReviewNavItems: readonly NavItem[] = [
  {
    id: "access-review",
    label: "Rà soát quyền",
    to: "/ra-soat-quyen",
    icon: "shield",
    section: "system",
    anyPermissions: ["reviews:write", "roles:write"],
    badge: useReviewBadge,
    badgeLabel: (n) => `${n} dòng chưa rà soát, đợt đã quá hạn`,
  },
];

export const navItems = accessReviewNavItems;
