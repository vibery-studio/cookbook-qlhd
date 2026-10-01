/**
 * SPEC-06 FR-13: `audit_events` is append-only — D1 triggers refuse UPDATE/DELETE (migration 0018).
 * Tests still need an empty table between cases; this is the ONE way they get it: read the table's
 * triggers from sqlite_master, then in one batch (= one transaction) drop them, delete, and recreate
 * them from the very SQL just read — the trigger SQL lives only in the migration.
 *
 * NOT for production use — test-only.
 */

/** Minimal D1 shape (structural; this package has no workers-types). */
export interface D1Like {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown>;
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

/**
 * Empty `audit_events` (or only the rows matching `where`, a raw SQL predicate without the
 * `WHERE` keyword) and leave the same triggers in place.
 */
export async function clearAuditEvents(db: D1Like, where?: string): Promise<void> {
  const triggers = await db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_events'")
    .all<{ name: string; sql: string }>();
  await db.batch([
    ...triggers.results.map((t) => db.prepare(`DROP TRIGGER IF EXISTS "${t.name}"`)),
    db.prepare(where ? `DELETE FROM audit_events WHERE ${where}` : "DELETE FROM audit_events"),
    ...triggers.results.map((t) => db.prepare(t.sql)),
  ]);
}
