/**
 * Provider-agnostic email port. Phase 7 (Email Adapters) wires the real
 * Resend + Noop adapters + Cloudflare Queue retry pipeline; this file
 * declares only the interface so Phase 5 auth-service can call
 * `emailPort.send({...})` today.
 *
 * Discriminated union on `template` — TS compiler forces callers to pass
 * the right props for each template, and Zod prop-schema validation
 * happens inside the render step (also Phase 7).
 */

export type EmailMessage =
  | {
      template: "verify-email";
      to: string;
      props: { userName: string; verifyUrl: string };
    }
  | {
      template: "password-reset";
      to: string;
      props: { userName: string; resetUrl: string; expiresIn: string };
    };

export interface EmailSent {
  messageId: string;
  provider: "resend" | "noop";
}

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
