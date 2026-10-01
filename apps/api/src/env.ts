import { z } from "zod";

/**
 * Zod schema for runtime-configured environment variables and secrets.
 * Cloudflare bindings (D1, KV, Queues, Rate Limiters) are NOT parsed by Zod —
 * they are typed separately via the `Bindings` interface below and provided
 * by the Workers runtime, not `env` vars.
 *
 * Security-critical secrets (JWT_SECRET, TOKEN_PEPPER, READYZ_TOKEN) are
 * required with NO default; missing them makes boot fail loudly instead of
 * silently running with a guessable value in preview/production. Local dev
 * populates them via `apps/api/.dev.vars`; CI/preview/prod deploys set them
 * as Cloudflare secrets via `wrangler secret put`.
 */
export const EnvSchema = z.object({
  APP_ENV: z.enum(["development", "preview", "production"]),
  APP_ORIGIN: z.string().url(),
  BUILD_SHA: z.string().default("dev"),
  JWT_SECRET: z.string().min(32),
  TOKEN_PEPPER: z.string().min(32),
  READYZ_TOKEN: z.string().min(16),
  SENTRY_DSN: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["noop", "resend"]).default("noop"),
  RESEND_API_KEY: z.string().optional(),
  PASSWORD_MIN_LENGTH: z.coerce.number().default(12),
  RATE_LIMIT_AUTH_LOGIN: z.coerce.number().default(5),
  RATE_LIMIT_AUTH_SIGNUP: z.coerce.number().default(3),
  /** SPEC-05: `off` = the contract-pdf consumer acks without rendering and the sweeper does not run (tests, kill-switch). */
  PDF_RENDERER: z.enum(["browser", "off"]).default("browser"),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Cloudflare Workers bindings available on `c.env`, layered on top of the
 * Zod-parsed environment variables/secrets. Binding types come from
 * `@cloudflare/workers-types` (declared globally by that package's ambient
 * types); no hand-written D1/KV type declarations here.
 */
export interface Bindings extends Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  SETTINGS: KVNamespace;
  EMAIL_RETRY_QUEUE: Queue;
  EMAIL_DLQ_QUEUE: Queue;
  /** SPEC-05: Browser Rendering (Chrome) for issued-contract PDFs. */
  BROWSER: Fetcher;
  /** SPEC-05: R2 bucket holding issued-contract PDFs (`contracts/{id}/{ulid}.pdf`). */
  FILES: R2Bucket;
  CONTRACT_PDF_QUEUE: Queue<{ contract_id: string }>;
  RL_AUTH_LOGIN: RateLimit;
  RL_AUTH_SIGNUP: RateLimit;
  RL_AUTH_VERIFY: RateLimit;
  RL_AUTH_REFRESH: RateLimit;
  RL_READYZ: RateLimit;
}

/**
 * Parses raw env vars against `EnvSchema`. Throws a ZodError on invalid input,
 * including when a required secret is missing.
 */
export function parseEnv(raw: unknown): Env {
  return EnvSchema.parse(raw);
}
