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
          },
        },
      },
    },
  },
});
