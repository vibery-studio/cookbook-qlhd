import type { EmailMessage, EmailPort, EmailSendResult } from "../ports/email-port";
import { generateUlid } from "../utils/id";

/**
 * Noop email adapter: appends outbound messages to an in-memory ring
 * buffer + logs a structured line. Never actually sends. Used by:
 *   - local dev (EMAIL_PROVIDER=noop in .dev.vars)
 *   - integration tests (assert what would have been sent)
 *
 * Buffer is module-scoped, so tests running in the same isolate share it.
 * `resetNoopEmailBuffer()` clears between tests.
 */

const RING_CAPACITY = 100;
const buffer: EmailMessage[] = [];

export const noopEmailAdapter: EmailPort = {
  send(msg: EmailMessage): Promise<EmailSendResult> {
    buffer.push(msg);
    if (buffer.length > RING_CAPACITY) buffer.shift();
    // Structured log so Logpush captures the fact that a "send" happened.
    // No PII beyond `to` — sender is inspecting behavior, not content.
    console.log(
      JSON.stringify({
        ts: Date.now(),
        kind: "email.send.noop",
        template: msg.template,
        to: msg.to,
      }),
    );
    return Promise.resolve({
      ok: true,
      value: { messageId: generateUlid(), provider: "noop" },
    });
  },
};

export function getNoopSentEmails(): readonly EmailMessage[] {
  return buffer.slice();
}

export function resetNoopEmailBuffer(): void {
  buffer.length = 0;
}
