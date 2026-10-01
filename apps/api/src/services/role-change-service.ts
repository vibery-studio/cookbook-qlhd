/**
 * Four-eyes permission change requests (SPEC-07 FR-3/4/11, DEC-1..4, DEC-14). C-07-002 stub: only the cron entry
 * exists; C-07-004 fills the bodies (create / list / approve / reject / withdraw / expire).
 */
import type { Db } from "../db/client";

export interface RoleChangeDeps {
  db: Db;
  kv: KVNamespace;
  now: () => number; // unix seconds
}

/**
 * Nightly (`0 3`): pending requests past `expires_at` → `expired` + one `role.change_expired` row each (R-12).
 * Returns how many were expired.
 */
export function expireOverdueRequests(deps: RoleChangeDeps, now: number): Promise<number> {
  void deps;
  void now;
  return Promise.resolve(0); // TODO(C-07-004)
}
