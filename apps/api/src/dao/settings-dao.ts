/**
 * Settings DAO. Returns DTOs; the SettingsService layer above JSON-
 * parses the string value and Zod-validates against the registry.
 *
 * Storage shape: `key` PK, `value` TEXT (JSON-serialized). We JSON-
 * encode/decode here so the service never sees raw text — that also
 * means null-valued settings are stored as the literal string `"null"`
 * (never as SQL NULL). The columns `updated_at` and `updated_by`
 * capture the audit trail; a null `updated_by` indicates a seed row.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { settings } from "../db/schema";

export interface SettingRowDto {
  key: string;
  value: unknown;
  updatedAt: number;
  updatedBy: string | null;
}

export async function findSettingByKey(
  db: Db,
  key: string,
): Promise<SettingRowDto | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  if (row === undefined) return null;
  return {
    key: row.key,
    value: safeJsonParse(row.value),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export async function listAllSettings(db: Db): Promise<SettingRowDto[]> {
  const rows = await db.select().from(settings);
  return rows.map((row) => ({
    key: row.key,
    value: safeJsonParse(row.value),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }));
}

export async function upsertSetting(
  db: Db,
  input: { key: string; value: unknown; updatedAt: number; updatedBy: string },
): Promise<void> {
  await db
    .insert(settings)
    .values({
      key: input.key,
      value: JSON.stringify(input.value),
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: JSON.stringify(input.value),
        updatedAt: input.updatedAt,
        updatedBy: input.updatedBy,
      },
    });
}

/**
 * Wraps `JSON.parse` so a legacy row with unparseable text doesn't
 * hard-crash the whole request path. Returns `null` on parse failure;
 * the service layer's Zod validation will reject `null` (or the
 * registry default takes over if `null` matches nothing sensible).
 */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
