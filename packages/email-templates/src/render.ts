import { render } from "@react-email/render";
import { createElement } from "react";
import { PasswordReset, PASSWORD_RESET_SUBJECT } from "./password-reset";
import {
  PasswordResetPropsSchema,
  VerifyEmailPropsSchema,
  type TemplateName,
  type TemplatePropsUnion,
} from "./prop-schemas";
import { sanitizeUrl, UnsafeUrlError } from "./url-allowlist";
import { VerifyEmail, VERIFY_EMAIL_SUBJECT } from "./verify-email";

/**
 * Rendered email payload. `html` is the multipart alternative;
 * `text` is a plain-text fallback derived by `@react-email/render`
 * so recipients with HTML disabled still see the CTA.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** `env.APP_ORIGIN`. Every URL prop must match this origin (or be
 * some other https:// URL if origin-locking is disabled by passing
 * `""`). See `url-allowlist.ts`. */
export type RenderInput = TemplatePropsUnion & { appOrigin: string };

/**
 * `renderTemplate` is the ONE entry point templates get rendered
 * through. It validates props against the per-template Zod schema,
 * passes URL fields through `sanitizeUrl`, then invokes React Email.
 *
 * Throws:
 *   - `z.ZodError` if props fail schema
 *   - `UnsafeUrlError` if a URL fails the allowlist
 *   - anything React Email throws (very rare)
 *
 * These throws are load-bearing: callers (email-service) catch them
 * and classify — Zod/UnsafeUrl errors are `permanent` (the message
 * would never render), which routes straight to DLQ instead of the
 * transient retry queue.
 */
export async function renderTemplate(input: RenderInput): Promise<RenderedEmail> {
  if (input.template === "verify-email") {
    const props = VerifyEmailPropsSchema.parse(input.props);
    const verifyUrl = sanitizeUrl(props.verifyUrl, input.appOrigin);
    const element = createElement(VerifyEmail, { ...props, verifyUrl });
    const [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true }),
    ]);
    return { subject: VERIFY_EMAIL_SUBJECT, html, text };
  }

  // input.template === "password-reset" — TypeScript narrows via
  // the discriminated union.
  const props = PasswordResetPropsSchema.parse(input.props);
  const resetUrl = sanitizeUrl(props.resetUrl, input.appOrigin);
  const element = createElement(PasswordReset, { ...props, resetUrl });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject: PASSWORD_RESET_SUBJECT, html, text };
}

export { UnsafeUrlError };
export type { TemplateName };
