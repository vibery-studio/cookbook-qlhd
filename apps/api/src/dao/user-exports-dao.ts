/**
 * User-exports DAO. Ledger of `POST /me/export` calls; v1.1 completes
 * the archive synchronously in the request handler and inserts the
 * row for retention/audit purposes (so the pruner can enforce the
 * `privacy.export_retention_seconds` window).
 */
import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { userExports } from "../db/schema";

export interface UserExportRow {
  id: string;
  userId: string;
  status: "pending" | "completed" | "failed";
  archiveUrl: string | null;
  requestedAt: number;
  completedAt: number | null;
  expiresAt: number;
}

export async function insertUserExport(
  db: Db,
  input: {
    id: string;
    userId: string;
    status: "pending" | "completed" | "failed";
    archiveUrl: string | null;
    requestedAt: number;
    completedAt: number | null;
    expiresAt: number;
  },
): Promise<void> {
  await db.insert(userExports).values(input);
}

export async function listUserExports(db: Db, userId: string): Promise<UserExportRow[]> {
  const rows = await db.select().from(userExports).where(eq(userExports.userId, userId));
  return rows.map(toDto);
}

export async function findLatestExportByUser(
  db: Db,
  userId: string,
): Promise<UserExportRow | null> {
  const rows = await db
    .select()
    .from(userExports)
    .where(eq(userExports.userId, userId));
  if (rows.length === 0) return null;
  // Newest first — no ORDER BY needed to keep the DAO shape simple.
  let latest = rows[0]!;
  for (const r of rows) {
    if (r.requestedAt > latest.requestedAt) latest = r;
  }
  return toDto(latest);
}

/**
 * Prune expired export rows. Called by the nightly pruner. Returns the
 * count removed for the sweeper's summary log.
 */
export async function pruneExpiredUserExports(db: Db, now: number): Promise<number> {
  const rows = await db
    .select({ id: userExports.id })
    .from(userExports)
    .where(lt(userExports.expiresAt, now));
  if (rows.length === 0) return 0;
  await db.delete(userExports).where(lt(userExports.expiresAt, now));
  return rows.length;
}

/**
 * Delete every export row belonging to a user. Used by the deletion
 * sweeper so a user's archive ledger disappears with the rest of
 * their data.
 */
export async function deleteUserExportsForUser(
  db: Db,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ id: userExports.id })
    .from(userExports)
    .where(eq(userExports.userId, userId));
  if (rows.length === 0) return 0;
  await db.delete(userExports).where(eq(userExports.userId, userId));
  return rows.length;
}

function toDto(row: {
  id: string;
  userId: string;
  status: string;
  archiveUrl: string | null;
  requestedAt: number;
  completedAt: number | null;
  expiresAt: number;
}): UserExportRow {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as UserExportRow["status"],
    archiveUrl: row.archiveUrl,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
  };
}

