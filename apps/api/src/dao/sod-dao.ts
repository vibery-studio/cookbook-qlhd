/**
 * SoD pairs (SPEC-07 §3.1/§3.3, FR-1/FR-2, DEC-9 B). `sodClearSql` is the shared predicate repeated inside write
 * WHEREs (role create, request create/apply): imported by 003/004, signature fixed.
 * Write builders (C-07-003) are UNEXECUTED: the service runs them in one `db.batch`.
 */
import { asc, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { sodPairs, users } from "../db/schema";

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

/** `GET /sod-pairs` row: the pair + the declarer's display name. */
export interface SodPairViewDto {
  id: string;
  perm_a: string;
  perm_b: string;
  reason: string | null;
  created_by_name: string | null;
  created_at: number;
}

/** All declared pairs with `created_by_name`, oldest first — one LEFT JOIN. */
export async function listSodPairViews(db: Db): Promise<SodPairViewDto[]> {
  const rows = await db
    .select({
      id: sodPairs.id,
      permA: sodPairs.permA,
      permB: sodPairs.permB,
      reason: sodPairs.reason,
      createdByName: users.displayName,
      createdAt: sodPairs.createdAt,
    })
    .from(sodPairs)
    .leftJoin(users, eq(users.id, sodPairs.createdBy))
    .orderBy(asc(sodPairs.createdAt), asc(sodPairs.id));
  return rows.map((r) => ({
    id: r.id,
    perm_a: r.permA,
    perm_b: r.permB,
    reason: r.reason,
    created_by_name: r.createdByName,
    created_at: r.createdAt,
  }));
}

export async function findSodPair(db: Db, id: string): Promise<SodPairDto | null> {
  const rows = await db.select().from(sodPairs).where(eq(sodPairs.id, id)).limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

/** Some role holds both codes right now. */
function someRoleHoldsBoth(permA: string, permB: string): SQL {
  return sql`EXISTS (SELECT 1 FROM roles sr WHERE EXISTS (SELECT 1 FROM role_permissions sra JOIN permissions spa ON spa.id = sra.permission_id WHERE sra.role_id = sr.id AND spa.key = ${permA}) AND EXISTS (SELECT 1 FROM role_permissions srb JOIN permissions spb ON spb.id = srb.permission_id WHERE srb.role_id = sr.id AND spb.key = ${permB}))`;
}

export interface RoleRefDto {
  id: string;
  name: string;
  label: string;
}

/** Roles holding both codes (the 409 `sod-conflict` list on a pair declaration). Unordered. */
export async function rolesHoldingBoth(db: Db, permA: string, permB: string): Promise<RoleRefDto[]> {
  const rows = await db.all<{ id: string; name: string; label: string | null }>(
    sql`SELECT r.id AS id, r.name AS name, r.label AS label FROM roles r WHERE EXISTS (SELECT 1 FROM role_permissions ra JOIN permissions pa ON pa.id = ra.permission_id WHERE ra.role_id = r.id AND pa.key = ${permA}) AND EXISTS (SELECT 1 FROM role_permissions rb JOIN permissions pb ON pb.id = rb.permission_id WHERE rb.role_id = r.id AND pb.key = ${permB})`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, label: r.label ?? r.name }));
}

/**
 * Declare a pair (`permA < permB`, sorted by the caller) only while NO role holds both codes — the check and the
 * write are one statement, so a concurrent permission change cannot slip between them (D1 batches run one at a
 * time). UNIQUE(perm_a, perm_b) throws on a duplicate. RETURNING id → 0 rows = some role holds both.
 */
export function insertSodPairStmt(
  db: Db,
  input: { id: string; permA: string; permB: string; reason: string | null; actorId: string; now: number },
) {
  // Column order = table order: id, perm_a, perm_b, reason, created_by, created_at.
  return db
    .insert(sodPairs)
    .select(
      sql`SELECT ${input.id}, ${input.permA}, ${input.permB}, ${input.reason}, ${input.actorId}, ${input.now} WHERE NOT ${someRoleHoldsBoth(input.permA, input.permB)}`,
    )
    .returning({ id: sodPairs.id });
}

/** The pair row exists (guard for the audit row of the same batch). */
export function sodPairExistsSql(id: string): SQL {
  return sql`EXISTS (SELECT 1 FROM sod_pairs se WHERE se.id = ${id})`;
}

/** Delete the pair. RETURNING id → 0 rows = already gone (404). */
export function deleteSodPairStmt(db: Db, id: string) {
  return db.delete(sodPairs).where(eq(sodPairs.id, id)).returning({ id: sodPairs.id });
}
