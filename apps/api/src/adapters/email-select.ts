import type { Bindings } from "../env";
import type { EmailPort } from "../ports/email-port";
import { noopEmailAdapter } from "./email-noop";
import { createResendAdapter } from "./email-resend";

/**
 * Selects the email adapter based on `env.EMAIL_PROVIDER`. Zero code
 * changes to swap providers — flip the env var, redeploy.
 *
 * The noop adapter is intentionally the DEFAULT for anything other
 * than `resend`: if a deployment forgets to set the provider, we do
 * not silently downgrade a real production send into a lost message
 * (`resend`), and we do not spam Resend with dev traffic. Instead we
 * log to the ring buffer and fail-visibly when a test asserts an
 * email was sent.
 *
 * Placeholder from-address defaults (`no-reply@example.com`) intentionally
 * bounce in real deployments — `docs/email.md` mandates a verified
 * domain before production use.
 */
const DEFAULT_FROM_NAME = "Runway";
const DEFAULT_FROM_ADDRESS = "no-reply@example.com";

export function selectEmailAdapter(env: Bindings): EmailPort {
  if (env.EMAIL_PROVIDER !== "resend") return noopEmailAdapter;

  const apiKey = env.RESEND_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    // Configuration error: EMAIL_PROVIDER=resend but no key. Fall back
    // to noop rather than crashing on every send call — the audit-log
    // + observability stack (Phase 10) will flag "noop in production"
    // as an alert.
    return noopEmailAdapter;
  }

  return createResendAdapter({
    apiKey,
    fromAddress: DEFAULT_FROM_ADDRESS,
    fromName: DEFAULT_FROM_NAME,
    appOrigin: env.APP_ORIGIN,
  });
}
