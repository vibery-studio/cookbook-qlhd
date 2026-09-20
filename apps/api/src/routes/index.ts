import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { authRoutes } from "./auth.routes";
import { meRoutes } from "./me.routes";
import { adminRoutes } from "./admin.routes";
import { adminSettingsRoutes } from "./admin-settings.routes";
import { demoRoutes } from "./demo.routes";

type Env = { Bindings: Bindings; Variables: Variables };

/**
 * Registers every route group on the shared `OpenAPIHono` app instance.
 * Order does not affect routing (each group uses distinct paths) but is
 * kept stable to keep `/openapi.json` operation ordering deterministic.
 */
export function mountRoutes(app: OpenAPIHono<Env>): void {
  authRoutes(app);
  meRoutes(app);
  adminRoutes(app);
  adminSettingsRoutes(app);
  demoRoutes(app);
}
