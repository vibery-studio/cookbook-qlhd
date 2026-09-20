#!/usr/bin/env tsx
/**
 * Expand/contract migration lint.
 *
 * Blocks a PR that combines a destructive migration (DROP COLUMN, DROP TABLE,
 * RENAME COLUMN/TABLE, destructive ALTER TABLE ... DROP) with application code
 * changes in the same PR. Destructive schema changes must ship in their own
 * PR, deployed and baked in, before dependent code changes land — this is the
 * expand/contract discipline documented in docs/deploy.md (Phase 3).
 *
 * Diff base: origin/main...HEAD, falling back to HEAD~1...HEAD if origin/main
 * is unavailable (e.g. shallow clone, no remote configured locally).
 *
 * Exit 0: no destructive migration + code combo detected (includes the
 *   current Phase 2 tree, which has no migrations yet).
 * Exit 1: destructive migration verb found alongside apps/api/src/** changes.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MIGRATION_PATTERN = /^apps\/api\/src\/db\/migrations\/.*\.sql$/;
const CODE_PATTERN = /^apps\/api\/src\/.*\.(ts|tsx)$/;
const TEST_PATTERN = /\.(test|spec)\.(ts|tsx)$/;
const DESTRUCTIVE_VERB_PATTERN =
  /\b(DROP\s+COLUMN|DROP\s+TABLE|RENAME\s+COLUMN|RENAME\s+TABLE|ALTER\s+TABLE\s+.*\s+DROP)\b/i;

function getDiffFiles(): string[] {
  const attempts = ['origin/main...HEAD', 'HEAD~1...HEAD'];
  for (const range of attempts) {
    try {
      const out = execSync(`git diff --name-only ${range}`, { encoding: 'utf-8' });
      return out.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      // try next fallback
    }
  }
  console.log('lint-migrations: could not compute a diff range (no origin/main, no prior commit). Skipping.');
  return [];
}

function main(): void {
  const files = getDiffFiles();

  if (files.length === 0) {
    console.log('lint-migrations: no diff to inspect. OK.');
    process.exit(0);
  }

  const migrationFiles = files.filter((f) => MIGRATION_PATTERN.test(f));
  const codeFiles = files.filter((f) => CODE_PATTERN.test(f) && !TEST_PATTERN.test(f));

  if (migrationFiles.length === 0 || codeFiles.length === 0) {
    console.log(
      `lint-migrations: OK — ${migrationFiles.length} migration file(s), ${codeFiles.length} code file(s) changed; no expand/contract conflict possible.`,
    );
    process.exit(0);
  }

  const destructiveMigrations: Array<{ file: string; verbs: string[] }> = [];

  for (const file of migrationFiles) {
    let contents: string;
    try {
      contents = readFileSync(file, 'utf-8');
    } catch {
      // File may have been deleted in this diff; nothing to lint.
      continue;
    }
    const matches = contents.match(new RegExp(DESTRUCTIVE_VERB_PATTERN, 'gi'));
    if (matches && matches.length > 0) {
      destructiveMigrations.push({ file, verbs: [...new Set(matches.map((m) => m.toUpperCase()))] });
    }
  }

  if (destructiveMigrations.length === 0) {
    console.log('lint-migrations: OK — migration file(s) changed alongside code, but no destructive verbs found.');
    process.exit(0);
  }

  console.error('lint-migrations: FAILED — expand/contract discipline violated.\n');
  console.error(
    'This PR combines a destructive schema migration with application code changes.\n' +
      'Destructive changes (DROP COLUMN, DROP TABLE, RENAME COLUMN/TABLE, destructive ALTER)\n' +
      'must ship in their own PR, deploy, and bake in BEFORE code that depends on the new\n' +
      'shape lands. This keeps rollback safe: old code must keep working against the old\n' +
      'schema until the contract phase removes it. See docs/deploy.md rollback playbook.\n',
  );
  console.error('Destructive migration file(s):');
  for (const { file, verbs } of destructiveMigrations) {
    console.error(`  ${file}: ${verbs.join(', ')}`);
  }
  console.error('\nCode file(s) changed in the same PR:');
  for (const file of codeFiles) {
    console.error(`  ${file}`);
  }
  console.error('\nSplit this PR: ship the destructive migration alone first, then the code change.');
  process.exit(1);
}

main();
