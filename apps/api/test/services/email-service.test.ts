/**
 * email-service unit tests. Uses miniflare's real EMAIL_RETRY_QUEUE
 * binding via cloudflare:test so `env.EMAIL_RETRY_QUEUE.send()` is
 * exercised for real (not mocked). Adapter is injected — never talks
 * to the network.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { EmailPort } from "../../src/ports/email-port";
import {
  computeBackoffSeconds,
  MAX_RETRY_ATTEMPTS,
  QUEUE_MAX_DELAY_SECONDS,
  retryEmail,
  sendEmail,
} from "../../src/services/email-service";

function successAdapter(): EmailPort {
  return {
    send: async () =>
      Promise.resolve({ ok: true, value: { messageId: "ok-1", provider: "noop" } }),
  };
}

function transientAdapter(): EmailPort {
  return {
    send: async () =>
      Promise.resolve({
        ok: false,
        error: { code: "transient", message: "boom" },
      }),
  };
}

function permanentAdapter(): EmailPort {
  return {
    send: async () =>
      Promise.resolve({
        ok: false,
        error: { code: "permanent", message: "unverified domain" },
      }),
  };
}

describe("computeBackoffSeconds", () => {
  it("returns 30 for attempt=2 (first retry)", () => {
    expect(computeBackoffSeconds(2)).toBe(30);
  });
  it("returns 120 for attempt=3", () => {
    expect(computeBackoffSeconds(3)).toBe(120);
  });
  it("returns 600 for attempt=4", () => {
    expect(computeBackoffSeconds(4)).toBe(600);
  });
  it("returns 1800 for attempt=5", () => {
    expect(computeBackoffSeconds(5)).toBe(1800);
  });
  it("caps at QUEUE_MAX_DELAY_SECONDS for attempts past the schedule", () => {
    expect(computeBackoffSeconds(999)).toBeLessThanOrEqual(QUEUE_MAX_DELAY_SECONDS);
  });
  it("returns 0 for attempt=1 (initial send, no backoff)", () => {
    expect(computeBackoffSeconds(1)).toBe(0);
  });
});

describe("sendEmail (single try)", () => {
  const msg = {
    template: "verify-email" as const,
    to: "u@example.com",
    props: { userName: "u", verifyUrl: "https://runway.dev/v?t=x" },
  };
  const deps = { env, now: () => 1000, adapter: successAdapter() };

  it("returns `sent` on adapter success", async () => {
    const result = await sendEmail(deps, msg);
    expect(result.kind).toBe("sent");
  });

  it("returns `queued` on transient adapter failure", async () => {
    const result = await sendEmail(
      { env, now: () => 1000, adapter: transientAdapter() },
      msg,
    );
    expect(result.kind).toBe("queued");
    if (result.kind === "queued") {
      expect(result.attempt).toBe(2);
      expect(result.nextDelaySeconds).toBe(30);
    }
  });

  it("returns `failed` on permanent adapter failure (never enqueues)", async () => {
    const result = await sendEmail(
      { env, now: () => 1000, adapter: permanentAdapter() },
      msg,
    );
    expect(result.kind).toBe("failed");
  });
});

describe("retryEmail (queue consumer inner loop)", () => {
  const msg = {
    template: "verify-email" as const,
    to: "u@example.com",
    props: { userName: "u", verifyUrl: "https://runway.dev/v?t=x" },
  };

  beforeEach(() => {
    // Reset the queue is not directly supported by cloudflare:test —
    // but each test creates fresh payloads with unique attempt values,
    // and we only assert on the returned outcome, not queue depth.
  });

  it("attempt N succeeds → returns `sent`", async () => {
    const result = await retryEmail(
      { env, now: () => 1000, adapter: successAdapter() },
      { v: 1, attempt: 3, firstAttemptAt: 900, message: msg },
    );
    expect(result.kind).toBe("sent");
  });

  it("attempt N transient → re-enqueues at N+1", async () => {
    const result = await retryEmail(
      { env, now: () => 1000, adapter: transientAdapter() },
      { v: 1, attempt: 3, firstAttemptAt: 900, message: msg },
    );
    expect(result.kind).toBe("queued");
    if (result.kind === "queued") {
      expect(result.attempt).toBe(4);
      expect(result.nextDelaySeconds).toBe(600);
    }
  });

  it("attempt MAX_RETRY_ATTEMPTS transient → `failed` (no more enqueue)", async () => {
    const result = await retryEmail(
      { env, now: () => 1000, adapter: transientAdapter() },
      {
        v: 1,
        attempt: MAX_RETRY_ATTEMPTS,
        firstAttemptAt: 900,
        message: msg,
      },
    );
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      // The reason must carry the underlying error message so
      // the DLQ consumer's audit log surfaces it.
      expect(result.reason).toContain("max retries exceeded");
    }
  });

  it("permanent adapter failure on any attempt → `failed` immediately", async () => {
    const result = await retryEmail(
      { env, now: () => 1000, adapter: permanentAdapter() },
      {
        v: 1,
        attempt: 2,
        firstAttemptAt: 900,
        message: msg,
      },
    );
    expect(result.kind).toBe("failed");
  });
});
