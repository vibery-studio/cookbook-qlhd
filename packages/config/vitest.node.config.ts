import { defineConfig } from "vitest/config";

// Node-only vitest config for tests that don't need workerd (e.g. the ESLint
// rule fixture tests). Separate from `vitest.base.ts` (consumed by
// apps/api's workers pool) so the two never collide.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["eslint-rules/**/*.test.js"],
  },
});
