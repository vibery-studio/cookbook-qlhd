/**
 * Audit store DAO (SPEC-01 FR-4, docs/recipes/add-audit-store.md). Pure `(db, input)` functions.
 *
 * `auditInsert` returns an UNEXECUTED drizzle query so callers can put it in the same `db.batch([...])`
 * as the change it records (a status move without its row must not exist — documents.workbook I7).
 * Metadata must already be deep-scrubbed and carry no customer PII (ids + field names only).
 */
import type { Db } from "../db/client";
import { auditEvents } from "../db/schema";
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
