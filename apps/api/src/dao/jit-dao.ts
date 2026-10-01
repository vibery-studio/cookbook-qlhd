/**
 * JIT admin grants — read side (SPEC-07 §3.1, DEC-6/7/8). Writes land in C-07-005. Active =
 * `revoked_at IS NULL AND expires_at > now` (unix seconds). JIT never touches `user_roles`; guards that read D1
 * (`admin_only`, `last-admin`, approvers…) exclude a JIT holder via `jitActiveSql`. Signatures fixed for 003–006.
 */
import { and, desc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { jitGrants } from "../db/schema";

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
