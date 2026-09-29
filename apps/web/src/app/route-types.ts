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
};
