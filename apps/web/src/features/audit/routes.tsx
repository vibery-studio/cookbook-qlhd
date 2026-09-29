import type { FeatureRoute } from "../../app/route-types";
import { AuditScreen } from "./audit-screen";

export const auditRoutes: FeatureRoute[] = [
  {
    path: "nhat-ky",
    requiredPermissions: ["audit:read"],
    element: <AuditScreen />,
  },
];
