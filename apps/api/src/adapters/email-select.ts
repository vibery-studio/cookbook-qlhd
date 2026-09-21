import type { Bindings } from "../env";
import type { EmailMessage, EmailPort, EmailSendResult } from "../ports/email-port";
import { SettingsService } from "../settings/settings-service";
import { FlagsService } from "../flags/flags-service";
import { createAuditLogger } from "../observability/logger";
import { getDb } from "../db/client";
import { noopEmailAdapter } from "./email-noop";
import { createResendAdapter } from "./email-resend";
import { generateUlid } from "../utils/id";

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
/**
 * Rate-limited audit shim for the `email.enabled=false` kill switch.
 * A degraded operator turning it OFF under high-signup traffic would
 * otherwise emit hundreds of audit lines per minute. Module-scoped
 * timestamp bounds emissions to one per KILL_SWITCH_AUDIT_INTERVAL_MS
 * window across every send that lands in the same isolate.
 */
const KILL_SWITCH_AUDIT_INTERVAL_MS = 60_000;
let lastKillSwitchAuditAt = 0;

function auditKillSwitchIfDue(): void {
  const now = Date.now();
  if (now - lastKillSwitchAuditAt < KILL_SWITCH_AUDIT_INTERVAL_MS) return;
  lastKillSwitchAuditAt = now;
  const audit = createAuditLogger({ ctx: undefined });
  audit(
    {
      actor: "system",
      action: "flag.kill_switch_active",
      target: "flag:email.enabled",
      metadata: { rate_limit_ms: KILL_SWITCH_AUDIT_INTERVAL_MS },
    },
    { sync: true },
  );
}

/**
 * The kill-switch adapter is DEEPER than `noopEmailAdapter`: it neither
 * buffers the message nor logs a per-send line. Callers that assert
 * "no email was queued" (tests + operational alerts) get a clean
 * signal, and a hot signup path under a killed switch does not accrue
 * hundreds of unread ring-buffer entries. The rate-limited audit event
 * is the single durable trace.
 */
const killSwitchEmailAdapter: EmailPort = {
  send(message: EmailMessage): Promise<EmailSendResult> {
    // Message is intentionally dropped — the kill switch is on. We
    // reference it so lint knows the parameter is consumed; the rate-
    // limited audit event above records the fact of a drop.
    void message.template;
    // Marker id makes accidental production sends via this path easy
    // to spot in Logpush ("provider":"kill-switch").
    return Promise.resolve({
      ok: true,
      value: { messageId: generateUlid(), provider: "kill-switch" },
    });
  },
};

export async function selectEmailAdapter(env: Bindings): Promise<EmailPort> {
  // Kill-switch check runs before provider selection — even the noop
  // provider is squelched to a silent send when `email.enabled=false`
  // so tests can assert "no outbound message" symmetrically across
  // adapters. The audit event names the switch that fired, rate-limited
  // to 1/min to avoid log spam on a hot signup path.
  const flags = new FlagsService({ db: getDb(env), kv: env.SETTINGS });
  const emailEnabled = await flags.get("email.enabled");
  if (!emailEnabled) {
    auditKillSwitchIfDue();
    return killSwitchEmailAdapter;
  }

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
