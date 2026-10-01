/**
 * `0 3 * * *` (10:00 Vietnam) — RBAC nightly (SPEC-07 §3.3, DEC-12, R-12): open the current quarter's access
 * review if none exists, then expire overdue change requests. Each branch has its own try/catch (one failing never
 * stops the other); one summary line `cron.rbac_daily.tick`. `nowSeconds` is injected so tests drive the clock.
 */
import type { Bindings } from "../env";
import { getDb } from "../db/client";
import { openQuarterReview } from "../services/access-review-service";
import { expireOverdueRequests } from "../services/role-change-service";

type Outcome<T> = { value: T } | { errored: true };

function logError(branch: string, err: unknown): void {
  console.error(
    JSON.stringify({
      ts: Date.now(),
      kind: `error.cron.rbac_daily.${branch}`,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

export async function runRbacDaily(env: Bindings, nowSeconds: number): Promise<void> {
  const deps = { db: getDb(env), kv: env.SESSIONS, now: () => nowSeconds };

  let review: Outcome<string | null>;
  try {
    review = { value: await openQuarterReview(deps, nowSeconds) };
  } catch (err: unknown) {
    logError("review", err);
    review = { errored: true };
  }

  let requests: Outcome<number>;
  try {
    requests = { value: await expireOverdueRequests(deps, nowSeconds) };
  } catch (err: unknown) {
    logError("requests", err);
    requests = { errored: true };
  }

  console.log(
    JSON.stringify({
      ts: Date.now(),
      kind: "cron.rbac_daily.tick",
      review_opened: "value" in review ? review.value : "errored",
      requests_expired: "value" in requests ? requests.value : "errored",
    }),
  );
}
