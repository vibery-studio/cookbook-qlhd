import { z } from "zod";
import type { Db } from "../db/client";
import {
  findSettingByKey,
  listAllSettings,
  upsertSetting,
} from "../dao/settings-dao";
import { createAuditLogger } from "../observability/logger";
import {
  SETTINGS_REGISTRY,
  SETTING_KEYS,
  type SettingKey,
  type SettingValue,
} from "./registry";
import type { SettingSnapshot, SettingsPort } from "./settings-port";

/**
 * SettingsService — the concrete implementation of SettingsPort.
 *
 * Read path (`get`):
 *   1. KV lookup at key `setting:<key>`. Miss → step 2.
 *   2. D1 lookup. Row absent → step 3.
 *   3. Return registry default.
 *
 * On D1 hit, the value is Zod-parsed against the registry schema. A
 * parse failure THROWS — the caller sees a loud error rather than
 * silently continuing with a bogus value. The KV cache is populated
 * after a successful parse so the next request skips D1 for
 * KV_TTL_SECONDS.
 *
 * Write path (`set`):
 *   1. Zod-parse the incoming value; throws on invalid.
 *   2. Upsert D1 (single-statement `INSERT ... ON CONFLICT DO UPDATE`).
 *   3. Delete the KV entry so the next reader gets the fresh value.
 *   4. Emit a SYNC structured audit log so operator changes appear
 *      in Logpush BEFORE the response returns. Phase 9 replaces
 *      `console.log` with a real audit sink.
 */
const KV_TTL_SECONDS = 300;

export interface SettingsServiceDeps {
  db: Db;
  kv: KVNamespace;
}

export class SettingsService implements SettingsPort {
  constructor(private readonly deps: SettingsServiceDeps) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const cacheKey = kvKey(key);
    const cached = await this.deps.kv.get(cacheKey, "json");
    if (cached !== null) {
      // Cached values were validated when they were written, so
      // trust the cache. If a registry schema changed since the
      // cache was populated (rare — schema changes ride migrations),
      // the next writer will bust the entry.
      return cached as SettingValue<K>;
    }

    const row = await findSettingByKey(this.deps.db, key);
    const schema = SETTINGS_REGISTRY[key].schema;

    if (row === null) {
      const fallback = SETTINGS_REGISTRY[key].default as SettingValue<K>;
      return fallback;
    }

    const parsed = schema.safeParse(row.value);
    if (!parsed.success) {
      throw new Error(
        `settings.get: value for ${key} failed schema validation: ${parsed.error.message}`,
      );
    }

    await this.deps.kv.put(cacheKey, JSON.stringify(parsed.data), {
      expirationTtl: KV_TTL_SECONDS,
    });

    return parsed.data as SettingValue<K>;
  }

  async set<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    actor: string,
  ): Promise<void> {
    const schema = SETTINGS_REGISTRY[key].schema;
    const parsed = schema.parse(value);

    const now = Math.floor(Date.now() / 1000);
    await upsertSetting(this.deps.db, {
      key,
      value: parsed,
      updatedAt: now,
      updatedBy: actor,
    });

    // KV delete after the D1 upsert — a next-reader in the same
    // region sees the fresh D1 value on cache-miss. NOTE: this is
    // NOT a strict read-through-cache invalidation. A concurrent
    // reader that ran `kv.get()` (miss), then this writer's D1
    // upsert + kv.delete, and only then wrote its (now-stale) D1
    // value back into KV, will cache the old value for up to
    // KV_TTL_SECONDS. For v1 keys (from-address/from-name) this
    // race window is bounded by KV's own eventual-consistency
    // window (~60s cross-region) so worst-case impact is a small
    // number of emails using the previous address. Future keys
    // that need strict-consistency should either bump the TTL to
    // ~1s or move to `env` (redeploy-only). See `docs/settings.md`.
    await this.deps.kv.delete(kvKey(key));

    // Security-critical audit — SYNC so the record lands in
    // Logpush before the response returns. logger.audit's deepScrub
    // is defense-in-depth for future PII-carrying keys.
    const audit = createAuditLogger({ ctx: undefined, db: this.deps.db });
    audit(
      {
        actor,
        action: "settings.update",
        target: `settings:${key}`,
        metadata: { new_value: parsed },
      },
      { sync: true },
    );
    await audit.flush();
  }

  async list(): Promise<SettingSnapshot[]> {
    const rows = await listAllSettings(this.deps.db);
    const rowMap = new Map(rows.map((r) => [r.key, r]));

    return SETTING_KEYS.map((key) => {
      const row = rowMap.get(key);
      const schema = SETTINGS_REGISTRY[key].schema;
      const description = SETTINGS_REGISTRY[key].description;

      if (row === undefined) {
        return {
          key,
          value: SETTINGS_REGISTRY[key].default,
          description,
          updatedAt: null,
          updatedBy: null,
        };
      }

      const parsed = schema.safeParse(row.value);
      return {
        key,
        value: parsed.success ? parsed.data : SETTINGS_REGISTRY[key].default,
        description,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    });
  }
}

function kvKey(key: SettingKey): string {
  return `setting:${key}`;
}

/**
 * Public validation error type for admin route handlers. Distinct
 * from generic `z.ZodError` so callers can catch settings-write
 * failures without confusing them with request-body parse errors
 * (which OpenAPIHono already handles upstream).
 */
export class SettingsValidationError extends Error {
  constructor(
    public readonly key: SettingKey,
    public readonly zodError: z.ZodError,
  ) {
    super(`Invalid value for ${key}: ${zodError.message}`);
    this.name = "SettingsValidationError";
  }
}
