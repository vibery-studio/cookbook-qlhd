import type { Bindings } from "../env";
import type { EmailPort } from "../ports/email-port";
import { SettingsService } from "../settings/settings-service";
import { getDb } from "../db/client";
import { noopEmailAdapter } from "./email-noop";
import { createResendAdapter } from "./email-resend";

/**
 * Selects the email adapter based on `env.EMAIL_PROVIDER`. Zero code
 * changes to swap providers — flip the env var, redeploy. The Resend
 * adapter's from-address + from-name come from the settings registry
 * (with a sensible default seeded by migration 0003), so an operator
 * can change them without a redeploy.
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
export async function selectEmailAdapter(env: Bindings): Promise<EmailPort> {
  if (env.EMAIL_PROVIDER !== "resend") return noopEmailAdapter;

  const apiKey = env.RESEND_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    // Configuration error: EMAIL_PROVIDER=resend but no key. Fall back
    // to noop rather than crashing on every send call — the audit-log
    // + observability stack (Phase 10) will flag "noop in production"
    // as an alert.
    return noopEmailAdapter;
  }

  const settings = new SettingsService({ db: getDb(env), kv: env.SETTINGS });
  const [fromAddress, fromName] = await Promise.all([
    settings.get("email.from_address"),
    settings.get("email.from_name"),
  ]);

  return createResendAdapter({
    apiKey,
    fromAddress,
    fromName,
    appOrigin: env.APP_ORIGIN,
  });
}
