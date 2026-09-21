/**
 * Feature-flags DAO. Storage shape mirrors the migration:
 *   - `enabled`    stored as INTEGER 0/1 → surfaced as boolean.
 *   - `percentage` nullable INTEGER (0-100 when set).
 *   - `allowlist`  nullable TEXT JSON array; JSON-encoded here so the
 *                  service never sees raw text.
 *
 * Returns DTOs; the FlagsService above enforces registry membership +
 * emits the audit event.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { featureFlags } from "../db/schema";

export interface FlagRowDto {
  key: string;
  enabled: boolean;
  percentage: number | null;
  allowlist: string[] | null;
  updatedAt: number;
  updatedBy: string | null;
}

export async function findFlagByKey(db: Db, key: string): Promise<FlagRowDto | null> {
  const row = await db.query.featureFlags.findFirst({
    where: eq(featureFlags.key, key),
  });
  if (row === undefined) return null;
  return toDto(row);
}

export async function listAllFlags(db: Db): Promise<FlagRowDto[]> {
  const rows = await db.select().from(featureFlags);
  return rows.map(toDto);
}

export async function upsertFlag(
  db: Db,
  input: {
    key: string;
    enabled: boolean;
    percentage: number | null;
    allowlist: string[] | null;
    updatedAt: number;
    updatedBy: string;
  },
): Promise<void> {
  const allowlistJson =
    input.allowlist === null ? null : JSON.stringify(input.allowlist);
  await db
    .insert(featureFlags)
    .values({
      key: input.key,
      enabled: input.enabled ? 1 : 0,
      percentage: input.percentage,
      allowlist: allowlistJson,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: {
        enabled: input.enabled ? 1 : 0,
        percentage: input.percentage,
        allowlist: allowlistJson,
        updatedAt: input.updatedAt,
        updatedBy: input.updatedBy,
      },
    });
}

function toDto(row: {
  key: string;
  enabled: number;
  percentage: number | null;
  allowlist: string | null;
  updatedAt: number;
  updatedBy: string | null;
}): FlagRowDto {
  return {
    key: row.key,
    enabled: row.enabled === 1,
    percentage: row.percentage,
    allowlist: parseAllowlist(row.allowlist),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function parseAllowlist(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
