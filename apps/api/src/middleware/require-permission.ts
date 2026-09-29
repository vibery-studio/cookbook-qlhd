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
import { getDb } from "../db/client";
import { writeAuditEvent } from "../dao/audit-dao";
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
    onDeny: async (c: Context<Env>, deny) => {
      const principal = c.get("principal");
      // Anonymous 401s are not denials (requireAuth handles them) — only record known principals.
      if (principal !== undefined) {
        const meta = { permission, method: c.req.method, path: c.req.path };
        // Awaited BEFORE the 403 so the row exists when the client sees the response.
        await writeAuditEvent(getDb(c.env), {
          actor: principal.id,
          action: "permission.denied",
          target: c.req.path,
          metadata: meta,
          ip: c.req.header("cf-connecting-ip") ?? null,
        });
        console.log(
          JSON.stringify({ ts: Date.now(), kind: "audit", actor: principal.id, action: "permission.denied", target: c.req.path, metadata: meta }),
        );
      }
      return c.json(
        problem(deny.status, deny.title, ProblemType.Forbidden, {
          detail: deny.detail,
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        deny.status,
        { "content-type": "application/problem+json" },
      );
    },
  });
}
