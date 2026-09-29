/**
 * Test setup — applies drizzle migrations to the miniflare-hosted local D1
 * before any test runs. Registered via `vitest.config.ts -> setupFiles`.
 * Uses vitest-pool-workers' `applyD1Migrations` helper so miniflare's
 * isolated D1 has the same schema as production.
 *
 * vitest setupFiles execute top-level (no default export); the top-level
 * `await` runs before test collection begins.
 *
 * Signup: the app is invite-only (migration 0010 turns `signup.enabled` off). RUNWAY's own suites
 * create users through signup, so the test DB turns it back on AFTER recording the migrated value in
 * `globalThis.__SIGNUP_DEFAULT__` — the SPEC-01 AC-2 test asserts that recorded value is 0.
 */
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const signup = await env.DB.prepare("SELECT enabled FROM feature_flags WHERE key = 'signup.enabled'").first<{
  enabled: number;
}>();
(globalThis as { __SIGNUP_DEFAULT__?: number }).__SIGNUP_DEFAULT__ ??= signup?.enabled;
await env.DB.prepare("UPDATE feature_flags SET enabled = 1 WHERE key = 'signup.enabled'").run();
