import type { FlagKey } from "./registry";

/**
 * FlagsPort — the read-write surface for the feature-flag registry.
 * `FlagsService` is the concrete implementation; keeping this a port
 * means test doubles (in-memory Map) drop in without dependency
 * injection ceremony.
 *
 * `get()` returns a boolean regardless of flag kind. For percentage-
 * capable flags the boolean is the evaluated result for the given
 * principal: allowlist match → true, otherwise
 * `hash(principalId + flagKey) % 100 < percentage`. Boolean flags
 * ignore the principal.
 */
export interface FlagsPort {
  /**
   * Evaluate a flag for an optional principal. Returns the registry
   * default when no D1 row exists. NEVER throws for a registered key.
   */
  get(key: FlagKey, principal?: FlagPrincipal): Promise<boolean>;

  /**
   * Write a flag row. Validates against the registry (unknown key
   * throws). On success: upsert D1, bust KV, emit a SYNC audit event.
   * `percentage` must be 0-100 or null. `allowlist` must be an array
   * of principal ids or null.
   */
  set(key: FlagKey, patch: FlagUpdate, actor: string): Promise<void>;

  /**
   * Return every registered flag with its current row (filling in
   * defaults for absent rows). Used by `GET /admin/flags` for the
   * operator dashboard.
   */
  list(): Promise<FlagSnapshot[]>;
}

export interface FlagPrincipal {
  id: string;
}

export interface FlagUpdate {
  enabled?: boolean;
  percentage?: number | null;
  allowlist?: string[] | null;
}

export interface FlagSnapshot {
  key: FlagKey;
  kind: "boolean" | "percentage";
  enabled: boolean;
  percentage: number | null;
  allowlist: string[] | null;
  description: string;
  updatedAt: number | null;
  updatedBy: string | null;
}
