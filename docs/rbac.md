# RBAC (Phase 6)

Runway ships a pure policy engine + a Hono middleware factory. The engine
is DB-free — checks run in-memory against a pre-loaded principal. The auth
middleware (Phase 5) populates that principal on cache miss via a
`user_roles → role_permissions → permissions` join.

## Model

- **Role**: named collection of permissions. v1 seeds `admin` + `member`.
- **Permission**: `resource:verb` key from a closed catalog. v1 catalog:
  `notes:read`, `notes:write`, `settings:read`, `settings:write`,
  `users:read`, `users:write`. Catalog + role grants are seeded by
  migration `0001_seed_rbac.sql` with fixed ULID literals for
  cross-environment reproducibility.
- **Principal**: `{ id, roles: string[], permissions: string[] }` on
  Hono context under `c.get("principal")`. Serializable — the same shape
  round-trips through the KV session cache without a `.toJSON` hop.

## The gate: `can(principal, permission, resource?)`

Pure function. Order:

1. Permission absent on principal → deny.
2. `resource.ownerId` present AND principal is NOT admin → require
   `resource.ownerId === principal.id`.
3. Otherwise → allow.

No `resource` argument = permission-only check (no ownership dimension).

## Middleware

```ts
import { requirePerm } from "../middleware/require-permission";

app.use("/admin/users", requireAuth(), requirePerm("users:read"));
app.get("/note/:id", requireAuth(), requirePerm("notes:write", {
  resource: async (c) => ({ ownerId: await lookupOwner(c.req.param("id")) }),
}));
```

Order matters: `requireAuth` MUST run first so `c.get("principal")` is
populated. Anonymous requests hit `requireAuth`'s 401 path before the
permission check. Denials are RFC 7807 `Problem+JSON` with type slug
`forbidden`.

## Adding a permission

Two lines:

1. Append to `packages/rbac/src/catalog.ts` `PERMISSIONS` array
   (keep alphabetized).
2. Add a `permission` row + relevant `role_permissions` grants to a
   new seed migration (`INSERT OR IGNORE` idempotent).

Middleware signatures and TypeScript inference update automatically.
The catalog is the single source of truth — adding to D1 without adding
to the catalog leaves the permission unreachable through
`requirePerm(...)`.

## Adding a role

Two lines:

1. Append to `packages/rbac/src/catalog.ts` `ROLE_NAMES`.
2. Add a `role` row + `role_permissions` grants to a new seed migration.

No middleware or auth-loader changes needed — `Principal.roles` is
`readonly string[]`, so unknown-at-compile-time role names flow through
harmlessly. Only `can()`'s `admin` bypass depends on a specific name.

## Role admin (SPEC-06)

- `roles:write` (migration `0017_seed_roles_write.sql`, id `01PERM0000000ROLESWRITE00`) → `admin`, `giam_doc`. Gates
  `POST /roles`, `PATCH /roles/{id}`, `DELETE /roles/{id}`; `GET /roles` stays login-only.
- `roles.name` is the immutable identity — approval steps and `can()`'s `admin` bypass match by name. Never renamed.
  Display name = `label`; duplicates checked on `label_key` (NFC, trim, collapsed spaces, `toLocaleLowerCase('vi')`).
- System roles (`is_system=1`): the 5 seeds `admin`, `member`, `giam_doc`, `quan_ly`, `nhan_vien` — never deleted or
  renamed; `admin` fully immutable through the API (its grants change by migration only). Custom roles: `name =
  "r_" + lowercase ULID`, server-made (nobody can create a role named `admin`); ≤ 50; deletable only with 0 holders.
- `version` = CAS for every edit (`expected_version` → 409 `stale`).

## Cache invalidation contract

When a role assignment changes on a user, the OWNING SERVICE (admin-
service) MUST call `invalidatePrincipalCache(kv, userId)` before
returning. The next authenticated request re-loads permissions from D1
via the join. Skipping the invalidation means up to 300s of stale
authorization on the affected user's session cookie — acceptable for
"grant more" (delayed uplift), NOT acceptable for "revoke" or
"demote" (lingering privilege).

For strong revocation semantics (demoting a user's admin, disabling an
account), route handlers should ALSO call `logout` to insert jti
revocation entries — this cuts the staleness to zero at the cost of
forcing the user to log in again.

## Ownership pattern

Do NOT reinvent ownership checks per service. Always route through
`requirePerm(perm, { resource: () => ({ ownerId }) })` or an inline
`can(principal, perm, { ownerId })` inside a service function.
Admin-bypass is baked in — services do not need to special-case admins.

`ownerId` MUST be `undefined` when no ownership check applies. Passing
`ownerId: ""` (empty string) enters the ownership branch and compares
`"" === principal.id`, which is generally NOT what callers want.
Resource resolvers should return `undefined` for the no-owner case.

## Test discipline

- `packages/rbac/test/*` covers the pure engine + middleware factory
  in isolation. No D1, no HTTP — pure Node.
- `apps/api/test/integration/rbac-flow.test.ts` covers wiring:
  member 403, admin 200, `/me` reflects the RBAC join, role grant
  invalidates cache, unknown-role safely rejected.
