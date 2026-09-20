import { createVitestConfig } from "@runway/config/vitest";

export default createVitestConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
