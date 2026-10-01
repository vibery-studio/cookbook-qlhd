/**
 * JIT admin grants — read side (SPEC-07 §3.1, DEC-6/7/8). Writes (C-07-005) are unexecuted CAS builders the service batches with their audit row. Active =
 * `revoked_at IS NULL AND expires_at > now` (unix seconds). JIT never touches `user_roles`; guards that read D1
 * (`admin_only`, `last-admin`, approvers…) exclude a JIT holder via `jitActiveSql`. Signatures fixed for 003–006.
 */
import { and, asc, desc, eq, gt, isNull, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { jitGrants, users } from "../db/schema";

export interface ActiveJitDto {
  id: string;
  user_id: string;
  role_name: string;
  granted_by: string;
  created_at: number;
  expires_at: number;
}

function toDto(row: typeof jitGrants.$inferSelect): ActiveJitDto {
  return {
    id: row.id,
    user_id: row.userId,
    role_name: row.roleName,
    granted_by: row.grantedBy,
    created_at: row.createdAt,
    expires_at: row.expiresAt,
  };
}

/** EXISTS an active grant for `userId` (a bound id, or a column reference such as `sql\`u.id\``) at `now`. */
export function jitActiveSql(userId: SQL | string, now: number): SQL {
  return sql`EXISTS (SELECT 1 FROM jit_grants jg WHERE jg.user_id = ${userId} AND jg.revoked_at IS NULL AND jg.expires_at > ${now})`;
}

/** The user's active grant at `now`, or null. */
export async function findActiveJit(db: Db, userId: string, now: number): Promise<ActiveJitDto | null> {
  const rows = await db
    .select()
    .from(jitGrants)
    .where(and(eq(jitGrants.userId, userId), isNull(jitGrants.revokedAt), gt(jitGrants.expiresAt, now)))
    .orderBy(desc(jitGrants.expiresAt))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

// ------------------------------------------------------------------ C-07-005: list + writes

export type JitGrantState = "active" | "revoked" | "expired";

export interface JitGrantDto {
  id: string;
  user_id: string;
  user_name: string | null;
  reason: string;
  granted_by: string;
  granted_by_name: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  state: JitGrantState;
}

/** State is computed at read time: a grant past `expires_at` is `expired` whether or not the cron logged it yet. */
export function jitState(row: { revoked_at: number | null; expires_at: number }, now: number): JitGrantState {
  if (row.revoked_at !== null) return "revoked";
  return row.expires_at > now ? "active" : "expired";
}

const recipient = alias(users, "jit_recipient");
const granter = alias(users, "jit_granter");

function selectGrants(db: Db) {
  return db
    .select({
      id: jitGrants.id,
      user_id: jitGrants.userId,
      user_name: recipient.displayName,
      reason: jitGrants.reason,
      granted_by: jitGrants.grantedBy,
      granted_by_name: granter.displayName,
      created_at: jitGrants.createdAt,
      expires_at: jitGrants.expiresAt,
      revoked_at: jitGrants.revokedAt,
    })
    .from(jitGrants)
    .leftJoin(recipient, eq(recipient.id, jitGrants.userId))
    .leftJoin(granter, eq(granter.id, jitGrants.grantedBy));
}

/** Newest first; `activeOnly` = `revoked_at IS NULL AND expires_at > now`. */
export async function listJitGrants(db: Db, input: { activeOnly: boolean; now: number }): Promise<JitGrantDto[]> {
  const base = selectGrants(db);
  const rows = await (input.activeOnly
    ? base.where(and(isNull(jitGrants.revokedAt), gt(jitGrants.expiresAt, input.now)))
    : base
  ).orderBy(desc(jitGrants.createdAt), desc(jitGrants.id));
  return rows.map((r) => ({ ...r, state: jitState(r, input.now) }));
}

export async function findJitGrantById(db: Db, id: string, now: number): Promise<JitGrantDto | null> {
  const rows = await selectGrants(db).where(eq(jitGrants.id, id)).limit(1);
  const r = rows[0];
  return r === undefined ? null : { ...r, state: jitState(r, now) };
}

/** EXISTS a permanent `user_roles` row giving `userId` the role `roleName` (JIT never counts — DEC-7). */
export function holdsRoleSql(userId: string, roleName: string): SQL {
  return sql`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${userId} AND r.name = ${roleName})`;
}

/**
 * CAS grant (SPEC-07 §3.3): one `INSERT … SELECT` whose WHERE re-checks every guard at write time — recipient `active`,
 * ≠ actor, no permanent `admin`, no active grant; actor without an active grant. D1 serialises writers, so two
 * concurrent grants for one person yield one row. Unexecuted: the caller batches it with `auditInsertWhen(changes()=1)`.
 */
export function insertJitGrantStmt(
  db: Db,
  input: { id: string; userId: string; grantedBy: string; reason: string; now: number; expiresAt: number },
) {
  const { id, userId, grantedBy, reason, now, expiresAt } = input;
  return db
    .insert(jitGrants)
    .select(
      sql`SELECT ${id}, ${userId}, 'admin', ${reason}, ${grantedBy}, ${now}, ${expiresAt}, NULL, NULL, NULL
           WHERE ${userId} <> ${grantedBy}
             AND EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND status = 'active')
             AND NOT ${holdsRoleSql(userId, "admin")}
             AND NOT ${jitActiveSql(userId, now)}
             AND NOT ${jitActiveSql(grantedBy, now)}`,
    )
    .returning({ id: jitGrants.id });
}

/** CAS revoke: only an active grant (not revoked, not past `expires_at`). Unexecuted, RETURNING the id. */
export function revokeJitGrantStmt(db: Db, input: { id: string; by: string; now: number }) {
  return db
    .update(jitGrants)
    .set({ revokedAt: input.now, revokedBy: input.by })
    .where(and(eq(jitGrants.id, input.id), isNull(jitGrants.revokedAt), gt(jitGrants.expiresAt, input.now)))
    .returning({ id: jitGrants.id });
}

/** Up to `limit` grants past `expires_at`, never revoked, whose expiry is not logged yet (cron catch-up: `IS NULL`). */
export async function listUnloggedExpiredJit(
  db: Db,
  input: { now: number; limit: number },
): Promise<Array<{ id: string; user_id: string }>> {
  return db
    .select({ id: jitGrants.id, user_id: jitGrants.userId })
    .from(jitGrants)
    .where(and(lte(jitGrants.expiresAt, input.now), isNull(jitGrants.revokedAt), isNull(jitGrants.expiryLoggedAt)))
    .orderBy(asc(jitGrants.expiresAt), asc(jitGrants.id))
    .limit(input.limit);
}

/** CAS: mark ONE grant's expiry as logged; 1 row only for the first writer (overlapping ticks log once). */
export function markJitExpiryLoggedStmt(db: Db, input: { id: string; now: number }) {
  return db
    .update(jitGrants)
    .set({ expiryLoggedAt: input.now })
    .where(
      and(
        eq(jitGrants.id, input.id),
        lte(jitGrants.expiresAt, input.now),
        isNull(jitGrants.revokedAt),
        isNull(jitGrants.expiryLoggedAt),
      ),
    )
    .returning({ id: jitGrants.id });
}
