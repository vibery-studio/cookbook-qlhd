/**
 * Nightly pruner. Walks the two tables that accumulate short-lived
 * rows — `jwt_revocations` and `idempotency_keys` — and deletes
 * anything whose `expires_at` has passed. Bounded work per tick
 * because both tables have `idx_*_expires` indexes (Phase 3 + 9).
 *
 * Not wired to prune every tick of the 5-min sweeper — this runs
 * once per day at 03:00 UTC to keep D1 write pressure predictable.
 */
import type { Bindings } from "../env";
import { getDb } from "../db/client";
import { pruneExpiredJtiRevocations } from "../dao/jwt-revocation-dao";
import { pruneExpiredKeys } from "../dao/idempotency-dao";

/**
 * Per-branch outcome sentinel: distinguishes "ran successfully, 0
 * rows" from "DAO threw" in the summary log. Operators eyeballing
 * `jti_pruned: 0` should not be misled into thinking there was
 * nothing to prune when in fact the DAO failed.
 */
type PruneOutcome = { count: number } | { errored: true };

export async function pruneExpiredRows(env: Bindings): Promise<void> {
  const db = getDb(env);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const [jtiOutcome, idemOutcome] = await Promise.all([
    pruneExpiredJtiRevocations(db, nowSeconds)
      .then((count) => ({ count }) as PruneOutcome)
      .catch((err: unknown) => {
        console.error(
          JSON.stringify({
            ts: Date.now(),
            kind: "error.pruner.jti",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return { errored: true } as PruneOutcome;
      }),
    pruneExpiredKeys(db, nowSeconds)
      .then((count) => ({ count }) as PruneOutcome)
      .catch((err: unknown) => {
        console.error(
          JSON.stringify({
            ts: Date.now(),
            kind: "error.pruner.idempotency",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return { errored: true } as PruneOutcome;
      }),
  ]);

  console.log(
    JSON.stringify({
      ts: Date.now(),
      kind: "cron.pruner.tick",
      jti_pruned: "count" in jtiOutcome ? jtiOutcome.count : null,
      jti_errored: "errored" in jtiOutcome,
      idempotency_pruned: "count" in idemOutcome ? idemOutcome.count : null,
      idempotency_errored: "errored" in idemOutcome,
    }),
  );
}
