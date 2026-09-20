import type { Bindings } from "../env";
import type { ErrorReporterPort } from "../ports/error-reporter-port";
import { noopReporter } from "./noop-reporter";
import { createSentryReporter } from "./sentry-reporter";

/**
 * Selects the error reporter based on `env.SENTRY_DSN`. Missing/empty
 * DSN → noop (structured `console.error` only, still captured by
 * Logpush). Present DSN → real Sentry adapter.
 *
 * Cheap to call per-request — the Sentry adapter's `init` runs on
 * every call but is idempotent within an isolate. If perf ever
 * becomes an issue, memoize per-isolate.
 */
export function selectErrorReporter(env: Bindings): ErrorReporterPort {
  if (env.SENTRY_DSN === undefined || env.SENTRY_DSN === "") {
    return noopReporter;
  }
  return createSentryReporter(env);
}
