/**
 * user-admin-service — invite-only user lifecycle (SPEC-01 FR-1..3, §4).
 *
 *   inviteUser   → pending user + exactly one role + invite token + audit, ONE db.batch
 *   reinvite     → new token (older unused ones die), only while pending
 *   activate     → CAS-consume invite token, set password, status active, audit, ONE db.batch
 *   updateUser   → role swap / disable / enable / rename; last-admin guard inside the write
 *
 * Escalation guards (FIX-03, SPEC-06 DEC-5, FIX-05): nobody changes their OWN role (`self_role`); only an
 * admin touches a user who holds `admin` (`admin_only`: role, status, name); only an owner (`giam_doc` holder)
 * invites into / assigns a role that carries `roles:write` (`owner_only`: admin, giam_doc, custom; bootstrap: the
 * first `giam_doc` while nobody carries it) or changes a Giám đốc's role (`owner_only`) — the pure rules of
 * `domain/user-assign.ts` (FIX-06: the same functions build `GET /admin/users` `can` / `locked_reason`) give the 403, and the same rule sits in the WHERE of the batch's first write (`ownerMayAssignSql`), so a
 * role or actor changing in between grants nothing. Owners skip FR-12 only for that owner-only class.
 * The actor's roles are read from D1 in the same request, not the principal cache. Each refusal writes one
 * `permission.denied` row before the caller sees 403.
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
  listUsersPaginated,
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
import { listPermissionKeysForUser, roleNameExists } from "../dao/permission-dao";
import {
  anyOwnerExists,
  dropOtherRolesStmt,
  grantRoleByNameStmt,
  listRoleDetails,
  listRoleNamesForUser,
  ownerMayAssignSql,
  ownerMayReassignSql,
  userHasRole,
} from "../dao/role-dao";
import {
  assignRefusal,
  reinviteRefusal,
  changeRoleLock,
  editRefusal,
  jitGrantRefusal,
  mayRevokeJit,
  roleOptions,
  statusLock,
  type AssignContext,
  type AssignRefusal,
  type ChangeRoleLock,
  type ReinviteLock,
  type EscalationRule,
  type JitGrantRefusal,
  type RoleOption,
  type StatusLock,
} from "../domain/user-assign";
import { listJitGrants } from "../dao/jit-dao";
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

// ------------------------------- list --------------------------------------

export interface AdminUserRow extends AdminUserView {
  can: { change_role: boolean; set_status: boolean; reinvite: boolean; grant_jit: boolean; revoke_jit: boolean };
  locked_reason: { change_role: ChangeRoleLock | null; set_status: StatusLock | null; reinvite: ReinviteLock | null; grant_jit: JitGrantRefusal | null };
  role_options: Array<RoleOption & { label: string }>;
  jit_grant: { id: string; expires_at: number } | null;
}

/**
 * FIX-06: `GET /admin/users` for one caller — every lock the screen shows comes from the rules the write guards use
 * (`assignRefusal`, `editRefusal`, `jitGrantRefusal`, `mayRevokeJit`). `callerPermissions` = the route gates' view (the
 * principal): no `users:write` → no user action; no `jit:grant` → no grant. Reads: the page, the caller + catalog,
 * active JIT grants — no per-user rule query.
 */
export async function listUsersFor(
  db: Db,
  input: { actorId: string; callerPermissions: readonly string[]; cursor?: string; limit: number; now: number },
): Promise<{ items: AdminUserRow[]; next_cursor: string | null; invite_roles: Array<RoleOption & { label: string }> }> {
  const [page, ctx, grants, roles] = await Promise.all([
    listUsersPaginated(db, { cursor: input.cursor, limit: input.limit }),
    loadAssignContext(db, input.actorId),
    listJitGrants(db, { activeOnly: true, now: input.now }),
    listRoleDetails(db),
  ]);
  const labels = new Map(roles.map((r) => [r.name, r.label]));
  const labelled = (options: RoleOption[]) => options.map((o) => ({ ...o, label: labels.get(o.name) ?? o.name }));
  const writer = input.callerPermissions.includes("users:write");
  const granter = input.callerPermissions.includes("jit:grant");
  const activeJit = new Map(grants.filter((g) => g.state === "active").map((g) => [g.user_id, g]));
  const items = await Promise.all(
    page.items.map(async (u): Promise<AdminUserRow> => {
      const roleNames = await listRoleNamesForUser(db, u.id);
      const target = { id: u.id, roles: roleNames, status: u.status };
      const options = writer ? roleOptions(ctx, target) : [];
      const changeLock = writer ? changeRoleLock(ctx, target, options) : null;
      const statusLocked = writer ? statusLock(ctx, target) : null;
      const reinviteLock = writer && u.status === "pending" ? reinviteRefusal(ctx, target) : null;
      const grant = activeJit.get(u.id);
      const jitLock = granter
        ? jitGrantRefusal({ actorId: input.actorId, actorJitActive: activeJit.has(input.actorId), target, targetJitActive: grant !== undefined })
        : null;
      return {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        status: u.status,
        roles: roleNames,
        can: {
          change_role: writer && changeLock === null,
          set_status: writer && statusLocked === null,
          reinvite: writer && u.status === "pending" && reinviteLock === null,
          grant_jit: granter && jitLock === null,
          revoke_jit: grant !== undefined && mayRevokeJit({ actorId: input.actorId, actorPermissions: ctx.actorPermissions, recipientId: u.id }),
        },
        locked_reason: { change_role: changeLock, set_status: statusLocked, reinvite: reinviteLock, grant_jit: jitLock },
        role_options: labelled(options),
        jit_grant: grant === undefined ? null : { id: grant.id, expires_at: grant.expires_at },
      };
    }),
  );
  return { items, next_cursor: page.next_cursor, invite_roles: writer ? labelled(roleOptions(ctx, null)) : [] };
}

// ------------------------------- invite ------------------------------------

export type { EscalationRule } from "../domain/user-assign";

export type InviteResult =
  | { kind: "ok"; user: AdminUserView; rawToken: string; expiresAt: number }
  | { kind: "duplicate-email" }
  | { kind: "forbidden"; rule: EscalationRule }
  | { kind: "unknown-role" }
  | { kind: "grant-not-held"; missing: string[] };

/**
 * The caller + role catalog as D1 sees them now (never the principal cache) — the input of the FIX-06 pure rules
 * (`domain/user-assign.ts`) that both the write guards below and `GET /admin/users` use.
 */
export async function loadAssignContext(db: Db, actorId: string): Promise<AssignContext> {
  const [actorRoles, actorPermissions, roles, ownerExists] = await Promise.all([
    listRoleNamesForUser(db, actorId),
    listPermissionKeysForUser(db, actorId),
    listRoleDetails(db),
    anyOwnerExists(db),
  ]);
  return {
    actorId,
    actorRoles,
    actorPermissions: new Set(actorPermissions),
    rolePermissions: new Map(roles.map((r) => [r.name, r.permissions])),
    ownerExists,
  };
}

/** Writes the one `permission.denied` row of a refusal (403) and returns it; other refusals pass through. */
async function refuse(
  db: Db,
  refusal: AssignRefusal | { kind: "forbidden"; rule: "self_disable" },
  input: { actorId: string; target: string; role: string; ip?: string | null },
): Promise<AssignRefusal | { kind: "forbidden"; rule: "self_disable" }> {
  if (refusal.kind === "unknown-role") return refusal;
  await writeAuditEvent(db, {
    actor: input.actorId,
    action: "permission.denied",
    target: input.target,
    metadata: { rule: refusal.kind === "forbidden" ? refusal.rule : "grant_not_held", permission: "users:write", role: input.role },
    ip: input.ip ?? null,
  });
  return refusal;
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
  const refusal = assignRefusal(await loadAssignContext(deps.db, input.actorId), { target: null, newRole: input.role });
  if (refusal !== null) return refuse(deps.db, refusal, { actorId: input.actorId, target: "user:new", role: input.role, ip: input.ip });
  if ((await findUserByEmail(deps.db, email)) !== null) return { kind: "duplicate-email" };

  const now = deps.now();
  const userId = generateUlid();
  const token = newInviteToken(deps.env);
  const expiresAt = now + INVITE_TTL_SECONDS;
  // Unusable password: a valid-format hash of a random secret nobody ever sees.
  const passwordHash = await hashPassword(generateOpaqueToken(32), passwordHashParams(deps.env));

  // The role may be deleted between the check above and this batch: the user row, the grant, the token and the audit
  // row all depend on the role existing INSIDE the batch (one transaction), so a vanished role creates nobody.
  // FIX-05 R3 inside the write: the role gained roles:write or the actor lost giam_doc meanwhile → nobody is created.
  const roleExists = sql`EXISTS (SELECT 1 FROM roles WHERE name = ${input.role}) AND ${ownerMayAssignSql(input.actorId, input.role)}`;
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
  if (Array.isArray(granted) && granted.length === 0) {
    // Refused inside the batch: the role vanished, or the owner rule changed meanwhile — classify against D1 now.
    const late = assignRefusal(await loadAssignContext(deps.db, input.actorId), { target: null, newRole: input.role });
    if (late?.kind === "forbidden" && late.rule === "owner_only") {
      return refuse(deps.db, late, { actorId: input.actorId, target: "user:new", role: input.role, ip: input.ip });
    }
    return { kind: "unknown-role" };
  }

  const user = await findUserById(deps.db, userId);
  if (user === null) throw new Error("inviteUser: user missing after batch");
  return { kind: "ok", user: await view(deps.db, user), rawToken: token.raw, expiresAt };
}

export type ReinviteResult =
  | { kind: "ok"; rawToken: string; expiresAt: number }
  | { kind: "forbidden"; rule: EscalationRule }
  | { kind: "not-found" }
  | { kind: "already-active" };

export async function reinviteUser(
  deps: UserAdminDeps,
  input: { actorId: string; userId: string; ip?: string | null },
): Promise<ReinviteResult> {
  const user = await findUserById(deps.db, input.userId);
  if (user === null) return { kind: "not-found" };
  if (user.status !== "pending") return { kind: "already-active" };

  // FIX-07: same guards as assigning the roles the pending account already holds.
  const targetRoles = await listRoleNamesForUser(deps.db, input.userId);
  const rule = reinviteRefusal(await loadAssignContext(deps.db, input.actorId), { id: input.userId, roles: targetRoles });
  if (rule !== null) {
    const denied = await refuse(deps.db, { kind: "forbidden", rule }, {
      actorId: input.actorId,
      target: `user:${input.userId}`,
      role: targetRoles[0] ?? "",
      ip: input.ip,
    });
    return denied as { kind: "forbidden"; rule: EscalationRule };
  }

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
      when: ownerMayReassignSql(input.actorId, input.userId),
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
  if (Array.isArray(inserted) && inserted.length === 0) {
    // Refused inside the batch: no longer pending, or the owner rule changed meanwhile — classify against D1 now.
    const late = reinviteRefusal(await loadAssignContext(deps.db, input.actorId), { id: input.userId, roles: await listRoleNamesForUser(deps.db, input.userId) });
    if (late === "owner_only") {
      return (await refuse(deps.db, { kind: "forbidden", rule: late }, { actorId: input.actorId, target: `user:${input.userId}`, role: "", ip: input.ip })) as { kind: "forbidden"; rule: EscalationRule };
    }
    return { kind: "already-active" };
  }
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
  const ctx = await loadAssignContext(db, input.actorId);
  const target = { id, roles: currentRoles };
  // Any PATCH on a user who holds `admin` (role, status, name) needs an admin caller.
  if (editRefusal(ctx, target) !== null) return refuse(db, { kind: "forbidden", rule: "admin_only" }, deny);
  if (roleChange && input.role !== undefined) {
    const refusal = assignRefusal(ctx, { target, newRole: input.role });
    if (refusal !== null) return refuse(db, refusal, deny);
  }

  if (input.status === "disabled" && id === input.actorId && user.status !== "disabled") {
    return refuse(db, { kind: "forbidden", rule: "self_disable" }, deny);
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
    stmts.push(grantRoleByNameStmt(db, { userId: id, roleName: newRole, when: and(guard, ownerMayAssignSql(input.actorId, newRole), ownerMayReassignSql(input.actorId, id)) }));
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
    const late = assignRefusal(await loadAssignContext(db, input.actorId), { target: { id, roles: await listRoleNamesForUser(db, id) }, newRole });
    if (late?.kind === "forbidden" && late.rule === "owner_only") return refuse(db, late, deny);
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
