/**
 * SoD pairs — read side (SPEC-07 §3.1/§3.3). Writes land in C-07-003. `sodClearSql` is the shared predicate
 * repeated inside write WHEREs (role create, request create/apply): imported by 003/004, signature fixed.
 */
import { asc, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { sodPairs } from "../db/schema";

export interface SodPairDto {
  id: string;
  perm_a: string;
  perm_b: string;
  reason: string | null;
  created_by: string;
  created_at: number;
}

function toDto(row: typeof sodPairs.$inferSelect): SodPairDto {
  return {
    id: row.id,
    perm_a: row.permA,
    perm_b: row.permB,
    reason: row.reason,
    created_by: row.createdBy,
    created_at: row.createdAt,
  };
}

/** All declared pairs, oldest first. */
export async function listSodPairs(db: Db): Promise<SodPairDto[]> {
  const rows = await db.select().from(sodPairs).orderBy(asc(sodPairs.createdAt), asc(sodPairs.id));
  return rows.map(toDto);
}

/** TRUE when no declared pair has both of its codes in `keys` (TRUE for an empty list). */
export function sodClearSql(keys: readonly string[]): SQL {
  if (keys.length === 0) return sql`1 = 1`;
  const list = sql.join(
    keys.map((k) => sql`${k}`),
    sql`, `,
  );
  return sql`NOT EXISTS (SELECT 1 FROM sod_pairs sc WHERE sc.perm_a IN (${list}) AND sc.perm_b IN (${list}))`;
}
