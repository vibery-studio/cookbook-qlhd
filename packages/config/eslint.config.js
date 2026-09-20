import tseslint from "typescript-eslint";
import runwayPlugin from "./eslint-rules/index.js";

export default tseslint.config(
  {
    ignores: ["dist/**", ".wrangler/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
  },
  // DAOs must never leak drizzle row/table types — see docs/dao-pattern.md.
  {
    files: ["apps/*/src/dao/**/*.ts"],
    plugins: { "runway-blueprint": runwayPlugin },
    rules: { "runway-blueprint/no-drizzle-typed-exports": "error" },
  },
);
