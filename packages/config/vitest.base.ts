import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";

export function createVitestConfig(opts?: ViteUserConfig): ViteUserConfig {
  const base = defineConfig({
    test: {
      globals: false,
      environment: "node",
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
      },
    },
  });

  return opts ? mergeConfig(base, defineConfig(opts)) : base;
}
