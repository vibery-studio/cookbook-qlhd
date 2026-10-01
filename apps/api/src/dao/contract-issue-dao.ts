/**
 * Issue + void DAO (SPEC-03 FR-6, FR-7, FR-8, §3.3 "Rung B"). Pure `(db, input)` functions.
 *
 * Issue = ONE `UPDATE` that moves approved→issued AND takes `MAX(seq)+1` of the row's own (type, year) series (SPEC-09
 * FR-2: `SERIES[contracts.type]`, chosen in SQL by `CASE contracts.type`) — no counter
 * table, no read-then-write. D1 runs one writer at a time and a batch is one transaction, so the subquery and the
 * write see the same state; `UNIQUE(type, series_year, seq)` is the last net (a violation rolls the batch back and the
 * caller retries — never a gap). The audit row is an `INSERT … SELECT` guarded by this attempt's `issue_token`, so it
 * exists iff this attempt won, and carries the number the UPDATE just wrote.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { approvalSteps, auditEvents, contracts } from "../db/schema";
import { DOC_TYPES, LIVE_STATUSES } from "../domain/contract/doc-types";
import { numberPrintfFormat } from "../domain/contract/number";
import { generateUlid } from "../utils/id";

const unixSeconds = (d: Date): number => Math.floor(d.getTime() / 1000);

/** `CASE contracts.type WHEN 'quote' THEN 'BG-%d-%03d' … END` — the row's own series format, built from `SERIES`. */
const NUMBER_FORMAT_BY_TYPE = sql`CASE contracts.type ${sql.join(
  DOC_TYPES.map((t) => sql`WHEN ${t} THEN ${numberPrintfFormat(t)}`),
  sql` `,
)} END`;

const LIVE_STATUS_LIST = sql.join(
  LIVE_STATUSES.map((s) => sql`${s}`),
  sql`, `,
);

export interface IssueCasInput {
  id: string;
  actor: string;
  ip: string | null;
  /** fresh ULID per attempt */
  token: string;
  /** business-zone year of `now` (`seriesYear`) */
  year: number;
  /** business-zone day of `now` (`todayInVN`, P-6): a BG is in date while `valid_until >= today` */
  today: string;
  now: Date;
}

export type IssueCasResult = { kind: "won" } | { kind: "lost" } | { kind: "unique-violation" };

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (/UNIQUE constraint failed/i.test(e.message)) return true;
  }
  return false;
}

/** Rung B: the status move + number in one statement, then the token-guarded audit row — one batch. */
export async function issueCas(db: Db, input: IssueCasInput): Promise<IssueCasResult> {
  const now = unixSeconds(input.now);
  const nextSeq = sql`(SELECT COALESCE(MAX(c2.seq), 0) + 1 FROM contracts c2
    WHERE c2.type = contracts.type AND c2.series_year = ${input.year} AND c2.seq IS NOT NULL)`;
  try {
    const [moved] = await db.batch([
      db
        .update(contracts)
        .set({
          status: "issued",
          issueToken: input.token,
          issuedBy: input.actor,
          issuedAt: now,
          updatedAt: now,
          seriesYear: input.year,
          seq: nextSeq,
          number: sql`printf(${NUMBER_FORMAT_BY_TYPE}, ${input.year}, ${nextSeq})`,
        })
        .where(
          and(
            eq(contracts.id, input.id),
            eq(contracts.status, "approved"),
            // every step approved on the hash the contract carries NOW (changed-after-approval otherwise)
            sql`NOT EXISTS (SELECT 1 FROM approval_steps s WHERE s.contract_id = ${input.id}
              AND (s.status <> 'approved' OR s.snapshot_hash_at_decision IS NOT contracts.snapshot_hash))`,
            // FR-11: a BG issues only while in date ("đến hết ngày"; NULL valid_until = expired)
            sql`(contracts.type <> 'quote' OR contracts.valid_until >= ${input.today})`,
            // FR-4: a child issues only while its parent is still issued
            sql`(contracts.parent_id IS NULL OR EXISTS (SELECT 1 FROM contracts p
              WHERE p.id = contracts.parent_id AND p.status = 'issued'))`,
          ),
        )
        .returning({ id: contracts.id }),
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${generateUlid()}`.as("id"),
            ts: sql<number>`${now}`.as("ts"),
            actor: sql<string>`${input.actor}`.as("actor"),
            action: sql<string>`${"contract.issued"}`.as("action"),
            target: sql<string>`${`contract:${input.id}`}`.as("target"),
            metadata: sql<string>`json_object('from', 'approved', 'to', 'issued', 'number', ${contracts.number}, 'type', ${contracts.type})`.as(
              "metadata",
            ),
            ip: sql<string | null>`${input.ip}`.as("ip"),
          })
          .from(contracts)
          .where(and(eq(contracts.id, input.id), eq(contracts.issueToken, input.token))),
      ),
    ]);
    return moved.length > 0 ? { kind: "won" } : { kind: "lost" };
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "unique-violation" };
    throw err;
  }
}

export type IssueDiagnosis =
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string }
  | { kind: "changed-after-approval" }
  | { kind: "parent-not-issued" }
  | { kind: "quote-expired" };

/** Why the issue CAS matched 0 rows (read after the fact; the write itself never depends on it). */
export async function diagnoseIssue(db: Db, id: string, today: string): Promise<IssueDiagnosis> {
  const [c] = await db
    .select({
      status: contracts.status,
      hash: contracts.snapshotHash,
      type: contracts.type,
      validUntil: contracts.validUntil,
      parentId: contracts.parentId,
    })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  if (c === undefined) return { kind: "not-found" };
  if (c.status !== "approved") return { kind: "state-conflict", current: c.status };
  if (c.parentId !== null) {
    const [p] = await db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, c.parentId)).limit(1);
    if (p?.status !== "issued") return { kind: "parent-not-issued" };
  }
  if (c.type === "quote" && (c.validUntil === null || c.validUntil < today)) return { kind: "quote-expired" };
  const steps = await db
    .select({ status: approvalSteps.status, hash: approvalSteps.snapshotHashAtDecision })
    .from(approvalSteps)
    .where(eq(approvalSteps.contractId, id));
  if (steps.some((s) => s.status !== "approved" || s.hash !== c.hash)) return { kind: "changed-after-approval" };
  return { kind: "state-conflict", current: c.status };
}

export interface VoidCasInput {
  id: string;
  actor: string;
  ip: string | null;
  /** already trimmed, non-empty */
  reason: string;
  now: Date;
}

/**
 * issued→voided CAS (number + paper kept) + audit guarded by `changes()`, one batch. False = CAS missed.
 * FR-9: never while a live child (draft/pending/approved/issued) hangs under it — checked inside the CAS, so a
 * concurrent create-child (whose CAS needs the parent `issued`) and this void can't both win.
 */
export async function voidCas(db: Db, input: VoidCasInput): Promise<boolean> {
  const now = unixSeconds(input.now);
  const [moved] = await db.batch([
    db
      .update(contracts)
      .set({ status: "voided", voidedBy: input.actor, voidedAt: now, voidReason: input.reason, updatedAt: now })
      .where(
        and(
          eq(contracts.id, input.id),
          eq(contracts.status, "issued"),
          sql`NOT EXISTS (SELECT 1 FROM contracts ch WHERE ch.parent_id = ${input.id} AND ch.status IN (${LIVE_STATUS_LIST}))`,
        ),
      )
      .returning({ id: contracts.id }),
    // must directly follow the UPDATE: changes() refers to the previous statement
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${generateUlid()}`.as("id"),
          ts: sql<number>`${now}`.as("ts"),
          actor: sql<string>`${input.actor}`.as("actor"),
          action: sql<string>`${"contract.voided"}`.as("action"),
          target: sql<string>`${`contract:${input.id}`}`.as("target"),
          metadata: sql<string>`json_object('from', 'issued', 'to', 'voided', 'number', ${contracts.number}, 'type', ${contracts.type})`.as(
            "metadata",
          ),
          ip: sql<string | null>`${input.ip}`.as("ip"),
        })
        .from(contracts)
        .where(and(eq(contracts.id, input.id), sql`changes() > 0`)),
    ),
  ]);
  return moved.length > 0;
}

/** Current status of a contract, or null (for the void 0-row diagnosis). */
export async function contractStatus(db: Db, id: string): Promise<string | null> {
  const [c] = await db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, id)).limit(1);
  return c === undefined ? null : c.status;
}
