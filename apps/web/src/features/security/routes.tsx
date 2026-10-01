import type { FeatureRoute } from "../../app/route-types";
import { SecurityScreen } from "./security-screen";

export const securityRoutes: FeatureRoute[] = [
  {
    path: "bao-mat",
    requiredPermissions: ["security:write"],
    element: <SecurityScreen />,
  },
];
