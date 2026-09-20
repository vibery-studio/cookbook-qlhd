/**
 * Cron-triggered sweeper. Runs every 5 minutes (wrangler.toml
 * `[triggers] crons = ["*\/5 * * * *"]`). Finds users who signed up
 * >15 minutes ago, are still `pending`, and have received fewer than
 * `MAX_RESENDS` verification emails. For each match: mint a fresh
 * verification token (previous one may already be expired), send a
 * new verify email, bump `verify_email_resend_count`.
 *
 * This is the durable backstop for the retry queue: even if Queues
 * drops messages or Resend is down for hours, unverified users
 * eventually get a fresh email until the resend cap is hit — at
 * which point manual admin intervention takes over.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { generateOpaqueToken, hashToken, VERIFICATION_TOKEN_BYTES } from "@runway/auth";
import type { Bindings } from "../env";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { insertVerificationToken } from "../dao/verification-token-dao";
import { createEmailPortWithRetry } from "../adapters/email-with-retry";

const STALE_PENDING_SECONDS = 900;      // 15 min
const VERIFY_TTL_SECONDS = 24 * 60 * 60; // 24h — mirror auth-service
const MAX_RESENDS = 3;                   // per-user cap
/**
 * Minimum gap between resends for the same user. Cron ticks every 5
 * minutes; without a cooldown, a user pending 20 min would receive 3
 * resends in 10 minutes (t=20/25/30) — indistinguishable from a
 * mail-loop bug to the recipient. The sweeper writes `updated_at`
 * on every bump, so gating on `updated_at < now - COOLDOWN` gives
 * roughly one resend every N minutes per user.
 */
const RESEND_COOLDOWN_SECONDS = 600;    // 10 min between resends per user
/**
 * Cap the amount of work the sweeper does per tick. If more than this
 * many stale users exist, we handle the oldest ones and let the next
 * tick pick up the rest — bounded operator cost, no runaway sweeps
 * during a backlog.
 */
const SWEEP_BATCH_SIZE = 100;

export async function verifyEmailSweeper(env: Bindings): Promise<void> {
  const db = getDb(env);
  const emailPort = createEmailPortWithRetry(env);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cutoff = nowSeconds - STALE_PENDING_SECONDS;

  // Query the oldest N pending, unverified users below the resend cap.
  // Drizzle doesn't support `<` on a `.notNull().default(0)` integer
  // column in an inline expression short-hand — use `lt(users.verifyEmailResendCount, MAX_RESENDS)`.
  const stale = await db
    .select({
      id: users.id,
      email: users.email,
      resendCount: users.verifyEmailResendCount,
    })
    .from(users)
    .where(
      and(
        eq(users.status, "pending"),
        isNull(users.verifiedAt),
        lt(users.createdAt, cutoff),
        lt(users.verifyEmailResendCount, MAX_RESENDS),
        // Cooldown: don't touch a user we already emailed within
        // RESEND_COOLDOWN_SECONDS. `updated_at` is bumped inside this
        // sweeper on every pass, so it doubles as the resend clock.
        lt(users.updatedAt, nowSeconds - RESEND_COOLDOWN_SECONDS),
      ),
    )
    .limit(SWEEP_BATCH_SIZE);

  if (stale.length === 0) return;

  let processed = 0;
  for (const user of stale) {
    try {
      // Mint a fresh verification token. Old tokens remain valid
      // until their own TTL — auth-service's `consumeVerificationToken`
      // is CAS-safe so races are harmless.
      const rawToken = generateOpaqueToken(VERIFICATION_TOKEN_BYTES);
      const tokenHash = hashToken(rawToken, env.TOKEN_PEPPER);
      await insertVerificationToken(db, {
        tokenHash,
        userId: user.id,
        purpose: "verify_email",
        expiresAt: nowSeconds + VERIFY_TTL_SECONDS,
        createdAt: nowSeconds,
      });

      const verifyUrl = `${env.APP_ORIGIN}/verify-email?token=${encodeURIComponent(rawToken)}`;

      const result = await emailPort.send({
        template: "verify-email",
        to: user.email,
        props: { userName: user.email, verifyUrl },
      });

      // Bump the resend slot ONLY when the adapter delivered
      // synchronously (or permanently failed — permanent failure
      // means the address is broken, so keep counting toward the cap
      // to prevent infinite sweep loops). Skip the bump when the
      // send was queued for retry: the retry pipeline owns the
      // eventual delivery and shouldn't cost the user a slot.
      let bumpSlot: boolean;
      if (!result.ok) {
        console.error(
          JSON.stringify({
            ts: Date.now(),
            kind: "email.sweeper.permanent_failure",
            user_id: user.id,
            reason: result.error.message,
          }),
        );
        bumpSlot = result.error.code !== "transient";
      } else {
        bumpSlot = result.value.provider !== "queued";
      }

      await db
        .update(users)
        .set({
          verifyEmailResendCount: bumpSlot
            ? user.resendCount + 1
            : user.resendCount,
          // Always bump updated_at so the cooldown gate keeps this
          // user out of the next tick's set even when the slot
          // itself didn't advance.
          updatedAt: nowSeconds,
        })
        .where(eq(users.id, user.id));
      processed++;
    } catch (err) {
      // One user's failure must not abort the rest of the batch.
      console.error(
        JSON.stringify({
          ts: Date.now(),
          kind: "email.sweeper.user_error",
          user_id: user.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  console.log(
    JSON.stringify({
      ts: Date.now(),
      kind: "email.sweeper.tick",
      processed,
      considered: stale.length,
    }),
  );
}
