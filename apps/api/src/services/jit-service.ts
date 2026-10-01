/**
 * Just-in-time admin grants (SPEC-07 FR-5/6/9, DEC-5..8). No Hono, no HTTP — routes translate the typed outcomes.
 *
 *   grantJit        → 404 → self_grant → jit_actor → user not active → already-admin → jit-active (PLAN-07 §2b order),
 *                     then ONE batch: CAS `INSERT … SELECT` (every guard re-checked in its WHERE) + `jit.granted` audit
 *                     guarded by `changes() = 1`; recipient's cached principal purged.
 *   revokeJit       → 404 → caller is a PERMANENT `jit:grant` holder (D1 `user_roles`) or the recipient, else 403 +
 *                     one `permission.denied` → CAS UPDATE + `jit.revoked` audit (same batch) → `not-active` on 0 rows.
 *   listJit         → newest first, state computed at read time.
 *   sweepExpiredJit → `*\/5` cron: logs `jit.expired` once per grant (`expiry_logged_at`), purges caches. Access is
 *                     already cut per request by `valid_until` (DEC-8); this only writes the record.
 *
 * Every guard about the CALLER reads D1, never the principal (DEC-7): a JIT holder's principal is `admin` only.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { writeAuditEvent } from "../dao/audit-dao";
import {
  findActiveJit,
  findJitGrantById,
  insertJitGrantStmt,
  listJitGrants,
  listUnloggedExpiredJit,
  markJitExpiryLoggedStmt,
  revokeJitGrantStmt,
  type JitGrantDto,
} from "../dao/jit-dao";
import { listPermissionKeysForUser } from "../dao/permission-dao";
import { listRoleNamesForUser } from "../dao/role-dao";
import { invalidatePrincipalCache } from "../dao/session-cache";
import { auditInsertWhen, findUserById } from "../dao/user-dao";
import { generateUlid } from "../utils/id";

export interface JitDeps {
  db: Db;
  kv: KVNamespace;
  now: () => number; // unix seconds
}

/** Grants per cron tick (SPEC-07 §3.3). Missed ones are caught up next tick. */
export const JIT_SWEEP_LIMIT = 100;

const JIT_ROLE = "admin";
const changedOne = sql`changes() = 1`;

type Batch = Parameters<Db["batch"]>[0];

export type JitDenyRule = "self_grant" | "jit_actor";

async function deny(
  db: Db,
  input: { actorId: string; target: string; rule?: JitDenyRule; ip?: string | null },
): Promise<void> {
  await writeAuditEvent(db, {
    actor: input.actorId,
    action: "permission.denied",
    target: input.target,
    metadata: { permission: "jit:grant", ...(input.rule !== undefined && { rule: input.rule }) },
    ip: input.ip ?? null,
  });
}

// ------------------------------------------------------------------ list

export function listJit(deps: JitDeps, input: { activeOnly: boolean }): Promise<JitGrantDto[]> {
  return listJitGrants(deps.db, { activeOnly: input.activeOnly, now: deps.now() });
}

// ------------------------------------------------------------------ grant

export type GrantJitResult =
  | { kind: "ok"; grant: JitGrantDto }
  | { kind: "not-found" }
  | { kind: "forbidden"; rule: JitDenyRule }
  | { kind: "not-active-user" }
  | { kind: "already-admin" }
  | { kind: "jit-active" };

export async function grantJit(
  deps: JitDeps,
  input: { actorId: string; userId: string; reason: string; minutes: number; ip?: string | null },
): Promise<GrantJitResult> {
  const { db } = deps;
  const now = deps.now();
  const target = `user:${input.userId}`;

  const user = await findUserById(db, input.userId);
  if (user === null) return { kind: "not-found" };
  if (input.userId === input.actorId) {
    await deny(db, { actorId: input.actorId, target, rule: "self_grant", ip: input.ip });
    return { kind: "forbidden", rule: "self_grant" };
  }
  if ((await findActiveJit(db, input.actorId, now)) !== null) {
    await deny(db, { actorId: input.actorId, target, rule: "jit_actor", ip: input.ip });
    return { kind: "forbidden", rule: "jit_actor" };
  }
  if (user.status !== "active") return { kind: "not-active-user" };
  if ((await listRoleNamesForUser(db, input.userId)).includes(JIT_ROLE)) return { kind: "already-admin" };
  if ((await findActiveJit(db, input.userId, now)) !== null) return { kind: "jit-active" };

  const id = generateUlid();
  const expiresAt = now + input.minutes * 60;
  const insertResults = await db.batch([
    insertJitGrantStmt(db, { id, userId: input.userId, grantedBy: input.actorId, reason: input.reason, now, expiresAt }),
    // must directly follow the INSERT: changes() refers to the previous statement
    auditInsertWhen(db, {
      actor: input.actorId,
      action: "jit.granted",
      target,
      metadata: { user: input.userId, reason: input.reason, expires_at: expiresAt },
      ts: now,
      when: changedOne,
    }),
  ] as unknown as Batch);
  const inserted: unknown = insertResults[0];

  if (!Array.isArray(inserted) || inserted.length === 0) {
    // Lost a race between the reads above and the write: classify against the state now.
    const fresh = await findUserById(db, input.userId);
    if (fresh === null) return { kind: "not-found" };
    if (fresh.status !== "active") return { kind: "not-active-user" };
    if ((await listRoleNamesForUser(db, input.userId)).includes(JIT_ROLE)) return { kind: "already-admin" };
    if ((await findActiveJit(db, input.actorId, now)) !== null) {
      await deny(db, { actorId: input.actorId, target, rule: "jit_actor", ip: input.ip });
      return { kind: "forbidden", rule: "jit_actor" };
    }
    return { kind: "jit-active" };
  }

  await invalidatePrincipalCache(deps.kv, input.userId);
  const grant = await findJitGrantById(db, id, now);
  if (grant === null) throw new Error(`jit grant ${id} vanished after insert`);
  return { kind: "ok", grant };
}

// ------------------------------------------------------------------ revoke

export type RevokeJitResult =
  | { kind: "ok"; grant: JitGrantDto }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "not-active" };

export async function revokeJit(
  deps: JitDeps,
  input: { actorId: string; grantId: string; ip?: string | null },
): Promise<RevokeJitResult> {
  const { db } = deps;
  const now = deps.now();

  const grant = await findJitGrantById(db, input.grantId, now);
  if (grant === null) return { kind: "not-found" };
  const target = `user:${grant.user_id}`;
  if (input.actorId !== grant.user_id) {
    // A PERMANENT jit:grant holder (D1 user_roles). A JIT principal never carries it (admin only), so no bypass.
    const held = await listPermissionKeysForUser(db, input.actorId);
    if (!held.includes("jit:grant")) {
      await deny(db, { actorId: input.actorId, target, ip: input.ip });
      return { kind: "forbidden" };
    }
  }

  const revokeResults = await db.batch([
    revokeJitGrantStmt(db, { id: grant.id, by: input.actorId, now }),
    auditInsertWhen(db, {
      actor: input.actorId,
      action: "jit.revoked",
      target,
      metadata: { user: grant.user_id },
      ts: now,
      when: changedOne,
    }),
  ] as unknown as Batch);
  const revoked: unknown = revokeResults[0];
  if (!Array.isArray(revoked) || revoked.length === 0) return { kind: "not-active" };

  await invalidatePrincipalCache(deps.kv, grant.user_id);
  const fresh = await findJitGrantById(db, grant.id, now);
  if (fresh === null) throw new Error(`jit grant ${grant.id} vanished after revoke`);
  return { kind: "ok", grant: fresh };
}

// ------------------------------------------------------------------ cron

/**
 * Every-5-minutes cron: grants past `expires_at`, not revoked, not yet logged → `expiry_logged_at` + one `jit.expired` row
 * + cache purge (≤ 100 per tick). Expiry itself is enforced per request (`valid_until`, DEC-8). Returns the count.
 * One batch of (CAS mark, audit guarded by `changes() = 1`) pairs: an overlapping tick that loses a CAS writes no row.
 */
export async function sweepExpiredJit(deps: JitDeps, now: number): Promise<number> {
  const { db } = deps;
  const due = await listUnloggedExpiredJit(db, { now, limit: JIT_SWEEP_LIMIT });
  if (due.length === 0) return 0;

  const stmts = due.flatMap((g) => [
    markJitExpiryLoggedStmt(db, { id: g.id, now }),
    auditInsertWhen(db, {
      actor: null,
      action: "jit.expired",
      target: `user:${g.user_id}`,
      metadata: { user: g.user_id },
      ts: now,
      when: changedOne,
    }),
  ]);
  const results = await db.batch(stmts as unknown as Batch);

  let logged = 0;
  for (let i = 0; i < due.length; i += 1) {
    const marked: unknown = results[i * 2];
    if (!Array.isArray(marked) || marked.length === 0) continue;
    logged += 1;
    await invalidatePrincipalCache(deps.kv, due[i]!.user_id);
  }
  return logged;
}
