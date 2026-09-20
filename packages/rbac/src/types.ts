/**
 * The authenticated principal, ready for policy checks. Loader
 * (apps/api middleware) pre-computes `permissions` from a
 * user_roles → role_permissions → permissions join so `can()` never
 * touches D1.
 *
 * `roles` is typed as `readonly string[]` (not `RoleName[]`) so the
 * app-side session-cache DTO — which stores unknown-at-compile-time
 * strings loaded from D1 — flows in without a narrowing conversion.
 * `can()` only cares whether `admin` is present; other role names
 * pass through harmlessly.
 *
 * `permissions` is `readonly string[]` — same rationale as `roles`. The
 * middleware boundary (or `can()` itself) converts to `Set<string>` for
 * O(1) `.has()` lookup; keeping the on-context shape as an array means
 * the same object serializes cleanly through `c.json(principal)` and
 * the KV session cache.
 */
export interface Principal {
  id: string;
  roles: readonly string[];
  permissions: readonly string[];
}

/**
 * Optional resource context for ownership-scoped checks. `ownerId` is
 * the ULID of the resource owner. `admin` bypasses ownership. Extend
 * with additional context fields (e.g., `tenantId` in v2) only when a
 * new dimension of scope emerges.
 */
export interface ResourceContext {
  ownerId?: string;
}
