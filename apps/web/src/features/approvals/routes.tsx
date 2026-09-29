import type { FeatureRoute } from "../../app/route-types";
import { ApprovalsScreen } from "./approvals-screen";

export const approvalsRoutes: FeatureRoute[] = [
  { path: "cho-toi-duyet", requiredPermissions: ["contract:approve"], element: <ApprovalsScreen /> },
];
