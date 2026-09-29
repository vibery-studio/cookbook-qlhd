import type { FeatureRoute } from "../../app/route-types";
import { TemplatesScreen } from "./templates-screen";

export const templatesRoutes: FeatureRoute[] = [
  { path: "mau-hop-dong", requiredPermissions: ["contract:read"], element: <TemplatesScreen /> },
  { path: "mau-hop-dong/:id", requiredPermissions: ["contract:read"], element: <TemplatesScreen /> },
];
