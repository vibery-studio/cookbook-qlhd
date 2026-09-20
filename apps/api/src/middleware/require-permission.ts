/**
 * App-side glue over `packages/rbac`'s `requirePermission` factory. Wires
 * an `onDeny` callback that emits the app's canonical Problem+JSON body,
 * so route handlers can `app.use('/admin/*', requirePerm('users:read'))`
 * and get a 403 with the same envelope the rest of the API uses.
 *
 * Kept OUT of packages/rbac because Problem+JSON `type` URI base is
 * app-specific (`PROBLEM_TYPE_BASE` → `https://runway.dev/errors`), not
 * a concern the pure policy package should carry.
 */
import type { Context, MiddlewareHandler } from "hono";
import {
  type Permission,
  type ResourceContextResolver,
  requirePermission as rbacRequirePermission,
} from "@runway/rbac";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { problem, ProblemType } from "../dto/error";

type Env = { Bindings: Bindings; Variables: Variables };

export interface RequirePermOptions {
  resource?: ResourceContextResolver<Env>;
}

export function requirePerm(
  permission: Permission,
  options: RequirePermOptions = {},
): MiddlewareHandler<Env> {
  return rbacRequirePermission<Env>(permission, {
    resource: options.resource,
    onDeny: (c: Context<Env>, deny) =>
      c.json(
        problem(deny.status, deny.title, ProblemType.Forbidden, {
          detail: deny.detail,
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        deny.status,
        { "content-type": "application/problem+json" },
      ),
  });
}
