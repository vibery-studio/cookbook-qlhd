import { renderTemplate, UnsafeUrlError } from "@runway/email-templates";
import { z } from "zod";
import type {
  EmailMessage,
  EmailPort,
  EmailSendResult,
} from "../ports/email-port";

/**
 * Resend HTTP adapter. Posts to `https://api.resend.com/emails` with
 * `Authorization: Bearer <RESEND_API_KEY>`. Renders the template first
 * (via `@runway/email-templates`) — this validates props + URL
 * allowlist, so a poisoned message is caught BEFORE any network hop.
 *
 * Error classification:
 *   - Render-side (Zod / UnsafeUrl) → `validation` → DLQ immediately
 *   - HTTP 4xx (bad recipient, unverified domain) → `permanent` → DLQ
 *   - HTTP 5xx / network / timeout → `transient` → retry queue
 *
 * Resend response shape (as of 2025 API): `{ id: string }` on success,
 * `{ statusCode, name, message }` on error. We parse the response
 * loosely (just `.id`) — a schema-strict parse would break on API
 * additions that don't affect us.
 */
export interface ResendAdapterOptions {
  apiKey: string;
  fromAddress: string;
  fromName: string;
  appOrigin: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

const ResendSuccessSchema = z.object({ id: z.string().min(1) });

export function createResendAdapter(options: ResendAdapterOptions): EmailPort {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(msg: EmailMessage): Promise<EmailSendResult> {
      // Step 1: render locally so bad props / URLs fail fast, before
      // spending an API call on a message that would be rejected.
      let rendered;
      try {
        rendered = await renderTemplateForMessage(msg, options.appOrigin);
      } catch (err) {
        if (err instanceof UnsafeUrlError || err instanceof z.ZodError) {
          // Known-permanent: the message would never render safely.
          // Route straight to DLQ; retrying can't fix it.
          return {
            ok: false,
            error: { code: "validation", message: describeError(err) },
          };
        }
        // Unknown render throw — most commonly a version mismatch
        // between `@react-email/render` and `@react-email/components`
        // after a dep bump. Classify as transient so the retry queue
        // gives the deploy pipeline a window to revert; if the fault
        // truly is permanent, we still bail after MAX_RETRY_ATTEMPTS.
        console.error(
          JSON.stringify({
            ts: Date.now(),
            kind: "email.resend.render_error",
            template: msg.template,
            error: describeError(err),
          }),
        );
        return {
          ok: false,
          error: { code: "transient", message: `render error: ${describeError(err)}` },
        };
      }

      // Step 2: POST to Resend
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            from: `${options.fromName} <${options.fromAddress}>`,
            to: [msg.to],
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "transient",
            message: `network error: ${describeError(err)}`,
          },
        };
      } finally {
        clearTimeout(timeoutId);
      }

      // Step 3: classify by status
      if (response.status >= 500) {
        return {
          ok: false,
          error: { code: "transient", message: `resend 5xx: ${response.status}` },
        };
      }
      if (response.status >= 400) {
        // 429 IS transient (throttling), everything else 4xx is permanent
        const code = response.status === 429 ? "transient" : "permanent";
        return {
          ok: false,
          error: { code, message: `resend ${response.status}` },
        };
      }

      // Step 4: parse success response
      let body: unknown;
      try {
        body = await response.json();
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "transient",
            message: `unparseable resend body: ${describeError(err)}`,
          },
        };
      }

      const parsed = ResendSuccessSchema.safeParse(body);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "transient",
            message: `unexpected resend body: ${parsed.error.message}`,
          },
        };
      }

      return {
        ok: true,
        value: { messageId: parsed.data.id, provider: "resend" },
      };
    },
  };
}

async function renderTemplateForMessage(msg: EmailMessage, appOrigin: string) {
  if (msg.template === "verify-email") {
    return renderTemplate({
      template: "verify-email",
      appOrigin,
      props: msg.props,
    });
  }
  return renderTemplate({
    template: "password-reset",
    appOrigin,
    props: msg.props,
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
