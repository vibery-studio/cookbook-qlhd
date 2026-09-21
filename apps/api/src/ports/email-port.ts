import type {
  PasswordResetProps,
  VerifyEmailProps,
} from "@runway/email-templates";

/**
 * Provider-agnostic email port. Discriminated union on `template` —
 * TS compiler forces callers to pass the right props per template, and
 * Zod runtime validation lives in `@runway/email-templates/render.ts`.
 *
 * Prop shapes are re-exported from `@runway/email-templates` to keep
 * one source of truth: the auth service constructs an `EmailMessage`,
 * the email service passes `msg.props` straight to `renderTemplate`
 * which parses it through the same Zod schema.
 */
export type EmailMessage =
  | { template: "verify-email"; to: string; props: VerifyEmailProps }
  | { template: "password-reset"; to: string; props: PasswordResetProps };

export interface EmailSent {
  messageId: string;
  /**
   * `resend` / `noop` = the raw adapter delivered synchronously.
   * `queued` = the retry-wrapper accepted the message and pushed it
   * to `EMAIL_RETRY_QUEUE` on a transient failure. Callers that want
   * "was it *actually* delivered right now?" MUST check for `queued`
   * (e.g., the cron sweeper should not charge a resend slot for a
   * queued send — see `crons/verify-email-sweeper.ts`).
   * `kill-switch` = the `email.enabled` flag was OFF; the message
   * was intentionally dropped without buffering. Callers that treat
   * a successful send as "the user received it" MUST also treat
   * `kill-switch` as a no-op (e.g., the resend cooldown should still
   * apply since we cannot tell the user we sent nothing).
   */
  provider: "resend" | "noop" | "queued" | "kill-switch";
}

/**
 * Error classification determines routing:
 *   - `transient`   → retry queue with exponential backoff
 *   - `permanent`   → DLQ + sync audit (bad recipient, revoked domain)
 *   - `validation`  → DLQ immediately; message would never render
 */
export interface EmailError {
  code: "transient" | "permanent" | "validation";
  message: string;
}

export type EmailSendResult =
  | { ok: true; value: EmailSent }
  | { ok: false; error: EmailError };

export interface EmailPort {
  send(msg: EmailMessage): Promise<EmailSendResult>;
}
