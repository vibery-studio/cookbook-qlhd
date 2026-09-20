import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config: schema-only SQL generation, no live D1 introspection
 * and no built-in D1 HTTP driver (that driver is flaky — see phase-03 Risk
 * Assessment). Generated SQL under `apps/api/src/db/migrations/` is applied
 * out-of-band via `wrangler d1 migrations apply <db> --remote` (see
 * `pnpm db:migrate:{local,dev,prod}` in package.json). Never
 * `drizzle-kit push` or `drizzle-kit migrate` here.
 */
export default defineConfig({
  schema: "./apps/api/src/db/schema.ts",
  out: "./apps/api/src/db/migrations",
  dialect: "sqlite",
});
