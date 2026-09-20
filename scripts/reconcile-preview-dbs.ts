#!/usr/bin/env tsx
/**
 * Nightly reconcile job: deletes orphaned per-PR preview D1 databases.
 *
 * A database named `runway-preview-pr-<N>` is deleted when either:
 *  - PR <N> is not in the set of currently-open PRs AND the DB is older than 24h, OR
 *  - the DB is older than 14 days, regardless of PR state (hard TTL).
 *
 * Run with --dry-run to print what would be deleted without deleting anything.
 *
 * This script is informational/best-effort: it always exits 0 (failures are
 * logged, not fatal) so a transient Cloudflare/GitHub API hiccup never blocks
 * the nightly security workflow.
 */
import { execSync } from 'node:child_process';

const DRY_RUN = process.argv.includes('--dry-run');
const PREVIEW_DB_PATTERN = /^runway-preview-pr-(\d+)$/;
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const HARD_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

type D1Database = {
  uuid: string;
  name: string;
  created_at: string;
};

function getOpenPrNumbers(): Set<number> | null {
  try {
    const out = execSync("gh pr list --state open --json number --jq '.[].number'", {
      encoding: 'utf-8',
    });
    const numbers = out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isFinite(n));
    return new Set(numbers);
  } catch (err) {
    console.error('reconcile-preview-dbs: failed to list open PRs via gh CLI:', (err as Error).message);
    return null;
  }
}

async function listD1Databases(accountId: string, apiToken: string): Promise<D1Database[] | null> {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      console.error(`reconcile-preview-dbs: Cloudflare API list failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const body = (await res.json()) as { result?: D1Database[]; success?: boolean };
    if (!body.success || !Array.isArray(body.result)) {
      console.error('reconcile-preview-dbs: unexpected Cloudflare API response shape.');
      return null;
    }
    return body.result;
  } catch (err) {
    console.error('reconcile-preview-dbs: fetch failed listing D1 databases:', (err as Error).message);
    return null;
  }
}

async function deleteD1Database(
  accountId: string,
  apiToken: string,
  dbId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!res.ok) {
      console.error(`reconcile-preview-dbs: delete failed for ${dbId}: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`reconcile-preview-dbs: fetch failed deleting ${dbId}:`, (err as Error).message);
    return false;
  }
}

async function main(): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    console.log(
      'reconcile-preview-dbs: CLOUDFLARE_ACCOUNT_ID and/or CLOUDFLARE_API_TOKEN not set.\n' +
        'This script requires both to reconcile preview D1 databases against Cloudflare.\n' +
        'Set them (e.g. `export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...`) or run this\n' +
        'inside the security.yml nightly workflow where they are provided as GitHub secrets.\n' +
        'Skipping reconcile run (not a failure).',
    );
    process.exit(0);
  }

  const openPrNumbers = getOpenPrNumbers();
  if (openPrNumbers === null) {
    console.log('reconcile-preview-dbs: could not determine open PRs; skipping this run.');
    process.exit(0);
  }

  const databases = await listD1Databases(accountId, apiToken);
  if (databases === null) {
    console.log('reconcile-preview-dbs: could not list D1 databases; skipping this run.');
    process.exit(0);
  }

  const now = Date.now();
  const toDelete: Array<{ db: D1Database; reason: string }> = [];
  const kept: D1Database[] = [];
  let nonPreviewCount = 0;

  for (const db of databases) {
    const match = PREVIEW_DB_PATTERN.exec(db.name);
    if (!match) {
      nonPreviewCount += 1;
      continue; // not a preview DB; leave untouched
    }

    const prNumber = Number.parseInt(match[1]!, 10);
    const createdAt = Date.parse(db.created_at);
    const ageMs = Number.isFinite(createdAt) ? now - createdAt : 0;

    if (Number.isFinite(createdAt) && ageMs > HARD_TTL_MS) {
      toDelete.push({ db, reason: `hard TTL exceeded (>${14}d old)` });
      continue;
    }

    const isOrphan = !openPrNumbers.has(prNumber);
    if (isOrphan && Number.isFinite(createdAt) && ageMs > ORPHAN_TTL_MS) {
      toDelete.push({ db, reason: `PR #${prNumber} not open and DB >24h old` });
      continue;
    }

    kept.push(db);
  }

  console.log(`reconcile-preview-dbs: ${databases.length} total D1 databases (${nonPreviewCount} non-preview skipped).`);
  console.log(`reconcile-preview-dbs: ${openPrNumbers.size} open PR(s): ${[...openPrNumbers].sort((a, b) => a - b).join(', ') || '(none)'}`);
  console.log(`reconcile-preview-dbs: ${kept.length} preview DB(s) kept, ${toDelete.length} preview DB(s) marked for deletion.`);

  if (toDelete.length === 0) {
    console.log('reconcile-preview-dbs: nothing to delete.');
    process.exit(0);
  }

  for (const { db, reason } of toDelete) {
    if (DRY_RUN) {
      console.log(`[dry-run] would delete ${db.name} (${db.uuid}) — ${reason}`);
      continue;
    }
    console.log(`Deleting ${db.name} (${db.uuid}) — ${reason}`);
    const ok = await deleteD1Database(accountId, apiToken, db.uuid);
    if (ok) {
      console.log(`  deleted ${db.name}`);
    } else {
      console.log(`  FAILED to delete ${db.name} (logged; not fatal)`);
    }
  }

  console.log(`reconcile-preview-dbs: done${DRY_RUN ? ' (dry-run, no databases were actually deleted)' : ''}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('reconcile-preview-dbs: unexpected error (logged, exiting 0):', err);
  process.exit(0);
});
