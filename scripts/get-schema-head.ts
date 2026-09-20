#!/usr/bin/env tsx
/**
 * Codegen helper for the build: reads apps/api/src/db/migrations/ for the
 * latest `NNNN_*.sql` migration filename (highest numeric prefix) and
 * prints it to stdout.
 *
 * Used to bake the expected schema head into the deployed Worker as
 * `SCHEMA_HEAD`, e.g.:
 *   wrangler deploy --var SCHEMA_HEAD:$(tsx scripts/get-schema-head.ts) ...
 *
 * **UNUSED UNTIL PHASE 10.** No workflow currently invokes this. It exists
 * so the wiring is ready when Phase 10 adds the `/readyz` handler that
 * compares this baked-in value against the `schema_versions.head` row
 * written by the migration wrapper. Removing it now would just cause
 * churn — leave in place and wire in Phase 10.
 *
 * Exit 1 (no stdout) if the migrations directory is missing or has no
 * numbered `.sql` files.
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(process.cwd(), "apps/api/src/db/migrations");
const MIGRATION_FILENAME_PATTERN = /^(\d{4})_.*\.sql$/;

function main(): void {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`get-schema-head: ${MIGRATIONS_DIR} does not exist.`);
    process.exit(1);
  }

  const candidates = readdirSync(MIGRATIONS_DIR)
    .map((name) => {
      const match = MIGRATION_FILENAME_PATTERN.exec(name);
      return match ? { name, num: Number.parseInt(match[1], 10) } : null;
    })
    .filter((entry): entry is { name: string; num: number } => entry !== null);

  if (candidates.length === 0) {
    console.error(`get-schema-head: no numbered *.sql migrations found in ${MIGRATIONS_DIR}.`);
    process.exit(1);
  }

  candidates.sort((a, b) => b.num - a.num);
  process.stdout.write(candidates[0].name);
}

main();
