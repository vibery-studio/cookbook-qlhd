/**
 * Test setup — applies drizzle migrations to the miniflare-hosted local D1
 * before any test runs. Registered via `vitest.config.ts -> setupFiles`.
 * Uses vitest-pool-workers' `applyD1Migrations` helper so miniflare's
 * isolated D1 has the same schema as production.
 *
 * vitest setupFiles execute top-level (no default export); the top-level
 * `await` runs before test collection begins.
 */
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
