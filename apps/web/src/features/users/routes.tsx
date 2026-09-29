import type { FeatureRoute } from "../../app/route-types";
import { UsersScreen } from "./users-screen";

export const usersRoutes: FeatureRoute[] = [
  {
    path: "nguoi-dung",
    requiredPermissions: ["users:read"],
    element: <UsersScreen />,
  },
];
