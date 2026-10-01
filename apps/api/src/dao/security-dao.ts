/**
 * C-11-001 — "cơ chế duyệt 2 lớp" (two-layer approval of role permission changes) on/off.
 *
 * Stored in the D1 `settings` table (key below, JSON boolean) but deliberately NOT in `SETTINGS_REGISTRY` and NOT read
 * through `SettingsService`: that path caches in KV for 300s (eventually consistent) and `settings:write` could flip it.
 * Here every read hits D1 and the direct-change batch repeats `twoLayerOffSql()` in its WHERE, so the guard is exact.
 * No row = ON (the default).
 */
import { eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, settings, users } from "../db/schema";
import { auditWhenStmt } from "./role-write-dao";

export const TWO_LAYER_KEY = "security.two_layer_role_change";

export interface TwoLayerDto {
  enabled: boolean;
  updatedAt: number | null;
  updatedByName: string | null;
}

export async function findTwoLayer(db: Db): Promise<TwoLayerDto> {
  const rows = await db
    .select({ value: settings.value, updatedAt: settings.updatedAt, name: users.displayName })
    .from(settings)
    .leftJoin(users, eq(users.id, settings.updatedBy))
    .where(eq(settings.key, TWO_LAYER_KEY))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return { enabled: true, updatedAt: null, updatedByName: null };
  return { enabled: row.value !== "false", updatedAt: row.updatedAt, updatedByName: row.name ?? null };
}

/** Predicate: two-layer approval is OFF right now (only an explicit `false` row turns it off). */
export function twoLayerOffSql(): SQL {
  return sql`EXISTS (SELECT 1 FROM settings tls WHERE tls.key = ${TWO_LAYER_KEY} AND tls.value = 'false')`;
}

/**
 * [audit `security.two_layer_changed` · upsert] — both only when the stored value differs from `enabled` and the actor
 * still holds `security:write` (`actorGuard`). The audit row goes first: its WHERE sees the old value.
 * Returns the builders; the caller runs them in one `db.batch`. Result[0] non-empty = changed.
 */
export function setTwoLayerStmts(
  db: Db,
  input: { enabled: boolean; reason: string; actorId: string; ip: string | null; now: number; actorGuard: SQL },
) {
  const next = input.enabled ? "true" : "false";
  const differs = sql`COALESCE((SELECT tlc.value FROM settings tlc WHERE tlc.key = ${TWO_LAYER_KEY}), 'true') <> ${next}`;
  const when = sql`${differs} AND ${input.actorGuard}`;
  return [
    auditWhenStmt(db, {
      actor: input.actorId,
      action: "security.two_layer_changed",
      target: `settings:${TWO_LAYER_KEY}`,
      metadata: { enabled: input.enabled, reason: input.reason },
      ip: input.ip,
      ts: input.now,
      when,
    }).returning({ id: auditEvents.id }),
    db
      .insert(settings)
      .select(sql`SELECT ${TWO_LAYER_KEY}, ${next}, ${input.now}, ${input.actorId} WHERE ${when}`)
      .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: input.now, updatedBy: input.actorId } }),
  ] as const;
}
