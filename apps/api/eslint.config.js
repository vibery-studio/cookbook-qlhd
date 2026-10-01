import base from "@runway/config/eslint";

// Fixture generator (plain Node script, outside the TS project) — SPEC-10 test fixtures.
export default [{ ignores: ["test/fixtures/**/*.mjs"] }, ...base];
