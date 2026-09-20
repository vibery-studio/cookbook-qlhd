/**
 * Permission catalog — the closed set of permission keys any principal
 * in the system can carry. Adding a new permission is a two-line change:
 * append here, add a seed row in the next migration. Middleware
 * signatures and TypeScript inference update automatically because
 * `Permission` is derived from this const array.
 *
 * Keep alphabetized. Format is `resource:verb` (colon separator). Do
 * not use nested colons — Set membership and OpenAPI docs assume a
 * single-level namespace.
 *
 * NOTE: `audit:read` intentionally absent — audit is a Logpush stream,
 * not an in-app query surface (see Red Team F14). Add it only if we
 * ship an audit-log D1 table later, which requires storage-cost review.
 */
export const PERMISSIONS = [
  "notes:read",
  "notes:write",
  "settings:read",
  "settings:write",
  "users:read",
  "users:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_NAMES = ["admin", "member"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
