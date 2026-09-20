import type { Context, MiddlewareHandler } from "hono";
import type { Permission } from "./catalog";
import { can } from "./policy";
import type { Principal, ResourceContext } from "./types";

/**
 * Payload for the caller's Problem+JSON emitter. `type` follows RFC 7807;
 * the app-side `problem()` helper prepends its base URI when it sees a
 * bare slug — the factory returns the slug so packages/rbac stays free of
 * app-specific type-URI base configuration.
 */
export interface DenyPayload {
  status: 403;
  title: "Forbidden";
  typeSlug: "forbidden";
  detail: string;
}

const DENY: DenyPayload = {
  status: 403,
  title: "Forbidden",
  typeSlug: "forbidden",
  detail: "Missing required permission",
};

/**
 * Resolves the resource context per-request. `undefined` means "no
 * ownership check" (the plain `can(p, perm)` path). Return
 * `{ ownerId }` to require ownership; middleware then admin-bypasses
 * via `can()` when the principal has the `admin` role.
 */
export type ResourceContextResolver<E extends { Variables: { principal?: Principal } }> = (
  c: Context<E>,
) => ResourceContext | Promise<ResourceContext> | undefined;

export interface RequirePermissionOptions<
  E extends { Variables: { principal?: Principal } },
> {
  /** Resolver for resource ownership; omit for permission-only checks. */
  resource?: ResourceContextResolver<E>;
  /**
   * Called when the check denies. Receives the Hono context + a
   * pre-built deny payload. Return a `Response` to short-circuit; if
   * the caller returns `void`, the middleware emits a bare plain-text
   * 403 as a safety fallback. Real deployments always supply an
   * `onDeny` that builds an RFC 7807 Problem+JSON body via the app's
   * `problem()` helper.
   */
  onDeny?: (c: Context<E>, deny: DenyPayload) => Response | Promise<Response>;
}

/**
 * Middleware factory: `app.use(route, requirePermission('users:read'))`.
 *
 * Reads `c.get('principal')`; deny if missing (401-shaped) or if `can()`
 * returns false (403). Auth middleware (Phase 5) MUST run first to
 * populate `principal` — order in `apps/api/src/index.ts` enforces this.
 *
 * Denies deliberately do NOT distinguish "no principal" from "wrong
 * permission" — both surface as 403 with the same body. If a route
 * needs 401-vs-403 discrimination, wrap this middleware in `requireAuth()`
 * first (which throws 401 on missing cookie).
 */
export function requirePermission<
  E extends { Variables: { principal?: Principal } } = {
    Variables: { principal?: Principal };
  },
>(
  permission: Permission,
  options: RequirePermissionOptions<E> = {},
): MiddlewareHandler<E> {
  return async (c, next) => {
    const principal = c.get("principal") as Principal | undefined;
    if (principal === undefined) return deny(c, options.onDeny);

    const resource = options.resource !== undefined ? await options.resource(c) : undefined;
    if (!can(principal, permission, resource)) return deny(c, options.onDeny);

    await next();
  };
}

async function deny<E extends { Variables: { principal?: Principal } }>(
  c: Context<E>,
  onDeny: RequirePermissionOptions<E>["onDeny"],
): Promise<Response> {
  if (onDeny !== undefined) return onDeny(c, DENY);
  return new Response(DENY.detail, {
    status: 403,
    headers: { "content-type": "text/plain" },
  });
}
