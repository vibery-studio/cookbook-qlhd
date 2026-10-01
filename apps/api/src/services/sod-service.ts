/**
 * sod-service — SPEC-07 FR-1 (DEC-9 B): declare / remove / list conflicting permission pairs. No Hono, typed outcomes.
 *
 * Declare: codes sorted (`perm_a < perm_b`), then ONE batch [INSERT…SELECT WHERE no role holds both · audit
 * `sod.pair_added` when the row exists]. 0 rows → list the violating roles → `sod-conflict`; UNIQUE → `duplicate`.
 * Remove: ONE batch [audit `sod.pair_removed` when the row still exists · DELETE RETURNING]; 0 rows → `not-found`.
 * Roles are never touched by either (a pair only constrains later permission sets).
 */
import type { Db } from "../db/client";
import { isUniqueViolation } from "../dao/customer-dao";
import { auditWhenStmt } from "../dao/role-write-dao";
import {
  deleteSodPairStmt,
  findSodPair,
  insertSodPairStmt,
  listSodPairViews,
  rolesHoldingBoth,
  sodPairExistsSql,
  type RoleRefDto,
  type SodPairViewDto,
} from "../dao/sod-dao";
import { generateUlid } from "../utils/id";

export interface SodDeps {
  db: Db;
  now: () => number; // unix seconds
}

/** System roles first in this order, then custom roles by label (same order as the roles screen). */
const ROLE_ORDER = ["giam_doc", "quan_ly", "nhan_vien", "admin", "member"];

function sortRoleRefs(roles: RoleRefDto[]): RoleRefDto[] {
  const rank = (n: string) => {
    const i = ROLE_ORDER.indexOf(n);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  return [...roles].sort((a, b) => rank(a.name) - rank(b.name) || a.label.localeCompare(b.label, "vi"));
}

export async function listPairs(db: Db): Promise<{ items: SodPairViewDto[] }> {
  return { items: await listSodPairViews(db) };
}

export type AddPairResult =
  | { kind: "ok"; pair: SodPairViewDto }
  | { kind: "duplicate" }
  | { kind: "sod-conflict"; roles: RoleRefDto[] };

export async function addPair(
  deps: SodDeps,
  input: { actorId: string; permA: string; permB: string; reason?: string; ip: string | null },
): Promise<AddPairResult> {
  const { db } = deps;
  const [permA, permB] = input.permA < input.permB ? [input.permA, input.permB] : [input.permB, input.permA];
  const reason = input.reason === undefined || input.reason === "" ? null : input.reason;
  const id = generateUlid();
  const now = deps.now();

  let inserted: { id: string }[];
  try {
    [inserted] = await db.batch([
      insertSodPairStmt(db, { id, permA, permB, reason, actorId: input.actorId, now }),
      auditWhenStmt(db, {
        actor: input.actorId,
        action: "sod.pair_added",
        target: `sod:${id}`,
        metadata: { perm_a: permA, perm_b: permB },
        ip: input.ip,
        ts: now,
        when: sodPairExistsSql(id),
      }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "duplicate" };
    throw err;
  }
  if (inserted.length === 0) {
    return { kind: "sod-conflict", roles: sortRoleRefs(await rolesHoldingBoth(db, permA, permB)) };
  }
  const pair = (await listSodPairViews(db)).find((p) => p.id === id);
  if (pair === undefined) throw new Error("sod pair vanished right after insert");
  return { kind: "ok", pair };
}

export type RemovePairResult = { kind: "ok" } | { kind: "not-found" };

export async function removePair(
  deps: SodDeps,
  input: { actorId: string; id: string; ip: string | null },
): Promise<RemovePairResult> {
  const { db } = deps;
  const pair = await findSodPair(db, input.id);
  if (pair === null) return { kind: "not-found" };
  const now = deps.now();
  const [, deleted] = await db.batch([
    auditWhenStmt(db, {
      actor: input.actorId,
      action: "sod.pair_removed",
      target: `sod:${pair.id}`,
      metadata: { perm_a: pair.perm_a, perm_b: pair.perm_b },
      ip: input.ip,
      ts: now,
      when: sodPairExistsSql(pair.id),
    }),
    deleteSodPairStmt(db, pair.id),
  ]);
  return deleted.length === 0 ? { kind: "not-found" } : { kind: "ok" };
}
