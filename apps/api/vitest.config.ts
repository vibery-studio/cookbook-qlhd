import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

// Read the SQL migration files at config-eval time so vitest-pool-workers can
// pass them to the miniflare-hosted local D1 via the TEST_MIGRATIONS binding.
// The setup file at ./test/apply-migrations.ts calls `applyD1Migrations`
// before any test runs.
const migrationsPath = path.join(__dirname, "src/db/migrations");
const migrations = await readD1Migrations(migrationsPath);

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    // CI cold-start of the miniflare workerd pool is significantly slower
    // than local (setup ~700s vs ~160s on macOS). Individual integration
    // tests that chain signup → verify → login → assertion routinely
    // approach 3s on a warm local runner; give CI a 15s ceiling per test
    // so the cold-start cost doesn't cascade into flaky
    // "Test timed out in 5000ms" failures. Individual slow tests should
    // still be investigated — this is a floor, not a permission slip.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    poolOptions: {
      workers: {
        main: "./src/index.ts",
        wrangler: {
          configPath: "./wrangler.toml",
        },
        miniflare: {
          compatibilityDate: "2024-12-18",
          compatibilityFlags: ["nodejs_compat"],
          // Expose the parsed migrations to the setup file via a binding.
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Auth secrets required by env.ts schema. Fixed test values so
            // signAccessToken/hashToken produce deterministic output across
            // isolates. Never used outside the test miniflare instance.
            JWT_SECRET: "test-jwt-secret-min-32-chars-abcdef0123",
            TOKEN_PEPPER: "test-token-pepper-min-32-chars-abcdef01",
            READYZ_TOKEN: "test-readyz-token-min-16",
          },
        },
      },
    },
  },
});
