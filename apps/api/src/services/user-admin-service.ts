/**
 * user-admin-service — invite-only user lifecycle (SPEC-01 FR-1..3, §4).
 *
 *   inviteUser   → pending user + exactly one role + invite token + audit, ONE db.batch
 *   reinvite     → new token (older unused ones die), only while pending
 *   activate     → CAS-consume invite token, set password, status active, audit, ONE db.batch
 *   updateUser   → role swap / disable / enable / rename; last-admin guard inside the write
 *
 * Escalation guards (FIX-03, SPEC-06 DEC-5): nobody changes their OWN role (`self_role`), and only an
 * admin assigns the `admin` role or touches a user who holds it (`admin_only`: invite, role, status,
 * name). The actor's roles are read from D1 in the same request (read-then-write, accepted in FIX-03),
 * not the principal cache. Each refusal writes one `permission.denied` row before the caller sees 403.
 *
 * No Hono, no HTTP. Routes translate the typed outcomes.
 *
 * Last-admin guard design: the check is an SQL predicate (`notLastActiveAdmin`) placed in the
 * WHERE of the first write of the batch (the role INSERT…SELECT, or the users UPDATE). D1 runs a
 * batch as one transaction on a single writer, so two concurrent "demote the other admin" calls
 * serialize and the second sees the first's effect; there is no read-then-write window. Every
 * later statement of the batch (drop old roles, status, refresh revoke, audit) is conditional on
 * that first write having taken effect, so a refused change leaves NO partial state and NO audit row.
 */
import { generateOpaqueToken, hashPassword, hashToken, VERIFICATION_TOKEN_BYTES } from "@runway/auth";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import { writeAuditEvent } from "../dao/audit-dao";
import { invalidatePrincipalCache } from "../dao/session-cache";
import {
  activateUserStmt,
  auditInsertWhen,
  findUserByEmail,
  findUserById,
  insertInvitedUserStmt,
  notLastActiveAdmin,
  revokeUserRefreshTokensStmt,
  updateUserFieldsStmt,
  userHasStatus,
  type UserDto,
} from "../dao/user-dao";
import {
  consumeInviteTokenStmt,
  findVerificationTokenByHash,
  insertInviteTokenIfPendingStmt,
  inviteConsumedAt,
  invalidateOtherInviteTokensStmt,
} from "../dao/verification-token-dao";
import { listPermissionKeysForRoleNames, listPermissionKeysForUser, roleNameExists } from "../dao/permission-dao";
import { dropOtherRolesStmt, grantRoleByNameStmt, listRoleNamesForUser, userHasRole } from "../dao/role-dao";
import { generateUlid } from "../utils/id";
import { passwordHashParams } from "../utils/password-params";

export const INVITE_TTL_SECONDS = 72 * 60 * 60;

export interface UserAdminDeps {
  db: Db;
  kv: KVNamespace;
  env: Bindings;
  now: () => number; // unix seconds
}

export interface AdminUserView {
  id: string;
  email: string;
  displayName: string | null;
  status: UserDto["status"];
  roles: string[];
}

async function view(db: Db, user: UserDto): Promise<AdminUserView> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles: await listRoleNamesForUser(db, user.id),
  };
}

/** Raw token + its stored hash. Only the hash is persisted. */
function newInviteToken(env: Bindings): { raw: string; hash: string } {
  const raw = generateOpaqueToken(VERIFICATION_TOKEN_BYTES);
  return { raw, hash: hashToken(raw, env.TOKEN_PEPPER) };
}

export function activationUrl(env: Bindings, rawToken: string): string {
  return `${env.APP_ORIGIN}/activate?token=${encodeURIComponent(rawToken)}`;
}

// ------------------------------- invite ------------------------------------

export type EscalationRule = "self_role" | "admin_only";

export type InviteResult =
  | { kind: "ok"; user: AdminUserView; rawToken: string; expiresAt: number }
  | { kind: "duplicate-email" }
  | { kind: "forbidden"; rule: EscalationRule }
  | { kind: "unknown-role" }
  | { kind: "grant-not-held"; missing: string[] };

/** `member` is the RUNWAY base role nobody carries (SPEC-06 DEC-7): never assignable, same answer as a missing name. */
const UNASSIGNABLE_ROLES = new Set(["member"]);

async function roleAssignable(db: Db, name: string): Promise<boolean> {
  return !UNASSIGNABLE_ROLES.has(name) && (await roleNameExists(db, name));
}

/**
 * FR-12 (SPEC-06): a non-admin actor may only grant or take away roles whose permissions their own cover.
 * missing = (perms(new role) ∪ perms(old roles)) − perms(actor), read from D1 now (no principal cache). Admin exempt.
 * Writes one `permission.denied` row when non-empty. Read-then-write like FIX-03 (accepted there).
 */
async function checkGrantHeld(
  db: Db,
  input: { actorId: string; target: string; newRole: string; oldRoles: string[]; ip?: string | null },
): Promise<{ kind: "grant-not-held"; missing: string[] } | null> {
  if (await actorIsAdmin(db, input.actorId)) return null;
  const [needed, held] = await Promise.all([
    listPermissionKeysForRoleNames(db, [input.newRole, ...input.oldRoles]),
    listPermissionKeysForUser(db, input.actorId),
  ]);
  const heldSet = new Set(held);
  const missing = needed.filter((k) => !heldSet.has(k)).sort();
  if (missing.length === 0) return null;
  await writeAuditEvent(db, {
    actor: input.actorId,
    action: "permission.denied",
    target: input.target,
    metadata: { rule: "grant_not_held", permission: "users:write", role: input.newRole },
    ip: input.ip ?? null,
  });
  return { kind: "grant-not-held", missing };
}

/** Writes the `permission.denied` row for an escalation refusal and returns the typed outcome. */
async function denyEscalation(
  db: Db,
  input: { actorId: string; target: string; rule: EscalationRule; role: string; ip?: string | null },
): Promise<{ kind: "forbidden"; rule: EscalationRule }> {
  await writeAuditEvent(db, {
    actor: input.actorId,
    action: "permission.denied",
    target: input.target,
    metadata: { rule: input.rule, permission: "users:write", role: input.role },
    ip: input.ip ?? null,
  });
  return { kind: "forbidden", rule: input.rule };
}

async function actorIsAdmin(db: Db, actorId: string): Promise<boolean> {
  return (await listRoleNamesForUser(db, actorId)).includes("admin");
}

/**
 * Email is NOT sent: EmailPort has only `verify-email` / `password-reset` templates and neither
 * fits an invite. The admin shares `activation_url` (SPEC DEC-2). Add an `invite` template later.
 */
export async function inviteUser(
  deps: UserAdminDeps,
  input: { actorId: string; email: string; displayName: string; role: string; ip?: string | null },
): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  if (input.role === "admin" && !(await actorIsAdmin(deps.db, input.actorId))) {
    return denyEscalation(deps.db, { actorId: input.actorId, target: "user:new", rule: "admin_only", role: input.role, ip: input.ip });
  }
  if (!(await roleAssignable(deps.db, input.role))) return { kind: "unknown-role" };
  const notHeld = await checkGrantHeld(deps.db, {
    actorId: input.actorId,
    target: "user:new",
    newRole: input.role,
    oldRoles: [],
    ip: input.ip,
  });
  if (notHeld !== null) return notHeld;
  if ((await findUserByEmail(deps.db, email)) !== null) return { kind: "duplicate-email" };

  const now = deps.now();
  const userId = generateUlid();
  const token = newInviteToken(deps.env);
  const expiresAt = now + INVITE_TTL_SECONDS;
  // Unusable password: a valid-format hash of a random secret nobody ever sees.
  const passwordHash = await hashPassword(generateOpaqueToken(32), passwordHashParams(deps.env));

  // The role may be deleted between the check above and this batch: the user row, the grant, the token and the audit
  // row all depend on the role existing INSIDE the batch (one transaction), so a vanished role creates nobody.
  const roleExists = sql`EXISTS (SELECT 1 FROM roles WHERE name = ${input.role})`;
  let granted: unknown;
  try {
    const results = await deps.db.batch([
      insertInvitedUserStmt(deps.db, {
        id: userId,
        email,
        displayName: input.displayName,
        passwordHash,
        now,
        when: roleExists,
      }),
      grantRoleByNameStmt(deps.db, { userId, roleName: input.role }),
      insertInviteTokenIfPendingStmt(deps.db, { tokenHash: token.hash, userId, expiresAt, createdAt: now }),
      auditInsertWhen(deps.db, {
        actor: input.actorId,
        action: "user.invited",
        target: `user:${userId}`,
        metadata: { role: input.role },
        ts: now,
        when: userHasRole(userId, input.role),
      }),
    ]);
    granted = results[1];
  } catch (err) {
    // Lost a race on the UNIQUE(email) index: the whole batch rolled back.
    if ((await findUserByEmail(deps.db, email)) !== null) return { kind: "duplicate-email" };
    throw err;
  }
  if (Array.isArray(granted) && granted.length === 0) return { kind: "unknown-role" };

  const user = await findUserById(deps.db, userId);
  if (user === null) throw new Error("inviteUser: user missing after batch");
  return { kind: "ok", user: await view(deps.db, user), rawToken: token.raw, expiresAt };
}

export type ReinviteResult =
  | { kind: "ok"; rawToken: string; expiresAt: number }
  | { kind: "not-found" }
  | { kind: "already-active" };

export async function reinviteUser(
  deps: UserAdminDeps,
  input: { actorId: string; userId: string },
): Promise<ReinviteResult> {
  const user = await findUserById(deps.db, input.userId);
  if (user === null) return { kind: "not-found" };
  if (user.status !== "pending") return { kind: "already-active" };

  const now = deps.now();
  const token = newInviteToken(deps.env);
  const expiresAt = now + INVITE_TTL_SECONDS;
  const tokenExists = sql`EXISTS (SELECT 1 FROM verification_tokens WHERE token_hash = ${token.hash})`;

  // The new token row is inserted only while the user is still pending (CAS); the rest of the
  // batch depends on it.
  const results = await deps.db.batch([
    insertInviteTokenIfPendingStmt(deps.db, {
      tokenHash: token.hash,
      userId: input.userId,
      expiresAt,
      createdAt: now,
    }),
    invalidateOtherInviteTokensStmt(deps.db, { userId: input.userId, exceptHash: token.hash, now }),
    auditInsertWhen(deps.db, {
      actor: input.actorId,
      action: "user.invited",
      target: `user:${input.userId}`,
      metadata: { reinvite: true },
      ts: now,
      when: tokenExists,
    }),
  ]);
  const inserted = results[0];
  if (Array.isArray(inserted) && inserted.length === 0) return { kind: "already-active" };
  return { kind: "ok", rawToken: token.raw, expiresAt };
}

// ------------------------------ activate -----------------------------------

export type ActivateResult = { kind: "ok"; userId: string } | { kind: "invalid-or-expired" };

export async function activateUser(
  deps: UserAdminDeps,
  input: { rawToken: string; password: string },
): Promise<ActivateResult> {
  const now = deps.now();
  const tokenHash = hashToken(input.rawToken, deps.env.TOKEN_PEPPER);

  // Cheap early exit (also gives us the user id for the audit actor). The CAS below is the
  // authority; this read only avoids paying scrypt for unknown tokens.
  const known = await findVerificationTokenByHash(deps.db, tokenHash);
  if (known === null || known.purpose !== "invite" || known.usedAt !== null || known.expiresAt <= now) {
    return { kind: "invalid-or-expired" };
  }

  const passwordHash = await hashPassword(input.password, passwordHashParams(deps.env));
  const consumed = inviteConsumedAt(tokenHash, now);
  const results = await deps.db.batch([
    consumeInviteTokenStmt(deps.db, tokenHash, now),
    activateUserStmt(deps.db, { id: known.userId, passwordHash, now }),
    auditInsertWhen(deps.db, {
      actor: known.userId,
      action: "user.activated",
      target: `user:${known.userId}`,
      ts: now,
      when: sql`${consumed} AND EXISTS (SELECT 1 FROM users WHERE id = ${known.userId} AND status = 'active' AND verified_at = ${now})`,
    }),
  ]);
  const consumedRows = results[0];
  const activatedRows = results[1];
  if (!Array.isArray(consumedRows) || consumedRows.length === 0) return { kind: "invalid-or-expired" };
  if (!Array.isArray(activatedRows) || activatedRows.length === 0) return { kind: "invalid-or-expired" };

  await invalidatePrincipalCache(deps.kv, known.userId);
  return { kind: "ok", userId: known.userId };
}

// ------------------------------- update ------------------------------------

export type UpdateUserResult =
  | { kind: "ok"; user: AdminUserView }
  | { kind: "not-found" }
  | { kind: "last-admin" }
  | { kind: "pending" }
  | { kind: "forbidden"; rule: EscalationRule }
  | { kind: "unknown-role" }
  | { kind: "grant-not-held"; missing: string[] };

const and = (...parts: Array<SQL | undefined>): SQL => {
  const list = parts.filter((p): p is SQL => p !== undefined);
  return list.length === 0 ? sql`1 = 1` : sql.join(list, sql` AND `);
};

export async function updateUser(
  deps: UserAdminDeps,
  input: {
    actorId: string;
    userId: string;
    role?: string;
    status?: "active" | "disabled";
    displayName?: string;
    ip?: string | null;
  },
): Promise<UpdateUserResult> {
  const { db } = deps;
  const id = input.userId;
  const user = await findUserById(db, id);
  if (user === null) return { kind: "not-found" };
  const currentRoles = await listRoleNamesForUser(db, id);

  const roleChange =
    input.role !== undefined && !(currentRoles.length === 1 && currentRoles[0] === input.role);
  const deny = { actorId: input.actorId, target: `user:${id}`, role: input.role ?? currentRoles[0] ?? "", ip: input.ip };
  // Any PATCH on a user who holds `admin` (role, status, name) needs an admin caller.
  if (currentRoles.includes("admin") && !(await actorIsAdmin(db, input.actorId))) {
    return denyEscalation(db, { ...deny, rule: "admin_only" });
  }
  if (roleChange && input.role !== undefined) {
    if (input.actorId === id) return denyEscalation(db, { ...deny, rule: "self_role" });
    if (input.role === "admin" && !(await actorIsAdmin(db, input.actorId))) {
      return denyEscalation(db, { ...deny, rule: "admin_only" });
    }
    if (!(await roleAssignable(db, input.role))) return { kind: "unknown-role" };
    const notHeld = await checkGrantHeld(db, {
      actorId: input.actorId,
      target: `user:${id}`,
      newRole: input.role,
      oldRoles: currentRoles,
      ip: input.ip,
    });
    if (notHeld !== null) return notHeld;
  }

  if (input.status !== undefined && user.status === "pending") return { kind: "pending" };

  const statusChange = input.status !== undefined && input.status !== user.status;
  const renameChange = input.displayName !== undefined && input.displayName !== user.displayName;
  if (!roleChange && !statusChange && !renameChange) return { kind: "ok", user: await view(db, user) };

  const disabling = statusChange && input.status === "disabled";
  const targetIsActiveAdmin = user.status === "active" && currentRoles.includes("admin");
  const removesAdmin = targetIsActiveAdmin && ((roleChange && input.role !== "admin") || disabling);
  const guard = removesAdmin ? notLastActiveAdmin(id) : undefined;
  const now = deps.now();
  const newRole = input.role;

  // `held`: the batch's first write took effect; later statements depend on it.
  let held: SQL | undefined;
  const stmts: unknown[] = [];

  if (roleChange && newRole !== undefined) {
    stmts.push(grantRoleByNameStmt(db, { userId: id, roleName: newRole, when: guard }));
    stmts.push(dropOtherRolesStmt(db, { userId: id, keepRoleName: newRole }));
    held = userHasRole(id, newRole);
    if (statusChange || renameChange) {
      stmts.push(
        updateUserFieldsStmt(db, { id, now, status: input.status, displayName: input.displayName, when: held }),
      );
    }
  } else if (statusChange || renameChange) {
    stmts.push(
      updateUserFieldsStmt(db, { id, now, status: input.status, displayName: input.displayName, when: guard }),
    );
    if (disabling) held = userHasStatus(id, "disabled");
  }

  if (disabling) {
    stmts.push(revokeUserRefreshTokensStmt(db, { userId: id, now, when: and(held, userHasStatus(id, "disabled")) }));
  }

  const audit = (action: string, extra: SQL | undefined, metadata?: Record<string, unknown>) =>
    stmts.push(
      auditInsertWhen(db, {
        actor: input.actorId,
        action,
        target: `user:${id}`,
        metadata,
        ts: now,
        when: and(roleChange ? held : undefined, extra),
      }),
    );
  if (roleChange && newRole !== undefined) {
    audit("user.role_changed", userHasRole(id, newRole), { from: currentRoles[0] ?? null, to: newRole });
  }
  if (statusChange && input.status !== undefined) {
    audit(disabling ? "user.disabled" : "user.enabled", userHasStatus(id, input.status));
  }
  if (renameChange && input.displayName !== undefined) {
    audit(
      "user.renamed",
      sql`EXISTS (SELECT 1 FROM users WHERE id = ${id} AND display_name = ${input.displayName})`,
    );
  }

  const results = await db.batch(stmts as unknown as Parameters<Db["batch"]>[0]);

  const first: unknown = results[0];
  const firstRows = Array.isArray(first) ? first.length : 0;
  // Role path: 0 rows from the grant and the user still lacks the role = refused: either the role vanished since
  // the check above (→ unknown-role) or the last-admin guard said no. Nothing else in the batch took effect.
  if (roleChange && newRole !== undefined && firstRows === 0 && !currentRoles.includes(newRole)) {
    return (await roleNameExists(db, newRole)) ? { kind: "last-admin" } : { kind: "unknown-role" };
  }
  // Status path: 0 rows from the guarded UPDATE = refused (the user row exists, we read it above).
  if (removesAdmin && !roleChange && firstRows === 0) return { kind: "last-admin" };

  // Role/status changed → next request must re-load the principal.
  await invalidatePrincipalCache(deps.kv, id);
  const fresh = await findUserById(db, id);
  if (fresh === null) return { kind: "not-found" };
  return { kind: "ok", user: await view(db, fresh) };
}
