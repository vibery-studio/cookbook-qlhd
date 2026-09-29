/**
 * Admin service — the write-side surface for RBAC mutations. Owns the
 * "role change ⇒ session-cache invalidation" invariant so route handlers
 * don't have to remember it. Read-only ops (listUsers) live here too so
 * routes stay thin.
 *
 * NOTE: v1 does NOT insert jti-revocation entries on role change. The
 * next authenticated request will hit the middleware's cache-miss path
 * and re-load fresh permissions from D1 — max staleness is one access-
 * token lifetime (120s) plus the KV write→read consistency window
 * (~60s in the pathological case). If a role change needs stronger
 * revocation semantics (e.g., demoting an admin), route handlers can
 * call `logout` explicitly to insert jti entries. Documented in
 * `docs/rbac.md`.
 */
import type { Bindings } from "../env";
import { listUsersPaginated } from "../dao/user-dao";
import { listRoleNamesForUser, assignRoleToUser, revokeRoleFromUser, findRoleByName } from "../dao/role-dao";
import { invalidatePrincipalCache } from "../dao/session-cache";
import type { Db } from "../db/client";

export interface AdminServiceDeps {
  db: Db;
  kv: KVNamespace;
  env: Bindings;
}

export interface AdminUserItem {
  id: string;
  email: string;
  display_name: string | null;
  status: "pending" | "active" | "disabled";
  roles: string[];
}

export interface ListUsersInput {
  cursor?: string;
  limit: number;
}

export interface ListUsersResult {
  items: AdminUserItem[];
  next_cursor: string | null;
}

export async function listUsers(
  deps: AdminServiceDeps,
  input: ListUsersInput,
): Promise<ListUsersResult> {
  const page = await listUsersPaginated(deps.db, input);

  // Fetch roles per user. For small page sizes (<=100) N+1 is acceptable
  // — a single grouped join would micro-optimize this at the cost of a
  // more complex query. Revisit if page-size grows past 100.
  const items: AdminUserItem[] = await Promise.all(
    page.items.map(async (u) => ({
      id: u.id,
      email: u.email,
      display_name: u.displayName,
      status: u.status,
      roles: await listRoleNamesForUser(deps.db, u.id),
    })),
  );

  return { items, next_cursor: page.next_cursor };
}

export type AssignRoleResult =
  | { kind: "ok"; assigned: boolean }
  | { kind: "unknown-role" };

/**
 * Assigns a role by NAME (not id) so callers don't need to know the
 * fixed ULID literals from the seed migration. Idempotent: repeat
 * assignments return `{kind:"ok", assigned:false}`. Invalidates the
 * user's session cache so the next request re-loads permissions from
 * D1.
 */
export async function assignRoleByName(
  deps: AdminServiceDeps,
  input: { userId: string; roleName: string },
): Promise<AssignRoleResult> {
  const role = await findRoleByName(deps.db, input.roleName);
  if (role === null) return { kind: "unknown-role" };

  const assigned = await assignRoleToUser(deps.db, {
    userId: input.userId,
    roleId: role.id,
  });

  if (assigned) {
    // Cache bust only when the assignment was actually new. A no-op
    // assignment (already had the role) doesn't need to churn KV.
    await invalidatePrincipalCache(deps.kv, input.userId);
  }

  return { kind: "ok", assigned };
}

export async function revokeRoleByName(
  deps: AdminServiceDeps,
  input: { userId: string; roleName: string },
): Promise<AssignRoleResult> {
  const role = await findRoleByName(deps.db, input.roleName);
  if (role === null) return { kind: "unknown-role" };

  const revoked = await revokeRoleFromUser(deps.db, {
    userId: input.userId,
    roleId: role.id,
  });

  if (revoked) {
    await invalidatePrincipalCache(deps.kv, input.userId);
  }

  return { kind: "ok", assigned: revoked };
}
