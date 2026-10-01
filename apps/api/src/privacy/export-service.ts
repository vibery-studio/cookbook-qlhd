/**
 * Export service — collects every user-owned row across the data
 * inventory, wraps it in a signed archive envelope, and returns it
 * inline. v1.1 keeps the response synchronous (no queue, no R2) —
 * blueprint scale is small; the async path is documented as a v1.2
 * extension in `docs/privacy.md`.
 *
 * Archive shape:
 *   {
 *     "schema_version": 1,
 *     "generated_at": <unix seconds>,
 *     "user_id": "<ULID>",
 *     "tables": {
 *       "<table_name>": [<row>, ...],
 *       ...
 *     },
 *     "signature": "<hex HMAC-SHA256(TOKEN_PEPPER, JSON.stringify(payload))>"
 *   }
 *
 * The signature is computed over the JSON of everything EXCEPT the
 * signature field itself, using the app's `TOKEN_PEPPER` as HMAC key.
 * The signature travels alongside the archive so the recipient (or
 * legal counsel) can verify integrity without an out-of-band exchange.
 * Rotation of `TOKEN_PEPPER` invalidates all prior signatures —
 * operator responsibility, called out in the docs.
 */
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import { DATA_INVENTORY } from "./data-inventory";

export const EXPORT_SCHEMA_VERSION = 1;

export interface ExportArchive {
  schema_version: 1;
  generated_at: number;
  user_id: string;
  tables: Record<string, unknown[]>;
  signature: string;
}

export interface BuildExportDeps {
  db: Db;
  env: Bindings;
  now?: () => number;
}

/**
 * Collect all exportable rows for a user and return a signed archive.
 *
 * NOTE: table names come from the static inventory list, so `sql.raw`
 * on them is safe — they are not user-supplied strings. `ownerColumn`
 * has the same provenance.
 */
export async function buildUserExport(
  deps: BuildExportDeps,
  userId: string,
): Promise<ExportArchive> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const tables: Record<string, unknown[]> = {};

  for (const entry of DATA_INVENTORY) {
    if (!entry.exportable) continue;
    const rows = await selectByOwner(
      deps.db,
      entry.table,
      entry.ownerColumn,
      userId,
      entry.excludeColumns ?? [],
    );
    tables[entry.table] = rows;
  }

  const unsigned: Omit<ExportArchive, "signature"> = {
    schema_version: 1,
    generated_at: now,
    user_id: userId,
    tables,
  };
  const signature = signArchive(unsigned, deps.env.TOKEN_PEPPER);

  return { ...unsigned, signature };
}

/**
 * Verify an archive's signature. Exported so tests + downstream tooling
 * can round-trip. Returns true when signature matches.
 */
export function verifyExportSignature(
  archive: ExportArchive,
  tokenPepper: string,
): boolean {
  const { signature, ...unsigned } = archive;
  return signArchive(unsigned, tokenPepper) === signature;
}

function signArchive(payload: Omit<ExportArchive, "signature">, pepper: string): string {
  // Canonical JSON serialization: JSON.stringify with the same key order
  // as the source object literal (schema_version → generated_at →
  // user_id → tables). Object.entries preserves insertion order in
  // ES2015+, which we rely on here. For strict cross-tooling
  // reproducibility a schema-aware sorter would be safer; the archive
  // signature is verified by our own code paths only.
  const canonical = JSON.stringify(payload);
  const key = new TextEncoder().encode(pepper);
  const msg = new TextEncoder().encode(canonical);
  const digest = hmac(sha256, key, msg);
  return bytesToHex(digest);
}

async function selectByOwner(
  db: Db,
  table: string,
  ownerColumn: string | null,
  userId: string,
  excludeColumns: readonly string[],
): Promise<unknown[]> {
  // Table + column names come from the static DATA_INVENTORY and are
  // validated by `quoteIdent`. `userId` is a parameter bound via the
  // tagged template — never interpolated as raw text.
  const column = ownerColumn === null ? "id" : ownerColumn;
  // Explicit column list (table minus denylist) so credential columns are never read.
  const info = await db.all<{ name: string }>(
    sql`SELECT name FROM pragma_table_info(${quoteIdent(table)})`,
  );
  const cols = info.map((c) => c.name).filter((n) => !excludeColumns.includes(n));
  if (cols.length === 0) return [];
  const colList = sql.join(
    cols.map((n) => sql.identifier(quoteIdent(n))),
    sql`, `,
  );
  const query: SQL = sql`SELECT ${colList} FROM ${sql.identifier(quoteIdent(table))} WHERE ${sql.identifier(quoteIdent(column))} = ${userId}`;
  const rows = await db.all(query);
  return rows;
}

/**
 * SQL identifier escape. All identifiers come from the static
 * `DATA_INVENTORY` — this quoting is defense-in-depth against a future
 * change accidentally introducing a user-supplied name.
 */
function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`export-service: refusing unsafe identifier '${ident}'`);
  }
  return ident;
}
