import type { RouteObject } from "react-router";
import type { IconName } from "../ui";

export type FeatureRoute = RouteObject & {
  requiredPermissions?: readonly string[];
};

export type NavItem = {
  id: string;
  label: string;
  to: string;
  icon: IconName;
  section: "workspace" | "system";
  requiredPermissions?: readonly string[];
  /**
   * Optional hook returning a count (or text) for a pill on the nav item; 0 / "" / undefined hides it.
   * Rendered as its own component per visible item, so it is a normal React hook.
   * The pill gets data-testid="nav-badge-<id>".
   */
  badge?: () => number | string | undefined;
  /** Vietnamese aria-label for the pill, given its value (e.g. "3 hợp đồng chờ bạn duyệt"). */
  badgeLabel?: (value: number | string) => string;
};
