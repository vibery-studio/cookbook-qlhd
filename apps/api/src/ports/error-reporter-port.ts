/**
 * Provider-agnostic error reporter. Every unhandled error runs through
 * this port. `NoopReporter` is the default when `SENTRY_DSN` is unset
 * — errors still land in `console.error` for Logpush; the reporter
 * layer is additive.
 *
 * `capture(err, ctx)` MUST NOT throw. Reporter failures are logged
 * via `console.error` inside the adapter, never propagated to the
 * calling error handler.
 */
export interface ErrorContext {
  /** The incoming request id from the request-id middleware. */
  requestId?: string;
  /** Authenticated principal id, if any. */
  principalId?: string | null;
  /** URL of the failing request. */
  url?: string;
  /** HTTP method. */
  method?: string;
  /** Additional structured metadata; deep-scrubbed by the adapter. */
  metadata?: Record<string, unknown>;
}

export interface ErrorReporterPort {
  capture(err: unknown, ctx?: ErrorContext): void;
}
