import type { SettingKey, SettingValue } from "./registry";

/**
 * SettingsPort — the read-write surface for the runtime-mutable
 * settings registry. Callers depend on this port; `SettingsService`
 * is the concrete implementation. Keeping this a port means test
 * doubles are trivial (in-memory Map).
 *
 * Typed on `SettingKey` so callers can't request an unregistered
 * key at compile time. Runtime lookup for admin routes (which
 * receive `:key` as a URL param) uses `isSettingKey()` to narrow
 * first.
 */
export interface SettingsPort {
  /**
   * Read a setting. Order: KV cache → D1 row → registry default.
   * NEVER throws for a registered key — returns the default when
   * no D1 row exists. If the stored value is corrupt (Zod schema
   * mismatch on a legacy row), throws so the caller sees a loud
   * failure instead of silently continuing with a bogus value.
   */
  get<K extends SettingKey>(key: K): Promise<SettingValue<K>>;

  /**
   * Write a setting. Validates via the registry schema; throws on
   * failure. On success: upsert D1, bust KV, emit a SYNC audit log.
   */
  set<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    actor: string,
  ): Promise<void>;

  /**
   * Return every registered setting with its current value. Used
   * by `GET /admin/settings` for the operator dashboard. Fills in
   * the registry default for any key without a D1 row.
   */
  list(): Promise<Array<SettingSnapshot>>;
}

export interface SettingSnapshot {
  key: SettingKey;
  value: unknown;
  description: string;
  updatedAt: number | null;
  updatedBy: string | null;
}
