/**
 * Idempotency DAO. Concurrency-safe via CAS on the `key` PK — the
 * critical primitive is `tryInsertSentinel` which uses SQLite's
 * `INSERT OR IGNORE` semantics. Only the first inserter wins; every
 * subsequent inserter falls into the polling path (see
 * `middleware/idempotency.ts`).
 *
 * Storage shape (schema.ts):
 *   key             TEXT PRIMARY KEY  — sha256 of principalId+method+path+header
 *   request_hash    TEXT NOT NULL     — sha256 of method+path+body+headers
 *   response_status INTEGER NULLABLE  — null while in-flight; 2xx once complete
 *   response_body   TEXT NULLABLE     — captured 2xx response body
 *   created_at      INTEGER NOT NULL
 *   expires_at      INTEGER NOT NULL  — 24h TTL; sweeper prunes stale rows
 */
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { idempotencyKeys } from "../db/schema";

export interface IdempotencyRowDto {
  key: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: string | null;
  createdAt: number;
  expiresAt: number;
}

/**
 * Atomically insert a sentinel row (status/body NULL). Returns `true`
 * only if THIS caller inserted; `false` if a row with the same key
 * already existed (someone else is racing us). `returning()` on
 * `onConflictDoNothing` gives us the inserted row when we won, or an
 * empty array when we lost — perfect binary CAS signal.
 */
export async function tryInsertSentinel(
  db: Db,
  input: {
    key: string;
    requestHash: string;
    createdAt: number;
    expiresAt: number;
  },
): Promise<boolean> {
  const rows = await db
    .insert(idempotencyKeys)
    .values({
      key: input.key,
      requestHash: input.requestHash,
      responseStatus: null,
      responseBody: null,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  return rows.length === 1;
}

export async function findIdempotencyRow(
  db: Db,
  key: string,
): Promise<IdempotencyRowDto | null> {
  const row = await db.query.idempotencyKeys.findFirst({
    where: eq(idempotencyKeys.key, key),
  });
  return row ?? null;
}

/**
 * Fill in the sentinel row with a completed 2xx response. Called by
 * the middleware AFTER `next()` returns with a success status. If
 * the row is missing (shouldn't happen — we just inserted it), the
 * update is a no-op.
 */
export async function updateResponse(
  db: Db,
  input: {
    key: string;
    responseStatus: number;
    responseBody: string;
  },
): Promise<void> {
  await db
    .update(idempotencyKeys)
    .set({
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
    })
    .where(eq(idempotencyKeys.key, input.key));
}

/**
 * Remove the sentinel row when the handler returned a non-2xx
 * status. We do NOT cache errors — clients should be able to retry
 * a failed request under the same idempotency key.
 */
export async function deleteSentinel(db: Db, key: string): Promise<void> {
  await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
}

/**
 * Poll the row until it either completes (response_status set) or
 * the timeout fires. Returns the final row (may still be sentinel
 * if we timed out); caller decides whether to serve cached or
 * emit 425 Too Early.
 *
 * Polling interval starts at 100ms with a mild backoff cap of 500ms.
 * On a fast handler the loser wins within one iteration; on a slow
 * handler we still bound wait time at `timeoutMs`.
 */
export async function pollUntilComplete(
  db: Db,
  key: string,
  timeoutMs: number,
): Promise<IdempotencyRowDto | null> {
  const startedAt = Date.now();
  let backoffMs = 100;
  const MAX_BACKOFF_MS = 500;

  while (Date.now() - startedAt < timeoutMs) {
    const row = await findIdempotencyRow(db, key);
    if (row === null) return null; // sentinel deleted (handler failed)
    if (row.responseStatus !== null) return row;

    await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  return findIdempotencyRow(db, key);
}

/**
 * Housekeeping — deletes rows whose `expires_at` has passed. Meant
 * to be called from a Cron trigger; not wired in v1 to keep the
 * cron surface small.
 */
export async function pruneExpiredKeys(
  db: Db,
  now: number,
): Promise<number> {
  const rows = await db
    .delete(idempotencyKeys)
    .where(and(lt(idempotencyKeys.expiresAt, now)))
    .returning({ key: idempotencyKeys.key });
  return rows.length;
}
