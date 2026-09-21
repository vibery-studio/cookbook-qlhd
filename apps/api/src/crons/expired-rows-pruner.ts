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
import { pruneExpiredUserExports } from "../dao/user-exports-dao";
import { sweepPendingDeletions } from "../privacy/deletion-service";
import { SettingsService } from "../settings/settings-service";

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

  const [jtiOutcome, idemOutcome, exportsOutcome] = await Promise.all([
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
    pruneExpiredUserExports(db, nowSeconds)
      .then((count) => ({ count }) as PruneOutcome)
      .catch((err: unknown) => {
        console.error(
          JSON.stringify({
            ts: Date.now(),
            kind: "error.pruner.user_exports",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return { errored: true } as PruneOutcome;
      }),
  ]);

  // Privacy sweeper runs AFTER the pure-prune stage so a failing prune
  // doesn't block a deletion window. Failures are logged individually;
  // one user's erasure failing must not stop the batch.
  let erasedCount = 0;
  let sweeperErrored = false;
  try {
    const settings = new SettingsService({ db, kv: env.SETTINGS });
    const graceSeconds = await settings.get("privacy.deletion_grace_seconds");
    const result = await sweepPendingDeletions(
      { db, env, kv: env.SESSIONS },
      { graceSeconds },
    );
    erasedCount = result.erased;
  } catch (err) {
    sweeperErrored = true;
    console.error(
      JSON.stringify({
        ts: Date.now(),
        kind: "error.pruner.privacy_sweep",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  console.log(
    JSON.stringify({
      ts: Date.now(),
      kind: "cron.pruner.tick",
      jti_pruned: "count" in jtiOutcome ? jtiOutcome.count : null,
      jti_errored: "errored" in jtiOutcome,
      idempotency_pruned: "count" in idemOutcome ? idemOutcome.count : null,
      idempotency_errored: "errored" in idemOutcome,
      user_exports_pruned: "count" in exportsOutcome ? exportsOutcome.count : null,
      user_exports_errored: "errored" in exportsOutcome,
      privacy_erased: erasedCount,
      privacy_sweeper_errored: sweeperErrored,
    }),
  );
}
