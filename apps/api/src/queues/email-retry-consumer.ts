/**
 * Retry queue consumer. Reads a batch of `EmailRetryPayload` messages,
 * calls `retryEmail` on each, `ack`s successes + `queued`s (they get
 * re-enqueued inside retryEmail with the correct next delay), and
 * `retry`s hard failures WITHOUT delay — but only if `attempt <
 * MAX_RETRY_ATTEMPTS`. When exhaustion is reached, `retryEmail`
 * returns `failed`; the consumer explicitly ack's (removing the
 * message from the retry queue) and lets CF forward to the DLQ via
 * the `dead_letter_queue` binding on the queue consumer config.
 *
 * NOTE: CF Queues also handles retry via the platform-level
 * `max_retries` setting on the consumer binding. We do NOT rely on
 * that — the exponential-backoff shape must be application-controlled,
 * so we ack every batch entry ourselves and re-enqueue with the
 * calculated `delaySeconds`.
 */
import type { Bindings } from "../env";
import { retryEmail, type EmailRetryPayload } from "../services/email-service";

/**
 * Type of message the queue delivers to us. Cloudflare's built-in
 * `MessageBatch` is generic; we narrow to our payload shape.
 */
type EmailRetryBatch = MessageBatch<EmailRetryPayload>;

export async function emailRetryConsumer(
  batch: EmailRetryBatch,
  env: Bindings,
): Promise<void> {
  const now = (): number => Math.floor(Date.now() / 1000);

  for (const msg of batch.messages) {
    try {
      const result = await retryEmail({ env, now }, msg.body);
      if (result.kind === "failed") {
        // Exhausted app-level retries (MAX_RETRY_ATTEMPTS). Push
        // the payload to the app-managed DLQ producer binding, then
        // ack() the retry-queue message so it's removed. This is
        // the DLQ hand-off the phase spec required — the built-in
        // `dead_letter_queue = "email-dlq"` on the consumer only
        // fires from CF's platform retry path (msg.retry() +
        // max_retries), which is a different (and shorter) trigger
        // than our app-level attempt cap. Both paths land on the
        // same `email-dlq` queue name, so operator inspection is
        // uniform.
        try {
          await env.EMAIL_DLQ_QUEUE.send({
            ...msg.body,
            finalReason: result.reason,
            finalAttemptAt: now(),
          });
        } catch (dlqErr) {
          // DLQ enqueue failed — log so operator sees the drop.
          // Message is still ack()ed to avoid an infinite loop on
          // a broken DLQ binding.
          console.error(
            JSON.stringify({
              ts: Date.now(),
              kind: "email.retry.dlq_enqueue_failed",
              template: msg.body.message.template,
              to: msg.body.message.to,
              attempts: msg.body.attempt,
              dlq_error:
                dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
              final_reason: result.reason,
            }),
          );
        }
        msg.ack();
      } else {
        // `sent` or `queued` — either way, this batch entry is done.
        // Queued messages re-enter EMAIL_RETRY_QUEUE via the send()
        // call inside retryEmail (with the correct next delay).
        msg.ack();
      }
    } catch (err) {
      // Unexpected exception (e.g., adapter threw synchronously in a
      // way we didn't catch). Retry via CF's platform retry — max 3
      // attempts, then DLQ. This is the safety net for programming
      // errors, not the normal retry path.
      msg.retry();
      // Log for observability (Phase 10 wires Logpush + Sentry).
      console.error(
        JSON.stringify({
          ts: Date.now(),
          kind: "email.retry.consumer.error",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
