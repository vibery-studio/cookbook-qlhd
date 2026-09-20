import { z } from "zod";

/**
 * Per-template Zod prop schemas. `renderTemplate` validates the input
 * against the matching schema BEFORE React sees the props — so a stray
 * unstructured value can never reach the template body (and, via that,
 * the rendered HTML).
 *
 * URL fields are typed as `z.string()` here — the allowlist check runs
 * separately in `render.ts` because Zod cannot know `appOrigin` at
 * schema-definition time. Callers of `renderTemplate` supply `appOrigin`
 * per-render and the URL check is applied after Zod validation.
 */

export const VerifyEmailPropsSchema = z
  .object({
    userName: z.string().min(1).max(256),
    verifyUrl: z.string().min(1).max(2048),
  })
  .strict();

export const PasswordResetPropsSchema = z
  .object({
    userName: z.string().min(1).max(256),
    resetUrl: z.string().min(1).max(2048),
    expiresIn: z.string().min(1).max(64),
  })
  .strict();

export type VerifyEmailProps = z.infer<typeof VerifyEmailPropsSchema>;
export type PasswordResetProps = z.infer<typeof PasswordResetPropsSchema>;

export const TEMPLATE_NAMES = ["password-reset", "verify-email"] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/**
 * Discriminated union at the render boundary. `EmailPort` in apps/api
 * uses the same shape so its compile-time enforcement flows all the
 * way to this package.
 */
export type TemplatePropsUnion =
  | { template: "verify-email"; props: VerifyEmailProps }
  | { template: "password-reset"; props: PasswordResetProps };
