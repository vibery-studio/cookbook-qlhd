/**
 * FIX-06 — the ONE copy of the user-admin rules (FIX-03, FIX-05 R3, C-11-001, SPEC-06 FR-12, SPEC-07 JIT). Pure: no D1, no
 * Hono. The write guards (`user-admin-service`, `jit-service`) call these to refuse, and `GET /admin/users` calls the same
 * functions to tell the web what is locked and why — the web never re-derives a rule.
 *
 * Race safety is unchanged: the owner rules are repeated in the WHERE of the batch's first write (`ownerMayAssignSql`,
 * `ownerMayReassignSql`), last-admin by `notLastActiveAdmin`, JIT by the CAS `INSERT … SELECT`.
 */

export const OWNER_ROLE = "giam_doc";
export const ROOT_ROLE = "root";
export const ADMIN_ROLE = "admin";
/** `member` is the RUNWAY base role nobody carries (SPEC-06 DEC-7): never assignable, same answer as a missing name. */
const UNASSIGNABLE_ROLES = new Set(["member"]);

/** The caller as D1 sees it now (`user_roles`; a JIT grant is never there), plus the role catalog. */
export interface AssignContext {
  actorId: string;
  actorRoles: readonly string[];
  actorPermissions: ReadonlySet<string>;
  /** Every role name → its permission keys. */
  rolePermissions: ReadonlyMap<string, readonly string[]>;
  /** Someone (any status) carries `giam_doc` — else the first Giám đốc may be given by any users:write holder. */
  ownerExists: boolean;
}

export interface AssignTarget {
  id: string;
  roles: readonly string[];
}

/** Rules of a role assignment; `self_disable` is the extra rule of a status change. */
export type RoleRule = "self_role" | "admin_only" | "owner_only" | "root_role";
export type EscalationRule = RoleRule | "self_disable";

export type AssignRefusal =
  | { kind: "forbidden"; rule: RoleRule }
  | { kind: "unknown-role" }
  | { kind: "grant-not-held"; missing: string[] };

const isOwner = (ctx: AssignContext) => ctx.actorRoles.includes(OWNER_ROLE);
const isAdmin = (ctx: AssignContext) => ctx.actorRoles.includes(ADMIN_ROLE);
const carriesRolesWrite = (ctx: AssignContext, role: string) => (ctx.rolePermissions.get(role) ?? []).includes("roles:write");

/** FIX-03 (extended): any edit (role, status, name) of a user who holds `admin` needs an admin caller. */
export function editRefusal(ctx: AssignContext, target: AssignTarget): "admin_only" | null {
  return target.roles.includes(ADMIN_ROLE) && !isAdmin(ctx) ? "admin_only" : null;
}

/**
 * FIX-05 R3 (same predicate as `ownerMayAssignSql`): giving `role` needs an owner when it carries `roles:write` —
 * bootstrap: `giam_doc` while nobody carries it.
 */
function needsOwner(ctx: AssignContext, role: string): boolean {
  if (!carriesRolesWrite(ctx, role) || isOwner(ctx)) return false;
  return !(role === OWNER_ROLE && !ctx.ownerExists);
}

/** FIX-05 (same predicate as `ownerMayReassignSql`): only an owner changes the role of a `giam_doc` holder. */
function needsOwnerToReassign(ctx: AssignContext, target: AssignTarget): boolean {
  return target.roles.includes(OWNER_ROLE) && !isOwner(ctx);
}

/**
 * SPEC-06 FR-12: missing = (perms(new role) ∪ perms(old roles)) − perms(actor). Admin exempt; an owner exempt only when
 * the new role carries `roles:write` (the owner-only class, FIX-05 R3).
 */
function grantMissing(ctx: AssignContext, newRole: string, oldRoles: readonly string[]): string[] {
  if (isAdmin(ctx)) return [];
  if (isOwner(ctx) && carriesRolesWrite(ctx, newRole)) return [];
  const needed = new Set([newRole, ...oldRoles].flatMap((r) => ctx.rolePermissions.get(r) ?? []));
  return [...needed].filter((k) => !ctx.actorPermissions.has(k)).sort();
}

/**
 * Invite (`target` null) or change the role of `target` to `newRole`. Order = the guard order of `inviteUser` /
 * `updateUser`: admin_only → root_role → self_role → owner_only → unknown-role → grant_not_held. Null = allowed.
 */
export function assignRefusal(ctx: AssignContext, input: { target: AssignTarget | null; newRole: string }): AssignRefusal | null {
  const { target, newRole } = input;
  if (target !== null && editRefusal(ctx, target) !== null) return { kind: "forbidden", rule: "admin_only" };
  if (newRole === ROOT_ROLE || (target?.roles.includes(ROOT_ROLE) ?? false)) return { kind: "forbidden", rule: "root_role" };
  if (target !== null && target.id === ctx.actorId) return { kind: "forbidden", rule: "self_role" };
  if ((target !== null && needsOwnerToReassign(ctx, target)) || needsOwner(ctx, newRole)) return { kind: "forbidden", rule: "owner_only" };
  if (UNASSIGNABLE_ROLES.has(newRole) || !ctx.rolePermissions.has(newRole)) return { kind: "unknown-role" };
  const missing = grantMissing(ctx, newRole, target?.roles ?? []);
  return missing.length > 0 ? { kind: "grant-not-held", missing } : null;
}

/**
 * FIX-07: re-inviting a pending user mints an activation link for the roles it already carries — the same escalation as
 * assigning them. Order: admin_only (caller neither admin nor owner) → root_role → owner_only (a `giam_doc` holder, or any held role that carries
 * `roles:write`, needs an owner caller). Null = allowed. Race side: `ownerMayReassignSql` in the batch.
 */
export type ReinviteLock = "admin_only" | "root_role" | "owner_only";
export function reinviteRefusal(ctx: AssignContext, target: AssignTarget): ReinviteLock | null {
  // The owner re-sends the link of a pending admin too (else nobody could: admins are `owner_only` here).
  if (editRefusal(ctx, target) !== null && !isOwner(ctx)) return "admin_only";
  if (target.roles.includes(ROOT_ROLE)) return "root_role";
  if (needsOwnerToReassign(ctx, target) || target.roles.some((r) => carriesRolesWrite(ctx, r) && !isOwner(ctx))) return "owner_only";
  return null;
}

// ------------------------------------------------------------------ the list view (GET /admin/users)

/** Why an option of the role select is locked — the rule the API would answer with. */
export type RoleOptionLock = RoleRule | "grant_not_held";
/** Why a whole action of a user row is locked. `self_disable` / `pending` are the status rules (see `statusLock`). */
export type ChangeRoleLock = RoleOptionLock | "no_role_option";
export type StatusLock = "admin_only" | "self_disable" | "pending";

export interface RoleOption {
  name: string;
  locked_reason: RoleOptionLock | null;
}

/** The select's options for `target` (null = invite), in catalog order. Never lists a role nobody may be given (`member`, `root`). */
export function roleOptions(ctx: AssignContext, target: AssignTarget | null): RoleOption[] {
  const out: RoleOption[] = [];
  for (const name of ctx.rolePermissions.keys()) {
    if (name === ROOT_ROLE || UNASSIGNABLE_ROLES.has(name)) continue;
    const refusal = assignRefusal(ctx, { target, newRole: name });
    if (refusal?.kind === "unknown-role") continue;
    out.push({
      name,
      locked_reason: refusal === null ? null : refusal.kind === "forbidden" ? refusal.rule : "grant_not_held",
    });
  }
  return out;
}

/**
 * "Đổi vai trò" of a row: allowed when at least one OTHER role may be given. Locked reason: the first rule that refuses
 * this target whatever the role (admin_only, root_role, self_role, owner_only), else `no_role_option`.
 */
export function changeRoleLock(ctx: AssignContext, target: AssignTarget, options: readonly RoleOption[]): ChangeRoleLock | null {
  if (options.some((o) => o.locked_reason === null && !(target.roles.length === 1 && target.roles[0] === o.name))) return null;
  if (editRefusal(ctx, target) !== null) return "admin_only";
  if (target.roles.includes(ROOT_ROLE)) return "root_role";
  if (target.id === ctx.actorId) return "self_role";
  if (needsOwnerToReassign(ctx, target)) return "owner_only";
  const reasons = new Set(options.map((o) => o.locked_reason));
  return reasons.size === 1 && options[0]?.locked_reason === "grant_not_held" ? "grant_not_held" : "no_role_option";
}

/**
 * "Khóa / Mở khóa" of a row — each is a guard of `updateUser`: `admin_only` / `self_disable` (403), `pending` (409).
 */
export function statusLock(ctx: AssignContext, target: AssignTarget & { status: "pending" | "active" | "disabled" }): StatusLock | null {
  if (editRefusal(ctx, target) !== null) return "admin_only";
  if (target.status === "pending") return "pending";
  if (target.id === ctx.actorId && target.status !== "disabled") return "self_disable";
  return null;
}

// ------------------------------------------------------------------ JIT admin (SPEC-07 §2b)

export type JitGrantRefusal = "self_grant" | "jit_actor" | "not_active" | "already_admin" | "jit_active";

/** `grantJit`'s order: self_grant → jit_actor → user not active → already-admin → jit-active. Null = may grant. */
export function jitGrantRefusal(input: {
  actorId: string;
  actorJitActive: boolean;
  target: { id: string; status: "pending" | "active" | "disabled"; roles: readonly string[] };
  targetJitActive: boolean;
}): JitGrantRefusal | null {
  if (input.target.id === input.actorId) return "self_grant";
  if (input.actorJitActive) return "jit_actor";
  if (input.target.status !== "active") return "not_active";
  if (input.target.roles.includes(ADMIN_ROLE)) return "already_admin";
  if (input.targetJitActive) return "jit_active";
  return null;
}

/** `revokeJit`: the recipient, or a PERMANENT `jit:grant` holder (D1). */
export function mayRevokeJit(input: { actorId: string; actorPermissions: ReadonlySet<string>; recipientId: string }): boolean {
  return input.actorId === input.recipientId || input.actorPermissions.has("jit:grant");
}
