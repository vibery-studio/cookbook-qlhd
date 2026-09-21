/**
 * Test-database helpers. Fixtures package intentionally does not import
 * from `apps/api/src/*` (packages should not depend on apps). Callers
 * pass in the `db` handle and the ordered list of tables to truncate,
 * so this file stays generic and reusable across future consumers of
 * the blueprint who may add their own tables.
 */

/**
 * A minimal drizzle-orm delete-target. Any drizzle sqliteTable / pgTable
 * satisfies this shape. Kept structural so we don't need to peer-depend
 * on `drizzle-orm` at all.
 */
export interface DrizzleDb {
  delete(table: unknown): { execute?: () => Promise<unknown> } | Promise<unknown>;
}

/**
 * Truncate the provided tables IN ORDER. Order matters: children before
 * parents (D1 has no FK cascade, so orphaned child rows can outlive a
 * naive delete). Callers pass tables sorted from most-dependent to
 * least — same ordering as `apps/api/src/dao/user-dao.ts#deleteUser`.
 *
 * NOT for production use — helper is dev/test only.
 */
export async function truncateTables(
  db: DrizzleDb,
  tables: readonly unknown[],
): Promise<void> {
  for (const table of tables) {
    const q = db.delete(table);
    // drizzle's D1 delete returns a Promise-like directly; other dialects
    // sometimes return a query-builder with .execute(). Accept both.
    if (q instanceof Promise) {
      await q;
    } else if (typeof (q as { execute?: () => Promise<unknown> }).execute === "function") {
      await (q as { execute: () => Promise<unknown> }).execute();
    } else {
      await Promise.resolve(q);
    }
  }
}
