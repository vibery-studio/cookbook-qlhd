/**
 * @sentry/cloudflare stub. `@sentry/cloudflare@10.x` switched to a
 * `withSentry(handler)` HOC pattern that wraps the whole worker
 * export; the older top-level `Sentry.init(...)` API used in Phase
 * 10's original plan is gone. Wiring `withSentry` cleanly requires a
 * larger rework of `index.ts`'s default export than v1 blueprint is
 * ready to absorb.
 *
 * v1 policy: this adapter falls back to structured `console.error`
 * plus the `noop-reporter` shape when `SENTRY_DSN` is set. Errors
 * still ship via Logpush; they just don't reach Sentry until the
 * operator adopts `withSentry` per `docs/observability.md` (recipe
 * lands in v1.1).
 *
 * Never throws from `capture` — an outbound Sentry hiccup would
 * otherwise corrupt the app's error-handler contract.
 */
import type { Bindings } from "../env";
import { deepScrub } from "../observability/logger";
import type { ErrorContext, ErrorReporterPort } from "../ports/error-reporter-port";

export function createSentryReporter(env: Bindings): ErrorReporterPort {
  // Deliberately emits a `sentry-scaffold` line so operators see the
  // reporter fired and know to complete the withSentry wiring per
  // docs/observability.md before relying on Sentry ingestion.
  return {
    capture(err: unknown, ctx?: ErrorContext): void {
      try {
        const payload = deepScrub({
          ts: Date.now(),
          kind: "error.sentry_scaffold",
          note: "sentry-cloudflare@10 requires withSentry HOC wiring; adapter deferred to v1.1",
          dsn_present: env.SENTRY_DSN !== undefined && env.SENTRY_DSN !== "",
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
        // Serialization failure — swallow per port contract.
      }
    },
  };
}
