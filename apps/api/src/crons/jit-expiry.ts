/**
 * Every 5 minutes (cron "*\/5 * * * *") — JIT expiry logger (SPEC-07 §3.3, DEC-8). Access is already cut per request by `valid_until`;
 * this tick only writes `jit.expired` once per grant and purges the recipient's cache (jit-service). Missed ticks
 * catch up (`expiry_logged_at IS NULL`). `nowSeconds` is injected so tests drive the clock.
 */
import type { Bindings } from "../env";
import { getDb } from "../db/client";
import { sweepExpiredJit } from "../services/jit-service";

export async function runJitExpiry(env: Bindings, nowSeconds: number): Promise<void> {
  const deps = { db: getDb(env), kv: env.SESSIONS, now: () => nowSeconds };
  try {
    const expired = await sweepExpiredJit(deps, nowSeconds);
    console.log(JSON.stringify({ ts: Date.now(), kind: "cron.jit_expiry.tick", expired }));
  } catch (err: unknown) {
    console.error(
      JSON.stringify({ ts: Date.now(), kind: "error.cron.jit_expiry", error: err instanceof Error ? err.message : String(err) }),
    );
  }
}
