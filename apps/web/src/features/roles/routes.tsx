import type { FeatureRoute } from "../../app/route-types";
import { RolesScreen } from "./roles-screen";

export const rolesRoutes: FeatureRoute[] = [
  {
    path: "phan-quyen",
    element: <RolesScreen />,
  },
];
