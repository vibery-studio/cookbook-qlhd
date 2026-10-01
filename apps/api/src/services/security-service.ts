/**
 * C-11-001 — read / toggle two-layer approval of role permission changes. No Hono, no HTTP: typed outcomes only.
 * Storage + exactness: see `dao/security-dao.ts`. Writing needs `security:write` (route gate; repeated in the batch WHERE).
 * A write that does not change the value writes nothing (no audit row) and returns the current state.
 */
import type { Db } from "../db/client";
import { userHoldsKeySql } from "../dao/role-change-dao";
import { findTwoLayer, setTwoLayerStmts } from "../dao/security-dao";

export interface TwoLayerView {
  enabled: boolean;
  updated_at: number | null;
  updated_by_name: string | null;
}

export async function getTwoLayer(db: Db): Promise<TwoLayerView> {
  const s = await findTwoLayer(db);
  return { enabled: s.enabled, updated_at: s.updatedAt, updated_by_name: s.updatedByName };
}

export async function setTwoLayer(
  deps: { db: Db; now: () => number },
  input: { actorId: string; enabled: boolean; reason: string; ip: string | null },
): Promise<TwoLayerView> {
  const { db } = deps;
  const [audit, upsert] = setTwoLayerStmts(db, {
    enabled: input.enabled,
    reason: input.reason,
    actorId: input.actorId,
    ip: input.ip,
    now: deps.now(),
    actorGuard: userHoldsKeySql(input.actorId, "security:write"),
  });
  await db.batch([audit, upsert]);
  return getTwoLayer(db);
}
