/**
 * System-settings registry. Tightly scoped to runtime-mutable
 * operational values a human operator changes WITHOUT a redeploy —
 * anything else (auth TTLs, password rules, rate-limit thresholds)
 * lives in `env` and is Zod-parsed at boot, so bad values fail
 * loudly on startup instead of drifting silently through a KV
 * write.
 *
 * Adding a key:
 *   1. Add a `<name>: { schema, default, description }` entry here
 *   2. Add a seed row to the next migration (`INSERT OR IGNORE`)
 *   3. Callers use `settings.get('<name>')` — the return type is
 *      inferred from the Zod schema at compile time.
 *
 * Removing a key: replace the row with the new key in a migration
 * (copy value, then delete old), update the registry, update callers.
 * See `docs/settings.md` for the recipe.
 *
 * No `scope` column in v1 (single-tenant). v2 multi-tenant will add
 * a `(scope, key)` composite PK + a scope resolver in the service.
 */
import { z } from "zod";

export const SETTINGS_REGISTRY = {
  "email.from_address": {
    schema: z.string().email(),
    default: "no-reply@example.com",
    description: "From address on all outbound emails",
  },
  "email.from_name": {
    schema: z.string().min(1).max(64),
    default: "Runway",
    description: "From name on all outbound emails",
  },
} as const;

export type SettingsRegistry = typeof SETTINGS_REGISTRY;
export type SettingKey = keyof SettingsRegistry;

export const SETTING_KEYS = Object.keys(SETTINGS_REGISTRY) as SettingKey[];

/**
 * Compile-time guard: `isSettingKey('email.from_address')` narrows a
 * string to `SettingKey`. Used by admin route handlers to reject
 * unknown keys BEFORE reaching the registry lookup.
 */
export function isSettingKey(value: string): value is SettingKey {
  return value in SETTINGS_REGISTRY;
}

/**
 * Extracts the parsed value type for a given key. Used by
 * `settings.get<K>(key)` so callers get the right type back without
 * a manual cast.
 */
export type SettingValue<K extends SettingKey> = z.infer<SettingsRegistry[K]["schema"]>;
