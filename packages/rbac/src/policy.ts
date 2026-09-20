import type { Permission } from "./catalog";
import type { Principal, ResourceContext } from "./types";

/**
 * Pure policy check — no side effects, no DB. Order matters:
 *   1. Does the principal carry the permission at all? If not, deny.
 *   2. Is a resource ownership check requested? If yes, `admin` role
 *      bypasses; otherwise `ownerId === principal.id`.
 *   3. Otherwise, allow.
 *
 * A missing `ownerId` means "no ownership dimension" — permission alone
 * is sufficient. Callers pass `{ ownerId }` only for resource-scoped
 * checks (e.g., `can(p, 'notes:write', { ownerId: note.userId })`).
 *
 * Uses `Array.includes` on `permissions` — O(N). For principals with
 * many permissions and hot paths hitting `can()` per request, callers
 * can memoize a `Set<string>` outside this function; the shape stays
 * as an array on Principal so JSON serialization / KV round trips
 * work without an extra .toJSON conversion. In practice principals
 * carry <20 permissions and this is a non-issue.
 */
export function can(
  principal: Principal,
  permission: Permission,
  resource?: ResourceContext,
): boolean {
  if (!principal.permissions.includes(permission)) return false;
  if (resource?.ownerId !== undefined && !principal.roles.includes("admin")) {
    return resource.ownerId === principal.id;
  }
  return true;
}
