import type { FeatureRoute } from "../../app/route-types";
import { ContractsScreen } from "./contracts-screen";

// One screen serves the list, the detail drawer and the paper overlay: the URL says which layers are open.
export const contractsRoutes: FeatureRoute[] = [
  { path: "hop-dong", requiredPermissions: ["contract:read"], element: <ContractsScreen /> },
  { path: "hop-dong/:id", requiredPermissions: ["contract:read"], element: <ContractsScreen /> },
  { path: "hop-dong/:id/van-ban", requiredPermissions: ["contract:read"], element: <ContractsScreen /> },
];
