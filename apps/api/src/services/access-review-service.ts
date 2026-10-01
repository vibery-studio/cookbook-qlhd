/**
 * Quarterly access reviews (SPEC-07 FR-7/8, DEC-10..12). C-07-002 stub: only the cron entry exists; C-07-006 fills
 * the bodies (current / open / decide / close).
 */
import type { Db } from "../db/client";

export interface AccessReviewDeps {
  db: Db;
  kv: KVNamespace;
  now: () => number; // unix seconds
}

/**
 * Nightly (`0 3`): open the current quarter's review (Asia/Ho_Chi_Minh) if none exists, `opened_by:"system:cron"`.
 * Returns the period opened, or null when it already existed.
 */
export function openQuarterReview(deps: AccessReviewDeps, now: number): Promise<string | null> {
  void deps;
  void now;
  return Promise.resolve(null); // TODO(C-07-006)
}
