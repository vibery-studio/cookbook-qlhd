import type { RouteObject } from "react-router";
import { ActivatePage, LoginPage } from "./auth-pages";

export const authRoutes: RouteObject[] = [
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/activate",
    element: <ActivatePage />,
  },
];
