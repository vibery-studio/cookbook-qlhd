/**
 * Thin KV wrapper for the cached-principal lookup, backed by `env.SESSIONS`.
 * Not a DAO over D1 — no drizzle involved — but lives alongside the other
 * `dao/*.ts` modules because it's the same "typed storage access, return a
 * DTO" discipline applied to KV instead of D1.
 *
 * Key: `session:<userId>`. Value: JSON `CachedPrincipal`. Default TTL 60s
 * (SPEC-06 DEC-4: bounds the purge race — a miss that read D1 before a role
 * change can re-cache the old principal for at most this long). Invalidated on
 * role change, role-permission change (every holder), disable, and delete — see
 * `docs/auth.md` for the max-time-to-revoke accounting that depends on this
 * TTL plus KV's eventual-consistency lag.
 *
 * SPEC-07 DEC-8: KV refuses `expirationTtl` < 60, so a JIT grant ending sooner cannot ride the KV TTL. Every entry
 * carries `valid_until` (unix seconds) = `min(now + TTL, jit.expires_at)`; a read at `now >= valid_until`, or of an
 * entry without `valid_until` (written before SPEC-07), is a miss — the caller re-reads D1.
 */

/** KV TTL of a cached principal (seconds). KV's minimum is 60. */
export const PRINCIPAL_CACHE_TTL_SECONDS = 60;

export interface CachedPrincipal {
  id: string;
  roles: string[];
  permissions: string[];
  /** unix seconds; the entry is stale from this instant on (SPEC-07 DEC-8). */
  valid_until: number;
}

function cacheKey(userId: string): string {
  return `session:${userId}`;
}

/** The cached principal, or null on a miss — absent, without `valid_until`, or `nowSeconds >= valid_until`. */
export async function getCachedPrincipal(
  kv: KVNamespace,
  userId: string,
  nowSeconds: number,
): Promise<CachedPrincipal | null> {
  const value = await kv.get<Partial<CachedPrincipal>>(cacheKey(userId), "json");
  if (value === null || typeof value.valid_until !== "number" || nowSeconds >= value.valid_until) return null;
  return value as CachedPrincipal;
}

export async function setCachedPrincipal(
  kv: KVNamespace,
  principal: CachedPrincipal,
  ttlSeconds = PRINCIPAL_CACHE_TTL_SECONDS,
): Promise<void> {
  await kv.put(cacheKey(principal.id), JSON.stringify(principal), {
    expirationTtl: ttlSeconds,
  });
}

export async function invalidatePrincipalCache(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(cacheKey(userId));
}
