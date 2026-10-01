/**
 * Access-review DAO (SPEC-07 §3.1, FR-7/8, DEC-10..12). Pure `(db, input)` functions returning DTOs; writes are
 * UNEXECUTED statement builders so the service puts each in one `db.batch` with its audit row.
 *
 * "changed" is computed on read: the user no longer holds the snapshotted role, or is no longer `active`.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { accessReviewItems, accessReviews } from "../db/schema";
import { auditInsertWhen } from "./user-dao";

export interface ReviewDto {
  id: string;
  period: string;
  status: "open" | "closed";
  openedBy: string;
  openedAt: number;
  dueAt: number;
  closedAt: number | null;
}

export interface ReviewRowDto {
  userId: string;
  displayName: string | null;
  roleName: string;
  roleLabel: string | null;
  decision: "keep" | "remove" | null;
  decidedByName: string | null;
  decidedAt: number | null;
  /** decided if a decision is stored; else changed if role/status moved since the snapshot; else open. */
  state: "open" | "decided" | "changed";
  /** the role or status moved since the snapshot (independent of `decision`) */
  changed: boolean;
  /** the row's user holds `reviews:write` (a reviewer — DEC-11) */
  isReviewer: boolean;
}

function toReview(row: typeof accessReviews.$inferSelect): ReviewDto {
  return {
    id: row.id,
    period: row.period,
    status: row.status === "closed" ? "closed" : "open",
    openedBy: row.openedBy,
    openedAt: row.openedAt,
    dueAt: row.dueAt,
    closedAt: row.closedAt,
  };
}

export async function findReviewById(db: Db, id: string): Promise<ReviewDto | null> {
  const rows = await db.select().from(accessReviews).where(eq(accessReviews.id, id)).limit(1);
  return rows[0] ? toReview(rows[0]) : null;
}

export async function findReviewByPeriod(db: Db, period: string): Promise<ReviewDto | null> {
  const rows = await db.select().from(accessReviews).where(eq(accessReviews.period, period)).limit(1);
  return rows[0] ? toReview(rows[0]) : null;
}

/** The newest still-open review, or null. */
export async function findOpenReview(db: Db): Promise<ReviewDto | null> {
  const rows = await db
    .select()
    .from(accessReviews)
    .where(eq(accessReviews.status, "open"))
    .orderBy(desc(accessReviews.openedAt))
    .limit(1);
  return rows[0] ? toReview(rows[0]) : null;
}

interface RawRow {
  user_id: string;
  display_name: string | null;
  role_name: string;
  role_label: string | null;
  decision: string | null;
  decided_at: number | null;
  decided_by_name: string | null;
  user_status: string;
  has_role: number;
  is_reviewer: number;
}

/** Rows of a review with their current-vs-snapshot state, ONE query. `userId` narrows to one row. */
export async function listReviewRows(db: Db, reviewId: string, userId?: string): Promise<ReviewRowDto[]> {
  const only = userId === undefined ? sql`` : sql` AND i.user_id = ${userId}`;
  const rows = await db.all<RawRow>(sql`
    SELECT i.user_id, u.display_name, i.role_name, i.role_label, i.decision, i.decided_at,
           du.display_name AS decided_by_name, u.status AS user_status,
           EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                    WHERE ur.user_id = i.user_id AND r.name = i.role_name) AS has_role,
           EXISTS (SELECT 1 FROM user_roles ur2
                     JOIN role_permissions rp ON rp.role_id = ur2.role_id
                     JOIN permissions p ON p.id = rp.permission_id
                    WHERE ur2.user_id = i.user_id AND p.key = 'reviews:write') AS is_reviewer
      FROM access_review_items i
      JOIN users u ON u.id = i.user_id
      LEFT JOIN users du ON du.id = i.decided_by
     WHERE i.review_id = ${reviewId}${only}
     ORDER BY u.display_name, i.role_name, i.user_id
  `);
  return rows.map((r) => {
    const decision = r.decision === "keep" || r.decision === "remove" ? r.decision : null;
    const changed = r.has_role === 0 || r.user_status !== "active";
    return {
      userId: r.user_id,
      displayName: r.display_name,
      roleName: r.role_name,
      roleLabel: r.role_label,
      decision,
      decidedByName: r.decided_by_name,
      decidedAt: r.decided_at,
      state: decision !== null ? "decided" : changed ? "changed" : "open",
      changed,
      isReviewer: r.is_reviewer === 1,
    };
  });
}

/** Predicate: the review `reviewId` exists (used to chain the snapshot + audit to the CAS insert). */
const reviewExists = (reviewId: string): SQL => sql`EXISTS (SELECT 1 FROM access_reviews WHERE id = ${reviewId})`;

/**
 * Open the review of `period`: CAS insert (UNIQUE period → `ON CONFLICT DO NOTHING`), then the snapshot (active, not
 * deletion-requested users × their roles) and the `review.opened` row — both only if THIS insert took the period.
 * Statement 0 `.returning` → 1 row = opened, 0 = the period already has a review.
 */
export function openReviewStmts(
  db: Db,
  input: { id: string; period: string; openedBy: string; actor: string | null; now: number; dueAt: number },
) {
  return [
    db
      .insert(accessReviews)
      .values({
        id: input.id,
        period: input.period,
        status: "open",
        openedBy: input.openedBy,
        openedAt: input.now,
        dueAt: input.dueAt,
      })
      .onConflictDoNothing({ target: accessReviews.period })
      .returning({ id: accessReviews.id }),
    db.insert(accessReviewItems).select(
      sql`SELECT ${input.id}, u.id, r.name, r.label, NULL, NULL, NULL
            FROM users u
            JOIN user_roles ur ON ur.user_id = u.id
            JOIN roles r ON r.id = ur.role_id
           WHERE u.status = 'active' AND u.deletion_requested_at IS NULL AND ${reviewExists(input.id)}`,
    ),
    auditInsertWhen(db, {
      actor: input.actor,
      action: "review.opened",
      target: `review:${input.id}`,
      metadata: { period: input.period },
      ts: input.now,
      when: reviewExists(input.id),
    }),
  ] as const;
}

/**
 * Store a decision on one row — only while the review is open, the snapshot role still held, and (keep) the user still
 * `active` / (remove) the user already `disabled` (the caller disabled them first). Statement 0 `.returning` = rows
 * written; statement 1 = `review.item_decided` in the same batch.
 */
export function decideItemStmts(
  db: Db,
  input: {
    reviewId: string;
    userId: string;
    roleName: string;
    decision: "keep" | "remove";
    actorId: string;
    now: number;
  },
) {
  const userState: SQL =
    input.decision === "remove"
      ? sql`EXISTS (SELECT 1 FROM users WHERE id = ${input.userId} AND status = 'disabled')`
      : sql`EXISTS (SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
                     WHERE u.id = ${input.userId} AND u.status = 'active' AND r.name = ${input.roleName})`;
  return [
    db
      .update(accessReviewItems)
      .set({ decision: input.decision, decidedBy: input.actorId, decidedAt: input.now })
      .where(
        and(
          eq(accessReviewItems.reviewId, input.reviewId),
          eq(accessReviewItems.userId, input.userId),
          sql`(${accessReviewItems.decision} IS NULL OR ${accessReviewItems.decision} <> ${input.decision})`,
          sql`EXISTS (SELECT 1 FROM access_reviews WHERE id = ${input.reviewId} AND status = 'open')`,
          userState,
        ),
      )
      .returning({ userId: accessReviewItems.userId }),
    auditInsertWhen(db, {
      actor: input.actorId,
      action: "review.item_decided",
      target: `review:${input.reviewId}`,
      metadata: { user: input.userId, role: input.roleName, decision: input.decision },
      ts: input.now,
      when: sql`EXISTS (SELECT 1 FROM access_review_items WHERE review_id = ${input.reviewId} AND user_id = ${input.userId}
                          AND decision = ${input.decision} AND decided_by = ${input.actorId} AND decided_at = ${input.now})`,
    }),
  ] as const;
}

/**
 * Close CAS: `status='open'` and no row still waiting (undecided AND unchanged). Statement 0 `.returning` = closed;
 * statement 1 = `review.closed` in the same batch.
 */
export function closeReviewStmts(db: Db, input: { reviewId: string; period: string; actorId: string; now: number }) {
  return [
    db
      .update(accessReviews)
      .set({ status: "closed", closedBy: input.actorId, closedAt: input.now })
      .where(
        and(
          eq(accessReviews.id, input.reviewId),
          eq(accessReviews.status, "open"),
          sql`NOT EXISTS (
            SELECT 1 FROM access_review_items i JOIN users u ON u.id = i.user_id
             WHERE i.review_id = ${input.reviewId} AND i.decision IS NULL AND u.status = 'active'
               AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                            WHERE ur.user_id = i.user_id AND r.name = i.role_name))`,
        ),
      )
      .returning({ id: accessReviews.id }),
    auditInsertWhen(db, {
      actor: input.actorId,
      action: "review.closed",
      target: `review:${input.reviewId}`,
      metadata: { period: input.period },
      ts: input.now,
      when: sql`EXISTS (SELECT 1 FROM access_reviews WHERE id = ${input.reviewId} AND status = 'closed'
                          AND closed_by = ${input.actorId} AND closed_at = ${input.now})`,
    }),
  ] as const;
}
