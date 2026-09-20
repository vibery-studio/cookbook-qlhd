import { deepScrub } from "../observability/logger";
import type { ErrorContext, ErrorReporterPort } from "../ports/error-reporter-port";

/**
 * Reporter implementation used when `SENTRY_DSN` is unset. Emits a
 * structured `console.error` line so Logpush still ingests the error
 * with the same shape as normal audit / request logs. Payload runs
 * through deepScrub before serialization — defense-in-depth against
 * error messages / stacks / metadata that inadvertently include
 * sensitive values. Never throws.
 */
export const noopReporter: ErrorReporterPort = {
  capture(err: unknown, ctx?: ErrorContext): void {
    try {
      const payload = deepScrub({
        ts: Date.now(),
        kind: "error.noop_reporter",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        request_id: ctx?.requestId,
        principal_id: ctx?.principalId,
        method: ctx?.method,
        url: ctx?.url,
        metadata: ctx?.metadata,
      });
      console.error(JSON.stringify(payload));
    } catch {
      // Serialization failure would be extraordinary — swallow so
      // the reporter contract of "never throws" holds.
    }
  },
};
