/**
 * Thin KV wrapper for the cached-principal lookup, backed by `env.SESSIONS`.
 * Not a DAO over D1 — no drizzle involved — but lives alongside the other
 * `dao/*.ts` modules because it's the same "typed storage access, return a
 * DTO" discipline applied to KV instead of D1.
 *
 * Key: `session:<userId>`. Value: JSON `CachedPrincipal`. Default TTL 300s
 * (5min). Invalidated on role change, disable, and delete — see
 * `docs/auth.md` for the max-time-to-revoke accounting that depends on this
 * TTL plus KV's eventual-consistency lag.
 */

export interface CachedPrincipal {
  id: string;
  roles: string[];
  permissions: string[];
}

function cacheKey(userId: string): string {
  return `session:${userId}`;
}

export async function getCachedPrincipal(
  kv: KVNamespace,
  userId: string,
): Promise<CachedPrincipal | null> {
  const value = await kv.get<CachedPrincipal>(cacheKey(userId), "json");
  return value ?? null;
}

export async function setCachedPrincipal(
  kv: KVNamespace,
  principal: CachedPrincipal,
  ttlSeconds = 300,
): Promise<void> {
  await kv.put(cacheKey(principal.id), JSON.stringify(principal), {
    expirationTtl: ttlSeconds,
  });
}

export async function invalidatePrincipalCache(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(cacheKey(userId));
}
