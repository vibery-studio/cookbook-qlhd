/**
 * Just-in-time admin grants (SPEC-07 FR-5/6, DEC-5..8). C-07-002 stub: only the cron entry exists; C-07-005 fills
 * the bodies (grant / list / revoke / sweep).
 */
import type { Db } from "../db/client";

export interface JitDeps {
  db: Db;
  kv: KVNamespace;
  now: () => number; // unix seconds
}

/**
 * Every-5-minutes cron: grants past `expires_at`, not revoked, not yet logged → `expiry_logged_at` + one `jit.expired` row
 * + cache purge (≤ 100 per tick). Expiry itself is enforced per request (`valid_until`, DEC-8). Returns the count.
 */
export function sweepExpiredJit(deps: JitDeps, now: number): Promise<number> {
  void deps;
  void now;
  return Promise.resolve(0); // TODO(C-07-005)
}
