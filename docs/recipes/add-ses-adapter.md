# Recipe: Add an SES Adapter (v2)

v1 blueprint ships Resend + Noop only. Amazon SES requires AWS SigV4
request signing — never hand-roll this. Use `aws4fetch`, the tiny
Workers-compatible SigV4 signer maintained by Cloudflare.

## Steps

1. **Install**:
   ```bash
   pnpm --filter @runway/api add aws4fetch
   ```
2. **Adapter** — mirror `email-resend.ts` shape:
   ```ts
   // apps/api/src/adapters/email-ses.ts
   import { AwsClient } from "aws4fetch";
   import { renderTemplate, UnsafeUrlError } from "@runway/email-templates";
   import { z } from "zod";
   import type { EmailMessage, EmailPort, EmailSendResult } from "../ports/email-port";

   export interface SesAdapterOptions {
     accessKeyId: string;
     secretAccessKey: string;
     region: string;             // e.g., "us-east-1"
     fromAddress: string;
     fromName: string;
     appOrigin: string;
   }

   const SES_ENDPOINT = (region: string) => `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
   const SesSuccessSchema = z.object({ MessageId: z.string().min(1) });

   export function createSesAdapter(opts: SesAdapterOptions): EmailPort {
     const aws = new AwsClient({
       accessKeyId: opts.accessKeyId,
       secretAccessKey: opts.secretAccessKey,
       service: "ses",
       region: opts.region,
     });
     return {
       async send(msg: EmailMessage): Promise<EmailSendResult> {
         let rendered;
         try {
           rendered = msg.template === "verify-email"
             ? await renderTemplate({ template: "verify-email", appOrigin: opts.appOrigin, props: msg.props })
             : await renderTemplate({ template: "password-reset", appOrigin: opts.appOrigin, props: msg.props });
         } catch (err) {
           if (err instanceof UnsafeUrlError || err instanceof z.ZodError) {
             return { ok: false, error: { code: "validation", message: err.message } };
           }
           return { ok: false, error: { code: "validation", message: String(err) } };
         }
         const body = {
           FromEmailAddress: `${opts.fromName} <${opts.fromAddress}>`,
           Destination: { ToAddresses: [msg.to] },
           Content: {
             Simple: {
               Subject: { Data: rendered.subject, Charset: "UTF-8" },
               Body: {
                 Html: { Data: rendered.html, Charset: "UTF-8" },
                 Text: { Data: rendered.text, Charset: "UTF-8" },
               },
             },
           },
         };
         let response: Response;
         try {
           response = await aws.fetch(SES_ENDPOINT(opts.region), {
             method: "POST",
             headers: { "content-type": "application/json" },
             body: JSON.stringify(body),
           });
         } catch (err) {
           return { ok: false, error: { code: "transient", message: `network: ${String(err)}` } };
         }
         if (response.status >= 500) {
           return { ok: false, error: { code: "transient", message: `ses ${response.status}` } };
         }
         if (response.status >= 400) {
           const code = response.status === 429 ? "transient" : "permanent";
           return { ok: false, error: { code, message: `ses ${response.status}` } };
         }
         const parsed = SesSuccessSchema.safeParse(await response.json());
         if (!parsed.success) {
           return { ok: false, error: { code: "transient", message: "unexpected ses body" } };
         }
         return { ok: true, value: { messageId: parsed.data.MessageId, provider: "resend" as const } };
       },
     };
   }
   ```
   Note: `provider: "resend"` — `EmailSent.provider` type is a two-value
   union in v1. Widen it to `"resend" | "noop" | "ses"` in
   `email-port.ts` when SES lands. Every consumer that pattern-matches on
   `provider` (audit logs, Sentry tags) needs a `case "ses":` branch.
3. **Selector** — extend `adapters/email-select.ts`:
   ```ts
   if (env.EMAIL_PROVIDER === "ses") {
     if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_REGION) {
       return noopEmailAdapter;
     }
     return createSesAdapter({
       accessKeyId: env.AWS_ACCESS_KEY_ID,
       secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
       region: env.AWS_REGION,
       fromAddress: DEFAULT_FROM_ADDRESS,
       fromName: DEFAULT_FROM_NAME,
       appOrigin: env.APP_ORIGIN,
     });
   }
   ```
4. **Env schema** — add the three AWS fields to `apps/api/src/env.ts`
   as `z.string().optional()`. `EMAIL_PROVIDER` union: add `"ses"`.
5. **Secrets** — `wrangler secret put AWS_SECRET_ACCESS_KEY` in each
   env. `AWS_ACCESS_KEY_ID` + `AWS_REGION` can go in `[vars]` since
   they're not sensitive.
6. **SES-side setup**:
   - Verify the sending domain (SPF + DKIM).
   - Move out of the sandbox (submit production access request).
   - Create an IAM user with `ses:SendEmail` on the verified identity.
   - Rotate keys via Secrets Manager rotation if in prod.
7. **Test** — mirror `email-resend.test.ts` (not yet written in v1;
   see the recipe in Phase 11 `docs/recipes/add-adapter-test.md`).

## Why aws4fetch (not hand-rolled SigV4)

- ~2KB minified, no dependencies
- Workers-compatible (no Node crypto assumptions)
- Actively maintained by Cloudflare
- Signs `fetch` calls transparently — same shape as native `fetch`

Hand-rolling SigV4 requires: canonical request construction, HMAC-SHA256
chained key derivation, exact header ordering, and query-string
canonicalization. Any bug produces `SignatureDoesNotMatch` with no
useful error, and there's zero payoff over `aws4fetch`.
