/**
 * Email service — the single entry point auth/admin/anything-else uses
 * to send a template. Wraps the adapter selection + retry-queue
 * enqueue on transient failure. Callers pass an `EmailMessage`
 * (discriminated union); the service handles rendering, adapter
 * dispatch, error classification, and retry scheduling.
 *
 * Non-transient errors (Zod / URL / permanent 4xx) do NOT enqueue —
 * they go straight to the DLQ path (returned as `{kind: "failed"}`)
 * so the caller can decide whether to fail the parent operation.
 */
import type { EmailMessage, EmailPort, EmailSendResult } from "../ports/email-port";
import type { Bindings } from "../env";
import { selectEmailAdapter } from "../adapters/email-select";

/**
 * Retry queue payload. Versioned so a future v2 shape can coexist
 * with in-flight v1 messages during a rolling deploy.
 */
export interface EmailRetryPayload {
  v: 1;
  attempt: number;
  firstAttemptAt: number;
  message: EmailMessage;
}

/**
 * Exponential backoff schedule, capped by CF Queues' per-message
 * `delaySeconds` limit (43200s = 12h as of 2025). Schedule:
 *   attempt 1 fail → 30s
 *   attempt 2 fail → 2min
 *   attempt 3 fail → 10min
 *   attempt 4 fail → 30min
 *   attempt 5 fail → DLQ
 *
 * `computeBackoffSeconds(attempt)` returns the delay BEFORE the given
 * `attempt` runs (so attempt=2 → 30, meaning "wait 30s after attempt
 * 1 failed").
 */
export const QUEUE_MAX_DELAY_SECONDS = 43_200;
export const MAX_RETRY_ATTEMPTS = 5;

const BACKOFF_SCHEDULE_SECONDS = [30, 120, 600, 1800] as const;

export function computeBackoffSeconds(nextAttempt: number): number {
  const idx = nextAttempt - 2;
  if (idx < 0) return 0;
  const desired =
    idx < BACKOFF_SCHEDULE_SECONDS.length
      ? BACKOFF_SCHEDULE_SECONDS[idx]!
      : BACKOFF_SCHEDULE_SECONDS[BACKOFF_SCHEDULE_SECONDS.length - 1]!;
  return Math.min(desired, QUEUE_MAX_DELAY_SECONDS);
}

export interface EmailServiceDeps {
  env: Bindings;
  /** Injectable for tests; falls back to `selectEmailAdapter(env)`. */
  adapter?: EmailPort;
  now: () => number;
}

export type EmailServiceResult =
  | {
      kind: "sent";
      messageId: string;
      provider: "resend" | "noop" | "queued" | "kill-switch";
    }
  | { kind: "queued"; attempt: number; nextDelaySeconds: number }
  | { kind: "failed"; reason: string };

/**
 * Send an email. Return codes:
 *   - `sent`   — adapter accepted immediately
 *   - `queued` — transient error; enqueued for retry (attempt=2)
 *   - `failed` — permanent/validation error; NOT retried
 *
 * Callers that need the audit trail (auth-service on signup) should
 * treat `sent` + `queued` as success (the email will land eventually)
 * and `failed` as a caller-side decision.
 */
export async function sendEmail(
  deps: EmailServiceDeps,
  message: EmailMessage,
): Promise<EmailServiceResult> {
  const adapter = deps.adapter ?? (await selectEmailAdapter(deps.env));
  const result = await adapter.send(message);
  return classifyAndDispatch(deps, message, result, 1);
}

/**
 * Retry entry point used by the queue consumer. `attempt` is the
 * attempt number to run RIGHT NOW; if it succeeds we're done, if it
 * fails and we've hit `MAX_RETRY_ATTEMPTS` we return `failed`
 * (consumer forwards to DLQ), else we enqueue for the next attempt.
 */
export async function retryEmail(
  deps: EmailServiceDeps,
  payload: EmailRetryPayload,
): Promise<EmailServiceResult> {
  const adapter = deps.adapter ?? (await selectEmailAdapter(deps.env));
  const result = await adapter.send(payload.message);
  return classifyAndDispatch(deps, payload.message, result, payload.attempt);
}

async function classifyAndDispatch(
  deps: EmailServiceDeps,
  message: EmailMessage,
  result: EmailSendResult,
  currentAttempt: number,
): Promise<EmailServiceResult> {
  if (result.ok) {
    return {
      kind: "sent",
      messageId: result.value.messageId,
      provider: result.value.provider,
    };
  }

  // Permanent / validation errors never retry.
  if (result.error.code !== "transient") {
    return { kind: "failed", reason: result.error.message };
  }

  const nextAttempt = currentAttempt + 1;
  if (nextAttempt > MAX_RETRY_ATTEMPTS) {
    return { kind: "failed", reason: `max retries exceeded: ${result.error.message}` };
  }

  const delaySeconds = computeBackoffSeconds(nextAttempt);
  const payload: EmailRetryPayload = {
    v: 1,
    attempt: nextAttempt,
    firstAttemptAt: deps.now(),
    message,
  };

  await deps.env.EMAIL_RETRY_QUEUE.send(payload, { delaySeconds });

  return { kind: "queued", attempt: nextAttempt, nextDelaySeconds: delaySeconds };
}
