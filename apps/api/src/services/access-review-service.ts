/**
 * Quarterly access reviews (SPEC-07 FR-7/8, DEC-10..12, PLAN-07 R-11). Opening, current view, Giữ/Gỡ per row, closing.
 *
 * Guards read D1 only (DEC-7): a JIT holder never passes them (`jit_actor`). Who decides which row (R-11): a permanent
 * `reviews:write` holder decides every row but their own (`self_review`); a permanent `roles:write` holder without it
 * decides only the rows of people who hold `reviews:write` (the director's row). Check order on a decision:
 * 404 → jit_actor → permission → self_review → review-closed → item-changed → write.
 *
 * "Gỡ" (DEC-10) = `updateUser({status:"disabled"})` (FIX-03 `admin_only`, `last-admin`, refresh revoke, cache purge), then
 * the decision is stored only if the user is now `disabled`. "Giữ" = decision only.
 * No Hono, no HTTP.
 */
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import { writeAuditEvent } from "../dao/audit-dao";
import {
  closeReviewStmts,
  decideItemStmts,
  findOpenReview,
  findReviewById,
  findReviewByPeriod,
  listReviewRows,
  openReviewStmts,
  type ReviewDto,
  type ReviewRowDto,
} from "../dao/access-review-dao";
import { findActiveJit } from "../dao/jit-dao";
import { listPermissionKeysForUser } from "../dao/permission-dao";
import { listRoleNamesForUser } from "../dao/role-dao";
import { quarterOf, REVIEW_DUE_SECONDS } from "../domain/review-period";
import { generateUlid } from "../utils/id";
import { updateUser } from "./user-admin-service";

export interface AccessReviewDeps {
  db: Db;
  kv: KVNamespace;
  now: () => number; // unix seconds
  /** needed only by `decideItem` "remove" (it reuses `updateUser`); routes pass it, the cron does not. */
  env?: Bindings;
}

export type LockedReason = "self_review" | "admin_only" | "not_reviewer";
export type DeniedRule = "jit_actor" | "self_review" | "admin_only" | "not_reviewer";

export interface ReviewItemView {
  userId: string;
  displayName: string | null;
  roleName: string;
  roleLabel: string;
  decision: "keep" | "remove" | null;
  decidedByName: string | null;
  decidedAt: number | null;
  state: "open" | "decided" | "changed";
  can: { keep: boolean; remove: boolean };
  lockedReason: LockedReason | null;
}

// ------------------------------- open --------------------------------------

async function openPeriod(
  deps: AccessReviewDeps,
  input: { now: number; openedBy: string; actor: string | null },
): Promise<ReviewDto | null> {
  const period = quarterOf(input.now);
  const id = generateUlid();
  const [insert, ...rest] = openReviewStmts(deps.db, {
    id,
    period,
    openedBy: input.openedBy,
    actor: input.actor,
    now: input.now,
    dueAt: input.now + REVIEW_DUE_SECONDS,
  });
  const results = await deps.db.batch([insert, ...rest] as unknown as Parameters<Db["batch"]>[0]);
  const first: unknown = results[0];
  if (!Array.isArray(first) || first.length === 0) return null;
  return findReviewById(deps.db, id);
}

/**
 * Nightly (`0 3`): open the current quarter's review (Asia/Ho_Chi_Minh) if none exists, `opened_by:"system:cron"`.
 * Returns the period opened, or null when it already existed.
 */
export async function openQuarterReview(deps: AccessReviewDeps, now: number): Promise<string | null> {
  const review = await openPeriod(deps, { now, openedBy: "system:cron", actor: null });
  return review === null ? null : review.period;
}

/** "Bắt đầu rà soát": the same, by hand. `duplicate` when this quarter already has a review. */
export async function openReview(
  deps: AccessReviewDeps,
  input: { actorId: string },
): Promise<{ kind: "ok"; review: ReviewDto } | { kind: "duplicate" }> {
  const review = await openPeriod(deps, { now: deps.now(), openedBy: input.actorId, actor: input.actorId });
  return review === null ? { kind: "duplicate" } : { kind: "ok", review };
}

// ------------------------------- caller capabilities ------------------------

interface Caller {
  id: string;
  jit: boolean;
  reviewsWrite: boolean;
  rolesWrite: boolean;
  admin: boolean;
}

/** From D1 (user_roles only, DEC-7) + the active JIT grant. */
async function loadCaller(deps: AccessReviewDeps, userId: string): Promise<Caller> {
  const [perms, roleNames, jit] = await Promise.all([
    listPermissionKeysForUser(deps.db, userId),
    listRoleNamesForUser(deps.db, userId),
    findActiveJit(deps.db, userId, deps.now()),
  ]);
  return {
    id: userId,
    jit: jit !== null,
    reviewsWrite: perms.includes("reviews:write"),
    rolesWrite: perms.includes("roles:write"),
    admin: roleNames.includes("admin"),
  };
}

/** The business rule that refuses `caller` on `row`, or null when they may decide it (rows still open only). */
function refusal(caller: Caller, row: ReviewRowDto): DeniedRule | null {
  if (caller.jit) return "jit_actor";
  if (caller.reviewsWrite) return caller.id === row.userId ? "self_review" : null;
  if (caller.rolesWrite && row.isReviewer) return null;
  return "not_reviewer";
}

function toItemView(row: ReviewRowDto, caller: Caller, reviewOpen: boolean): ReviewItemView {
  let can = { keep: false, remove: false };
  let lockedReason: LockedReason | null = null;
  if (reviewOpen && row.state === "open" && !caller.jit) {
    const rule = refusal(caller, row);
    if (rule === null) {
      const removeLocked = row.roleName === "admin" && !caller.admin;
      can = { keep: true, remove: !removeLocked };
      lockedReason = removeLocked ? "admin_only" : null;
    } else if (rule === "self_review" || rule === "not_reviewer") {
      lockedReason = rule;
    }
  }
  return {
    userId: row.userId,
    displayName: row.displayName,
    roleName: row.roleName,
    roleLabel: row.roleLabel ?? row.roleName,
    decision: row.decision,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt,
    state: row.state,
    can,
    lockedReason,
  };
}

// ------------------------------- current ------------------------------------

export interface CurrentReviewView {
  review: ReviewDto | null;
  items: ReviewItemView[];
  progress: { decided: number; total: number };
  overdue: boolean;
}

/** The open review, else this quarter's (closed) one, else null. `overdue` = open and past `due_at`. */
export async function currentReview(deps: AccessReviewDeps, input: { actorId: string }): Promise<CurrentReviewView> {
  const now = deps.now();
  const review = (await findOpenReview(deps.db)) ?? (await findReviewByPeriod(deps.db, quarterOf(now)));
  if (review === null) return { review: null, items: [], progress: { decided: 0, total: 0 }, overdue: false };
  const [rows, caller] = await Promise.all([listReviewRows(deps.db, review.id), loadCaller(deps, input.actorId)]);
  const open = review.status === "open";
  return {
    review,
    items: rows.map((r) => toItemView(r, caller, open)),
    progress: { decided: rows.filter((r) => r.state === "decided").length, total: rows.length },
    overdue: open && now > review.dueAt,
  };
}

// ------------------------------- decide -------------------------------------

export type DecideResult =
  | { kind: "ok"; item: ReviewItemView }
  | { kind: "not-found" }
  | { kind: "forbidden"; rule: DeniedRule }
  | { kind: "review-closed" }
  | { kind: "item-changed" }
  | { kind: "last-admin" };

/** One `permission.denied` row for a business 403 (updateUser writes its own for admin_only). */
async function denied(deps: AccessReviewDeps, actorId: string, reviewId: string, rule: DeniedRule, ip?: string | null) {
  await writeAuditEvent(deps.db, {
    actor: actorId,
    action: "permission.denied",
    target: `review:${reviewId}`,
    metadata: { rule, permission: "reviews:write" },
    ip: ip ?? null,
  });
}

export async function decideItem(
  deps: AccessReviewDeps,
  input: { actorId: string; reviewId: string; userId: string; decision: "keep" | "remove"; ip?: string | null },
): Promise<DecideResult> {
  const { db } = deps;
  const review = await findReviewById(db, input.reviewId);
  if (review === null) return { kind: "not-found" };
  const row = (await listReviewRows(db, review.id, input.userId))[0];
  if (row === undefined) return { kind: "not-found" };

  const caller = await loadCaller(deps, input.actorId);
  const rule = refusal(caller, row);
  if (rule !== null) {
    await denied(deps, input.actorId, review.id, rule, input.ip);
    return { kind: "forbidden", rule };
  }
  if (review.status === "closed") return { kind: "review-closed" };
  if (row.changed) return { kind: "item-changed" };

  if (input.decision === "remove") {
    if (deps.env === undefined) throw new Error("decideItem(remove) needs deps.env");
    const res = await updateUser(
      { db, kv: deps.kv, env: deps.env, now: deps.now },
      { actorId: input.actorId, userId: input.userId, status: "disabled", ip: input.ip },
    );
    if (res.kind === "forbidden") return { kind: "forbidden", rule: "admin_only" }; // updateUser wrote the denied row
    if (res.kind === "last-admin") return { kind: "last-admin" };
    if (res.kind !== "ok") return { kind: "item-changed" }; // not-found / pending: the user moved under us
  }

  const [update, ...rest] = decideItemStmts(db, {
    reviewId: review.id,
    userId: input.userId,
    roleName: row.roleName,
    decision: input.decision,
    actorId: input.actorId,
    now: deps.now(),
  });
  const results = await db.batch([update, ...rest] as unknown as Parameters<Db["batch"]>[0]);
  const first: unknown = results[0];
  const written = Array.isArray(first) ? first.length : 0;

  const after = await findReviewById(db, review.id);
  const fresh = (await listReviewRows(db, review.id, input.userId))[0];
  if (written === 0) {
    if (after?.status === "closed") return { kind: "review-closed" };
    // same decision already stored (double click) is a success; anything else = the row moved
    if (fresh === undefined || fresh.decision !== input.decision) return { kind: "item-changed" };
  }
  if (fresh === undefined) return { kind: "not-found" };
  return { kind: "ok", item: toItemView(fresh, caller, after?.status === "open") };
}

// ------------------------------- close --------------------------------------

export type CloseResult =
  | { kind: "ok"; review: ReviewDto }
  | { kind: "not-found" }
  | { kind: "review-closed" }
  | { kind: "review-incomplete" };

export async function closeReview(
  deps: AccessReviewDeps,
  input: { actorId: string; reviewId: string },
): Promise<CloseResult> {
  const { db } = deps;
  const review = await findReviewById(db, input.reviewId);
  if (review === null) return { kind: "not-found" };
  if (review.status === "closed") return { kind: "review-closed" };

  const [update, ...rest] = closeReviewStmts(db, {
    reviewId: review.id,
    period: review.period,
    actorId: input.actorId,
    now: deps.now(),
  });
  const results = await db.batch([update, ...rest] as unknown as Parameters<Db["batch"]>[0]);
  const first: unknown = results[0];
  const closed = Array.isArray(first) && first.length > 0;
  const after = await findReviewById(db, review.id);
  if (closed && after !== null) return { kind: "ok", review: after };
  return after?.status === "closed" ? { kind: "review-closed" } : { kind: "review-incomplete" };
}
