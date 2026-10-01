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
 * `audit:read` reads the in-app `audit_events` table (SPEC-01 FR-4). `contract:*` and
 * `template:write` are the contract app's permissions (documents.workbook §3, the mockup's matrix). `product:write`,
 * `price:write` = products & dated price levels (SPEC-08 FR-7; reading products uses `contract:read`). `quote:write`,
 * `payment_request:write`, `delivery_note:write` = making a document of that type (SPEC-09 DEC-10 B; `contract:write` makes a
 * HĐ); reading/submitting/approving/issuing every type stays on the shared `contract:*` codes. `security:write` = toggle
 * two-layer approval of role permission changes (C-11-001) — held by the seeder-only `root` role alone.
 */
export const PERMISSIONS = [
  "audit:read",
  "contract:approve",
  "contract:issue",
  "contract:read",
  "contract:submit",
  "contract:write",
  "delivery_note:write",
  "flags:read",
  "flags:write",
  "jit:grant",
  "notes:read",
  "notes:write",
  "payment_request:write",
  "price:write",
  "product:write",
  "quote:write",
  "reviews:write",
  "roles:write",
  "security:write",
  "settings:read",
  "settings:write",
  "template:write",
  "users:read",
  "users:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_NAMES = ["admin", "member", "giam_doc", "quan_ly", "nhan_vien"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
