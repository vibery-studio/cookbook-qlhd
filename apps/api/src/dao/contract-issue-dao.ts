/**
 * Issue + void DAO (SPEC-03 FR-6, FR-7, FR-8, §3.3 "Rung B"). Pure `(db, input)` functions.
 *
 * Issue = ONE `UPDATE` that moves approved→issued AND takes `MAX(seq)+1` of the (type, year) series — no counter
 * table, no read-then-write. D1 runs one writer at a time and a batch is one transaction, so the subquery and the
 * write see the same state; `UNIQUE(type, series_year, seq)` is the last net (a violation rolls the batch back and the
 * caller retries — never a gap). The audit row is an `INSERT … SELECT` guarded by this attempt's `issue_token`, so it
 * exists iff this attempt won, and carries the number the UPDATE just wrote.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { approvalSteps, auditEvents, contracts } from "../db/schema";
import { SERIES } from "../domain/contract/number";
import { generateUlid } from "../utils/id";

const unixSeconds = (d: Date): number => Math.floor(d.getTime() / 1000);

const TYPE = "contract";
/** printf format equal to `formatNumber(prefix, year, seq, pad)` (no truncation past the pad width). */
const NUMBER_FORMAT = `${SERIES.contract.prefix}-%d-%0${SERIES.contract.pad}d`;

export interface IssueCasInput {
  id: string;
  actor: string;
  ip: string | null;
  /** fresh ULID per attempt */
  token: string;
  /** business-zone year of `now` (`seriesYear`) */
  year: number;
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
    WHERE c2.type = ${TYPE} AND c2.series_year = ${input.year} AND c2.seq IS NOT NULL)`;
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
          number: sql`printf(${NUMBER_FORMAT}, ${input.year}, ${nextSeq})`,
        })
        .where(
          and(
            eq(contracts.id, input.id),
            eq(contracts.status, "approved"),
            // every step approved on the hash the contract carries NOW (changed-after-approval otherwise)
            sql`NOT EXISTS (SELECT 1 FROM approval_steps s WHERE s.contract_id = ${input.id}
              AND (s.status <> 'approved' OR s.snapshot_hash_at_decision IS NOT contracts.snapshot_hash))`,
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
            metadata: sql<string>`json_object('from', 'approved', 'to', 'issued', 'number', ${contracts.number})`.as(
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
  | { kind: "changed-after-approval" };

/** Why the issue CAS matched 0 rows (read after the fact; the write itself never depends on it). */
export async function diagnoseIssue(db: Db, id: string): Promise<IssueDiagnosis> {
  const [c] = await db
    .select({ status: contracts.status, hash: contracts.snapshotHash })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  if (c === undefined) return { kind: "not-found" };
  if (c.status !== "approved") return { kind: "state-conflict", current: c.status };
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

/** issued→voided CAS (number + paper kept) + audit guarded by `changes()`, one batch. False = CAS missed. */
export async function voidCas(db: Db, input: VoidCasInput): Promise<boolean> {
  const now = unixSeconds(input.now);
  const [moved] = await db.batch([
    db
      .update(contracts)
      .set({ status: "voided", voidedBy: input.actor, voidedAt: now, voidReason: input.reason, updatedAt: now })
      .where(and(eq(contracts.id, input.id), eq(contracts.status, "issued")))
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
          metadata: sql<string>`json_object('from', 'issued', 'to', 'voided', 'number', ${contracts.number})`.as(
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
