import type { Bindings } from "../env";
import type { EmailMessage, EmailPort, EmailSendResult } from "../ports/email-port";
import {
  MAX_RETRY_ATTEMPTS,
  computeBackoffSeconds,
  type EmailRetryPayload,
} from "../services/email-service";
import { selectEmailAdapter } from "./email-select";

/**
 * Wraps the selected adapter with the retry-queue enqueue path.
 * `send()` returns `ok:true` for both "immediately delivered" AND
 * "transient failure → queued for retry" — from the caller's POV
 * (auth-service on signup), both are "will land eventually". Only
 * `permanent`/`validation` errors surface as `ok:false`.
 *
 * When enqueue itself fails (rare — Queues binding unavailable),
 * we return the original transient error so the caller can decide.
 */
export function createEmailPortWithRetry(env: Bindings): EmailPort {
  const now = (): number => Math.floor(Date.now() / 1000);

  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      // Resolve the raw adapter per-call so a settings change (e.g.
      // rotating `email.from_address`) takes effect on the next send
      // without a redeploy. `selectEmailAdapter` is cheap for the
      // noop path (just returns the module-scoped singleton); for
      // Resend it reads two KV keys (cached, 5-min TTL).
      const raw = await selectEmailAdapter(env);
      const result = await raw.send(message);
      if (result.ok) return result;

      if (result.error.code !== "transient") {
        // permanent / validation — do NOT retry. Caller decides
        // whether to log or fail. auth-service currently ignores
        // this and continues signup (verification is best-effort in
        // v1; cron sweeper backstops).
        return result;
      }

      // Transient: enqueue for retry with attempt=2 and 30s delay.
      const nextAttempt = 2;
      if (nextAttempt > MAX_RETRY_ATTEMPTS) {
        return result;
      }
      const payload: EmailRetryPayload = {
        v: 1,
        attempt: nextAttempt,
        firstAttemptAt: now(),
        message,
      };
      try {
        await env.EMAIL_RETRY_QUEUE.send(payload, {
          delaySeconds: computeBackoffSeconds(nextAttempt),
        });
      } catch {
        // Queue itself failed — return the transient error so caller
        // can log / audit. The cron sweeper still catches unverified
        // users >15min old.
        return result;
      }

      // Report `provider: "queued"` so downstream logic (e.g. the
      // sweeper) can distinguish "actually delivered" from "handed
      // off to the retry queue". auth-service treats both the same
      // (both are eventual delivery); sweeper skips the resend-count
      // bump on queued.
      return {
        ok: true,
        value: {
          messageId: `queued-attempt-${nextAttempt}`,
          provider: "queued",
        },
      };
    },
  };
}
