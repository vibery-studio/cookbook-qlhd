import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Db } from "../db/client";
import {
  findFlagByKey,
  listAllFlags,
  upsertFlag,
  type FlagRowDto,
} from "../dao/flags-dao";
import { createAuditLogger } from "../observability/logger";
import { FLAG_REGISTRY, FLAG_KEYS, type FlagKey } from "./registry";
import type {
  FlagPrincipal,
  FlagSnapshot,
  FlagUpdate,
  FlagsPort,
} from "./flags-port";

/**
 * FlagsService — the concrete implementation of FlagsPort.
 *
 * Read path (`get`):
 *   1. KV lookup at key `flag:<key>`. Miss → step 2.
 *   2. D1 lookup. Row absent → step 3.
 *   3. Return registry default (as `{ enabled: default, percentage: null }`).
 *
 * On D1 hit, the row is normalized and cached in KV for KV_TTL_SECONDS.
 * The evaluated boolean is computed AFTER cache resolution so principal-
 * scoped percentage rollout stays deterministic per (principal, key).
 *
 * Write path (`set`):
 *   1. Validate percentage (0-100 or null) and allowlist shape.
 *   2. Upsert D1 (single-statement `INSERT ... ON CONFLICT DO UPDATE`).
 *   3. Delete the KV entry so the next reader sees the fresh value.
 *      Same cache-race caveat as SettingsService: worst-case KV staleness
 *      bounds a bad rollout to KV_TTL_SECONDS in one region.
 *   4. Emit a SYNC audit event so the change lands in Logpush before
 *      the response returns.
 *
 * Percentage evaluation:
 *   `hash(principalId + flagKey) % 100 < percentage`
 * SHA-256 keeps assignment deterministic per user per flag — the same
 * user in the 20% bucket stays there until the flag's percentage
 * changes. Anonymous callers (no principal) can only be evaluated when
 * the flag is either boolean-typed or when `percentage === null`
 * (the flag then falls back to `enabled` outright).
 */
const KV_TTL_SECONDS = 300;

interface CachedFlagRow {
  enabled: boolean;
  percentage: number | null;
  allowlist: string[] | null;
  updatedAt: number;
  updatedBy: string | null;
}

export interface FlagsServiceDeps {
  db: Db;
  kv: KVNamespace;
}

export class FlagsService implements FlagsPort {
  constructor(private readonly deps: FlagsServiceDeps) {}

  async get(key: FlagKey, principal?: FlagPrincipal): Promise<boolean> {
    const row = await this.resolveRow(key);
    return evaluate(key, row, principal);
  }

  async set(key: FlagKey, patch: FlagUpdate, actor: string): Promise<void> {
    if (!(key in FLAG_REGISTRY)) {
      throw new Error(`flags.set: unknown key '${key}'`);
    }

    const currentRow = await this.resolveRow(key);

    const enabled = patch.enabled ?? currentRow.enabled;
    const percentage =
      patch.percentage === undefined ? currentRow.percentage : patch.percentage;
    const allowlist =
      patch.allowlist === undefined ? currentRow.allowlist : patch.allowlist;

    validatePercentage(percentage);
    validateAllowlist(allowlist);

    const now = Math.floor(Date.now() / 1000);
    await upsertFlag(this.deps.db, {
      key,
      enabled,
      percentage,
      allowlist,
      updatedAt: now,
      updatedBy: actor,
    });

    await this.deps.kv.delete(kvKey(key));

    const isKillSwitchToOff =
      enabled === false && FLAG_REGISTRY[key].default === true;
    const action = isKillSwitchToOff
      ? "flag.kill_switch_activated"
      : "flag.updated";

    const audit = createAuditLogger({ ctx: undefined, db: this.deps.db });
    audit(
      {
        actor,
        action,
        target: `flag:${key}`,
        metadata: {
          enabled,
          percentage,
          allowlist_size: allowlist === null ? null : allowlist.length,
        },
      },
      { sync: true },
    );
    await audit.flush();
  }

  async list(): Promise<FlagSnapshot[]> {
    const rows = await listAllFlags(this.deps.db);
    const rowMap = new Map(rows.map((r) => [r.key, r]));

    return FLAG_KEYS.map((key) => {
      const row = rowMap.get(key);
      const def = FLAG_REGISTRY[key];

      if (row === undefined) {
        return {
          key,
          kind: def.kind,
          enabled: def.default,
          percentage: null,
          allowlist: null,
          description: def.description,
          updatedAt: null,
          updatedBy: null,
        };
      }

      return {
        key,
        kind: def.kind,
        enabled: row.enabled,
        percentage: row.percentage,
        allowlist: row.allowlist,
        description: def.description,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    });
  }

  private async resolveRow(key: FlagKey): Promise<ResolvedFlagRow> {
    const cacheKey = kvKey(key);
    const cached = await this.deps.kv.get<CachedFlagRow>(cacheKey, "json");
    if (cached !== null) {
      return {
        enabled: cached.enabled,
        percentage: cached.percentage,
        allowlist: cached.allowlist,
      };
    }

    const row = await findFlagByKey(this.deps.db, key);
    if (row === null) {
      return registryDefault(key);
    }

    await this.deps.kv.put(
      cacheKey,
      JSON.stringify(rowToCache(row)),
      { expirationTtl: KV_TTL_SECONDS },
    );

    return {
      enabled: row.enabled,
      percentage: row.percentage,
      allowlist: row.allowlist,
    };
  }
}

interface ResolvedFlagRow {
  enabled: boolean;
  percentage: number | null;
  allowlist: string[] | null;
}

function evaluate(
  key: FlagKey,
  row: ResolvedFlagRow,
  principal: FlagPrincipal | undefined,
): boolean {
  if (!row.enabled) return false;

  // Allowlist overlay: an included principal always sees true.
  if (
    principal !== undefined &&
    row.allowlist !== null &&
    row.allowlist.includes(principal.id)
  ) {
    return true;
  }

  // Boolean-only path: enabled ⇒ true.
  if (row.percentage === null) return true;

  // Percentage bucket: no principal → cannot be assigned deterministically,
  // fall back to enabled (avoids blanket-off for unauth request paths).
  if (principal === undefined) return true;

  return bucket(principal.id, key) < row.percentage;
}

/**
 * SHA-256 based 0..99 bucket. Deterministic per (principalId, flagKey);
 * changing the flag key rebalances users, which is a feature — the
 * next flag using the same principal reuses the same hash space but
 * a different flag-key rebases the buckets.
 */
export function bucket(principalId: string, flagKey: string): number {
  const digest = sha256(new TextEncoder().encode(`${principalId}:${flagKey}`));
  // First 4 bytes → uint32 → modulo 100. sha256 uniformity makes the
  // modulo bias negligible for a 100-slot mapping.
  const u32 = (digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!;
  // `| 0` normalizes to a signed 32-bit int; take absolute value before
  // modulo since JS bitwise-or can return negative.
  return Math.abs(u32 | 0) % 100;
}

function registryDefault(key: FlagKey): ResolvedFlagRow {
  return {
    enabled: FLAG_REGISTRY[key].default,
    percentage: null,
    allowlist: null,
  };
}

function rowToCache(row: FlagRowDto): CachedFlagRow {
  return {
    enabled: row.enabled,
    percentage: row.percentage,
    allowlist: row.allowlist,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function kvKey(key: FlagKey): string {
  return `flag:${key}`;
}

function validatePercentage(value: number | null): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(
      `flags.set: percentage must be an integer 0-100 or null (got ${value})`,
    );
  }
}

function validateAllowlist(value: string[] | null): void {
  if (value === null) return;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(
      "flags.set: allowlist must be an array of principal-id strings or null",
    );
  }
}

/**
 * Exported helper for the internal audit logger — the hex hash uniquely
 * identifies a percentage bucket assignment for the given (principal,
 * flag) tuple. Not used at the read path (bucket() is the hot call);
 * exported for observability / debug tooling.
 */
export function bucketDebugHash(principalId: string, flagKey: string): string {
  const digest = sha256(new TextEncoder().encode(`${principalId}:${flagKey}`));
  return bytesToHex(digest).slice(0, 8);
}
