---
title: "Phase 6: RBAC Package & Middleware"
status: completed
---

# Phase 6: RBAC Package & Middleware

## Overview

Ship `packages/rbac` as a pure, testable policy engine: a typed permission catalog, a `can(principal, permission, resource?)` function supporting resource-scoped ownership checks, and Hono middleware `requirePermission(permKey)` that returns 403 problem+json on deny. Seed roles (`admin`, `member`) and permissions via a migration. Admin-only `/admin/users` route enforced. Extension: adding a permission = add to catalog constant + one seed migration; no middleware changes. **No `scope` column on `user_roles` in v1** (Red Team F14 sub-finding).

## Requirements

- Functional
  - [ ] Typed permission catalog exported from `packages/rbac` (string union of all known keys)
  - [ ] `can(principal, permission)` returns boolean; O(1) lookup via Set on principal
  - [ ] `can(principal, permission, { ownerId })` supports ownership check helper
  - [ ] `requirePermission('key')` Hono middleware; 403 on deny with problem+json
  - [ ] Seed migration creates roles (`admin`, `member`), permissions catalog, and grants
  - [ ] `GET /admin/users` returns list of users; requires `users:read`
  - [ ] Admin user provisioning: `pnpm db:seed:admin --email x@y.com` (idempotent)
- Non-functional
  - [ ] Zero DB calls in `can()` — principal carries pre-loaded permission set
  - [ ] Policy engine pure — no side effects, fully unit-testable in Node

## Architecture

```
packages/rbac/
├── src/
│   ├── catalog.ts          # export const PERMISSIONS = ['users:read', 'users:write', 'settings:read', 'settings:write', 'audit:read', 'notes:read', 'notes:write'] as const
│   ├── types.ts            # Permission = typeof PERMISSIONS[number]; Principal { id, roles, permissions: Set<Permission> }
│   ├── policy.ts           # can(principal, permission, resource?): boolean
│   ├── middleware.ts       # requirePermission(perm): MiddlewareHandler (framework-agnostic factory)
│   └── index.ts
└── test/
    ├── policy.test.ts
    └── middleware.test.ts

apps/api/src/
├── services/
│   └── admin-service.ts    # listUsers()
├── routes/
│   └── admin.routes.ts     # (from P4, now filled)
├── dao/
│   ├── role-dao.ts
│   └── permission-dao.ts
└── seed/
    ├── seed-rbac.ts        # runs on first migrate or via CLI
    └── seed-admin.ts       # CLI helper

apps/api/src/db/migrations/
└── 0002_seed_rbac.sql      # roles + permissions + role_permissions rows
```

**Permission catalog (v1):**

```ts
export const PERMISSIONS = [
  'users:read',
  'users:write',        // create/update/disable users
  'settings:read',
  'settings:write',
  'notes:read',         // demo resource
  'notes:write',
] as const;
// NOTE: no `audit:read` — audit lives in Logpush destination, not in an in-app query API (Red Team F14).
```

**Role grants (v1):**

- `admin` → all permissions
- `member` → `notes:read`, `notes:write` (own resources only via `can(p, 'notes:write', {ownerId})`)

**Ownership helper (pure):**

```ts
export function can(
  p: Principal,
  perm: Permission,
  resource?: { ownerId?: string }
): boolean {
  if (!p.permissions.has(perm)) return false;
  if (resource?.ownerId && !p.roles.includes('admin')) {
    return resource.ownerId === p.id;
  }
  return true;
}
```

## Related Code Files

- Create: `packages/rbac/src/{catalog,types,policy,middleware,index}.ts` + tests
- Create: `apps/api/src/dao/{role-dao,permission-dao}.ts`
- Create: `apps/api/src/services/admin-service.ts`
- Fill: `apps/api/src/routes/admin.routes.ts`
- Create: `apps/api/src/db/migrations/0002_seed_rbac.sql`
- Create: `apps/api/src/seed/seed-rbac.ts`, `seed-admin.ts`
- Modify: `apps/api/src/services/me-service.ts` (P5) — load user permissions via `role_permissions` join, populate `Principal.permissions: Set`
- Modify: `apps/api/src/routes/me.routes.ts` — return `permissions` array
- Modify: `package.json` — `db:seed:admin` script

## Implementation Steps

1. **TDD `packages/rbac` first:**
   - Failing test: `policy.test.ts` — admin has all, member has notes only, ownership check works
   - Implement `catalog.ts` with `as const` array
   - Implement `types.ts` with derived `Permission` type
   - Implement `policy.ts` (~15 LOC)
   - Implement `middleware.ts` (factory: `(perm) => (c, next) => ...`)
2. **DAOs:** roleDao, permissionDao; return DTOs
3. **Migration 0002:** insert roles (with ULID literals as fixed strings for reproducibility), insert permission rows for every key in catalog, insert role_permissions. Wrap in idempotent `INSERT OR IGNORE`.
4. **seed-admin.ts CLI:** `pnpm db:seed:admin --email x` → looks up user, assigns admin role, prints result. Idempotent.
5. **Update me-service** (P5's Principal loader): join `user_roles → role_permissions → permissions`, populate `Set<Permission>`
6. **Fill admin routes:**
   - `GET /admin/users` uses `requirePermission('users:read')` → returns paginated user list (id, email, status, roles)
   - `PUT /admin/settings/:key` uses `requirePermission('settings:write')` → wired to Settings service in P8
7. **Integration tests:**
   - Signup + login as member → `/admin/users` → 403 with problem+json
   - Seed admin, login → `/admin/users` → 200 with list
   - Signup two members → member A cannot mutate member B's resource (P11 verifies with notes)
8. **Contract test** confirms admin routes require cookieAuth + document permission requirement in OpenAPI description

## Todo

- [ ] `packages/rbac` fully tested in isolation
- [ ] Permission catalog exports frozen string union
- [ ] Seed migration idempotent
- [ ] `db:seed:admin` CLI proven
- [ ] Principal loader joins permissions correctly
- [ ] `requirePermission` middleware returns 403 problem+json
- [ ] Admin route enforced; member gets 403; admin gets 200
- [ ] OpenAPI descriptions annotate permission requirements per route

## Success Criteria

- [ ] `packages/rbac` unit tests 100% pass without any DB dependency
- [ ] Bruno test: member → 403; admin → 200 on `/admin/users`
- [ ] Adding new permission `orders:refund` = 2-line change to `catalog.ts` + 1-line seed migration (documented in P11 recipe)
- [ ] Session cache in KV includes permissions; invalidated when user_roles changes

## Risk Assessment

- **Cache staleness on role change:** Assigning/revoking roles must invalidate the user's `session:<userId>` KV key AND insert `jti` revocation entries for all active access tokens of the user (per P5 pattern). Add explicit invalidation in admin-service; unit-test the invariant. Ownership of the invalidation call: **admin-service** (the write-side surface), not auth-service.
- **Ownership check spreading into services:** Keep `can()` as the only gate; services accept `principal` and call `can()` — don't reinvent ownership logic per-service. Document in `docs/rbac.md`.
- **Permission explosion:** Blueprint ships 7 permissions. Ecommerce could add 20+. `Set<Permission>` scales fine; catalog stays a single file with alphabetized `as const` array.
- **`as const` string union at scale:** ~200 permissions still fine; TS compile time is the only risk, mitigate by splitting catalog if it ever grows past that.
