#!/usr/bin/env tsx
/**
 * Bundle-size gate: fails if the gzipped size of apps/api/dist/*.js exceeds
 * the 900KB budget (see plan.md Locked Decisions / phase-02 red-team finding 15).
 *
 * Assumes a build step has already run `wrangler deploy --dry-run --outdir=dist`
 * (see apps/api package.json "build" script) so apps/api/dist contains the
 * bundled Worker output.
 *
 * Exit 0: total gzipped size <= budget.
 * Exit 1: total gzipped size > budget.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST_DIR = resolve(process.cwd(), 'apps/api/dist');
const BUDGET_BYTES = 900 * 1024;

type FileSize = {
  file: string;
  rawBytes: number;
  gzipBytes: number;
};

function findJsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function main(): void {
  if (!existsSync(DIST_DIR)) {
    console.error(
      `check-bundle-size: ${DIST_DIR} does not exist. Run "pnpm --filter @runway/api build" first.`,
    );
    process.exit(1);
  }

  const jsFiles = findJsFiles(DIST_DIR);
  if (jsFiles.length === 0) {
    console.error(`check-bundle-size: no .js files found under ${DIST_DIR}.`);
    process.exit(1);
  }

  const sizes: FileSize[] = jsFiles.map((file) => {
    const raw = readFileSync(file);
    const gzip = gzipSync(raw, { level: 9 });
    return {
      file: file.replace(`${DIST_DIR}/`, ''),
      rawBytes: statSync(file).size,
      gzipBytes: gzip.byteLength,
    };
  });

  const totalRaw = sizes.reduce((sum, s) => sum + s.rawBytes, 0);
  const totalGzip = sizes.reduce((sum, s) => sum + s.gzipBytes, 0);
  const pct = ((totalGzip / BUDGET_BYTES) * 100).toFixed(1);

  console.log('check-bundle-size: apps/api/dist bundle report\n');
  console.log('File'.padEnd(50) + 'Raw'.padStart(12) + 'Gzip'.padStart(12));
  console.log('-'.repeat(74));
  for (const s of sizes.sort((a, b) => b.gzipBytes - a.gzipBytes)) {
    console.log(s.file.padEnd(50) + formatBytes(s.rawBytes).padStart(12) + formatBytes(s.gzipBytes).padStart(12));
  }
  console.log('-'.repeat(74));
  console.log(
    'TOTAL'.padEnd(50) + formatBytes(totalRaw).padStart(12) + formatBytes(totalGzip).padStart(12),
  );
  console.log(`\nGzipped total: ${formatBytes(totalGzip)} / ${formatBytes(BUDGET_BYTES)} budget (${pct}%)`);

  if (totalGzip > BUDGET_BYTES) {
    console.error(
      `\ncheck-bundle-size: FAILED — gzipped bundle exceeds 900KB budget by ${formatBytes(totalGzip - BUDGET_BYTES)}.`,
    );
    process.exit(1);
  }

  console.log('\ncheck-bundle-size: OK — within budget.');
  process.exit(0);
}

main();
