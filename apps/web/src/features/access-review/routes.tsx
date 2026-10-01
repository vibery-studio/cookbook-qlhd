import type { FeatureRoute } from "../../app/route-types";
import { ReviewScreen } from "./review-screen";

// No `requiredPermissions` here: the guard is all-of, this route needs any-of — the screen shows ForbiddenScreen itself.
export const accessReviewRoutes: FeatureRoute[] = [
  {
    path: "ra-soat-quyen",
    element: <ReviewScreen />,
  },
];
