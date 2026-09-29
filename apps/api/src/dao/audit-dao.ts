/**
 * Audit store DAO (SPEC-01 FR-4, docs/recipes/add-audit-store.md). Pure `(db, input)` functions.
 *
 * `auditInsert` returns an UNEXECUTED drizzle query so callers can put it in the same `db.batch([...])`
 * as the change it records (a status move without its row must not exist — documents.workbook I7).
 * Metadata must already be deep-scrubbed and carry no customer PII (ids + field names only).
 */
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, users } from "../db/schema";
import { deepScrub } from "../observability/logger";
import { generateUlid } from "../utils/id";

export interface AuditRowInput {
  actor: string | null;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  /** unix seconds; defaults to now */
  ts?: number;
}

export function auditInsert(db: Db, input: AuditRowInput) {
  const metadata = input.metadata == null ? null : JSON.stringify(deepScrub(input.metadata));
  return db.insert(auditEvents).values({
    id: generateUlid(),
    ts: input.ts ?? Math.floor(Date.now() / 1000),
    actor: input.actor,
    action: input.action,
    target: input.target ?? null,
    metadata,
    ip: input.ip ?? null,
  });
}

/**
 * Execute the insert and SWALLOW errors: an audit-store outage must never fail the audited request.
 * Use `auditInsert` inside `db.batch` when the row must be atomic with a change.
 */
export async function writeAuditEvent(db: Db, input: AuditRowInput): Promise<void> {
  try {
    await auditInsert(db, input);
  } catch (err) {
    console.error(
      JSON.stringify(
        deepScrub({
          ts: Date.now(),
          kind: "audit.d1.write_failed",
          action: input.action,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }
}

export interface AuditListInput {
  action?: string;
  actor?: string;
  target?: string;
  cursor?: string;
  limit: number;
}

export interface AuditEventDto {
  id: string;
  ts: number;
  actor: string | null;
  actor_name: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
}

export type AuditListResult =
  | { kind: "ok"; items: AuditEventDto[]; nextCursor: string | null }
  | { kind: "bad-cursor" };

function encodeCursor(ts: number, id: string): string {
  return btoa(`${ts}:${id}`);
}

function decodeCursor(raw: string): { ts: number; id: string } | null {
  try {
    const s = atob(raw);
    const i = s.indexOf(":");
    if (i < 1) return null;
    const ts = Number(s.slice(0, i));
    const id = s.slice(i + 1);
    if (!Number.isInteger(ts) || id === "") return null;
    return { ts, id };
  } catch {
    return null;
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Newest first, ordered (ts DESC, id DESC); one query with LEFT JOIN users for `actor_name`. */
export async function listAudit(db: Db, input: AuditListInput): Promise<AuditListResult> {
  const conds = [];
  if (input.action !== undefined) conds.push(eq(auditEvents.action, input.action));
  if (input.actor !== undefined) conds.push(eq(auditEvents.actor, input.actor));
  if (input.target !== undefined) conds.push(eq(auditEvents.target, input.target));
  if (input.cursor !== undefined) {
    const c = decodeCursor(input.cursor);
    if (c === null) return { kind: "bad-cursor" };
    conds.push(or(lt(auditEvents.ts, c.ts), and(eq(auditEvents.ts, c.ts), lt(auditEvents.id, c.id))));
  }
  const rows = await db
    .select({
      id: auditEvents.id,
      ts: auditEvents.ts,
      actor: auditEvents.actor,
      actorName: users.displayName,
      action: auditEvents.action,
      target: auditEvents.target,
      metadata: auditEvents.metadata,
      ip: auditEvents.ip,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actor))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(auditEvents.ts), desc(auditEvents.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    kind: "ok",
    items: page.map((r) => ({
      id: r.id,
      ts: r.ts,
      actor: r.actor,
      actor_name: r.actorName,
      action: r.action,
      target: r.target,
      metadata: parseMetadata(r.metadata),
      ip: r.ip,
    })),
    nextCursor: rows.length > input.limit && last !== undefined ? encodeCursor(last.ts, last.id) : null,
  };
}
