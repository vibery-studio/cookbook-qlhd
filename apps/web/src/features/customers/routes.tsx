import type { FeatureRoute } from "../../app/route-types";
import { CustomersScreen } from "./customers-screen";

export const customersRoutes: FeatureRoute[] = [
  {
    path: "khach-hang",
    requiredPermissions: ["contract:read"],
    element: <CustomersScreen />,
  },
];
