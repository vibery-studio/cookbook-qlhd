import { createBrowserRouter, type RouteObject } from "react-router";
import { authRoutes } from "../features/auth/routes";
import { contractsRoutes } from "../features/contracts/routes";
import { templatesRoutes } from "../features/templates/routes";
import { approvalsRoutes } from "../features/approvals/routes";
import { customersRoutes } from "../features/customers/routes";
import { rolesRoutes } from "../features/roles/routes";
import { auditRoutes } from "../features/audit/routes";
import { usersRoutes } from "../features/users/routes";
import { HomeRedirect, protectFeatureRoutes, ProtectedLayout } from "./route-guard";
import { NotFoundScreen } from "./not-found-screen";

const featureRoutes: RouteObject[] = [
  ...protectFeatureRoutes(contractsRoutes),
  ...protectFeatureRoutes(templatesRoutes),
  ...protectFeatureRoutes(approvalsRoutes),
  ...protectFeatureRoutes(customersRoutes),
  ...protectFeatureRoutes(rolesRoutes),
  ...protectFeatureRoutes(auditRoutes),
  ...protectFeatureRoutes(usersRoutes),
];

export const appRoutes: RouteObject[] = [
  ...authRoutes,
  {
    element: <ProtectedLayout />,
    children: [{ index: true, element: <HomeRedirect /> }, ...featureRoutes, { path: "*", element: <NotFoundScreen /> }],
  },
];

export const router = createBrowserRouter(appRoutes);
