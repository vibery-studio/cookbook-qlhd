/**
 * Feature-flag registry — the closed catalog of runtime-mutable behavior
 * switches. Distinct from `settings` (which mutate *values*): a flag exists
 * to turn something ON or OFF (with an optional percentage rollout), never
 * to hold an arbitrary configuration value.
 *
 * Adding a flag:
 *   1. Add a `<key>: { kind, default, description }` entry here.
 *   2. Add a seed row (INSERT OR IGNORE) to the next migration.
 *   3. Callers use `flags.get('<key>', principal?)` — the return type is
 *      boolean, always.
 *
 * `kind` distinguishes boolean-only flags from ones that may carry a
 * percentage bucket. v1.1 seeds only boolean flags (kill switches +
 * maintenance mode); percentage-capable flags land as consumers register
 * them.
 *
 * Registry drift note: a flag defined here without a corresponding D1
 * row returns the registry `default`. Ship a seed migration alongside
 * every new flag so the operator dashboard shows a row.
 */

export interface BooleanFlagDef {
  readonly kind: "boolean";
  readonly default: boolean;
  readonly description: string;
}

export interface PercentageFlagDef {
  readonly kind: "percentage";
  readonly default: boolean;
  readonly description: string;
}

export type FlagDef = BooleanFlagDef | PercentageFlagDef;

export const FLAG_REGISTRY = {
  "system.maintenance_mode": {
    kind: "boolean",
    default: false,
    description: "Block all non-safelisted routes with 503",
  },
  "system.writes_disabled": {
    kind: "boolean",
    default: false,
    description: "Block state-changing routes; reads pass through",
  },
  "email.enabled": {
    kind: "boolean",
    default: true,
    description: "Kill switch for outbound email; when false, adapter no-ops",
  },
  "signup.enabled": {
    kind: "boolean",
    // Invite-only app (SPEC-01 FR-3): off by default; migration 0010 flips the seed row.
    default: false,
    description: "When false, /auth/signup returns 503; existing users unaffected",
  },
} as const satisfies Record<string, FlagDef>;

export type FlagRegistry = typeof FLAG_REGISTRY;
export type FlagKey = keyof FlagRegistry;

export const FLAG_KEYS = Object.keys(FLAG_REGISTRY) as FlagKey[];

/**
 * Runtime narrowing for admin-route path params (which arrive as raw
 * strings). Mirrors `isSettingKey`.
 */
export function isFlagKey(value: string): value is FlagKey {
  return value in FLAG_REGISTRY;
}
