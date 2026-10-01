import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { authRoutes } from "./auth.routes";
import { meRoutes } from "./me.routes";
import { meDeleteRoutes } from "./me-delete.routes";
import { meExportRoutes } from "./me-export.routes";
import { adminRoutes } from "./admin.routes";
import { adminFlagsRoutes } from "./admin-flags.routes";
import { adminSettingsRoutes } from "./admin-settings.routes";
import { adminUsersRoutes } from "./admin-users.routes";
import { auditRoutes } from "./audit.routes";
import { approvalsRoutes } from "./approvals.routes";
import { contractsRoutes } from "./contracts.routes";
import { contractChildrenRoutes } from "./contract-children.routes";
import { customersRoutes } from "./customers.routes";
import { productsRoutes } from "./products.routes";
import { pricingRoutes } from "./pricing.routes";
import { templatesRoutes } from "./templates.routes";
import { templatesImportRoutes } from "./templates-import.routes";
import { templatesWriteRoutes } from "./templates-write.routes";
import { rolesRoutes } from "./roles.routes";
import { roleChangeRequestsRoutes } from "./role-change-requests.routes";
import { sodPairsRoutes } from "./sod-pairs.routes";
import { jitGrantsRoutes } from "./jit-grants.routes";
import { accessReviewsRoutes } from "./access-reviews.routes";
import { demoRoutes } from "./demo.routes";
import { healthRoutes } from "./health.routes";

type Env = { Bindings: Bindings; Variables: Variables };

/**
 * Registers every route group on the shared `OpenAPIHono` app instance.
 * Order does not affect routing (each group uses distinct paths) but is
 * kept stable to keep `/openapi.json` operation ordering deterministic.
 */
export function mountRoutes(app: OpenAPIHono<Env>): void {
  authRoutes(app);
  meRoutes(app);
  meExportRoutes(app);
  meDeleteRoutes(app);
  adminRoutes(app);
  adminUsersRoutes(app);
  rolesRoutes(app);
  roleChangeRequestsRoutes(app);
  sodPairsRoutes(app);
  jitGrantsRoutes(app);
  accessReviewsRoutes(app);
  auditRoutes(app);
  customersRoutes(app);
  productsRoutes(app);
  pricingRoutes(app);
  templatesRoutes(app);
  templatesWriteRoutes(app);
  templatesImportRoutes(app);
  contractsRoutes(app);
  contractChildrenRoutes(app);
  approvalsRoutes(app);
  adminSettingsRoutes(app);
  adminFlagsRoutes(app);
  demoRoutes(app);
  healthRoutes(app);
}
