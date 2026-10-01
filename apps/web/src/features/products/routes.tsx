import type { FeatureRoute } from "../../app/route-types";
import { ProductsScreen } from "./products-screen";

export const productsRoutes: FeatureRoute[] = [
  {
    path: "san-pham",
    requiredPermissions: ["contract:read"],
    element: <ProductsScreen />,
  },
];
