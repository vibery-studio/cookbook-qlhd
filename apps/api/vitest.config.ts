import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: "./src/index.ts",
        wrangler: {
          configPath: "./wrangler.toml",
        },
        miniflare: {
          compatibilityDate: "2024-12-18",
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
  },
});
