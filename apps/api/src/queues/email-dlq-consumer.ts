/**
 * DLQ consumer. Any message that reaches `email-dlq` has permanently
 * failed — retry exhausted, permanent classification, or an
 * unexpected exception during retry-consumer processing. This
 * consumer's job is purely observability: sync audit log + Sentry
 * capture (Phase 10 wires the real destinations).
 *
 * Never re-enqueue from here. If DLQ messages need reprocessing,
 * that's an operator decision executed via a script that reads
 * from DLQ and re-enqueues to the primary queue — NOT an automatic
 * flow this consumer performs.
 *
 * Wire-up: this file exports a handler; the actual queue binding is
 * added in a separate `wrangler.toml` block when we activate a DLQ
 * consumer (v1 leaves DLQ as sink-only, no consumer, which is a valid
 * pattern — messages accumulate for operator inspection via
 * `wrangler queues consumer email-dlq peek`).
 */
import type { EmailRetryPayload } from "../services/email-service";

/**
 * DLQ payload — extends the retry payload with the reason the
 * app-level retry consumer gave up. Optional because a message that
 * reaches this queue via CF's `dead_letter_queue` (platform retry
 * exhaustion, not app-level) may not carry these fields.
 */
export type EmailDlqPayload = EmailRetryPayload & {
  finalReason?: string;
  finalAttemptAt?: number;
};

export function emailDlqConsumer(
  batch: MessageBatch<EmailDlqPayload>,
): void {
  for (const msg of batch.messages) {
    // Structured audit log — Phase 9 replaces console with a real
    // audit sink; Phase 10 pipes to Sentry. Fields chosen to answer
    // "which user, which template, how many attempts, first-seen
    // timestamp" during an operator triage.
    console.error(
      JSON.stringify({
        ts: Date.now(),
        kind: "email.send.dlq",
        template: msg.body.message.template,
        to: msg.body.message.to,
        attempts: msg.body.attempt,
        firstAttemptAt: msg.body.firstAttemptAt,
      }),
    );
    // Ack so the DLQ message is removed. If the operator wants a
    // permanent record, Logpush captures the audit line above.
    msg.ack();
  }
}
