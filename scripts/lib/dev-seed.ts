/** Shared helpers for the local dev seed scripts (dev-seed-admin, dev-seed-team). LOCAL D1 only. */
import { spawnSync } from "node:child_process";
import { hashPassword } from "../../packages/auth/src/index.ts";
import { generateUlid } from "../../apps/api/src/utils/id.ts";

export const LOCAL_DB_NAME = "runway_dev";
export const DEFAULT_PASSWORD = "correct-horse-battery-staple";
// migrations/0001_seed_rbac.sql, 0010_seed_foundation.sql
export const ROLE_IDS = {
  admin: "01ROLE0000000000000ADMIN00",
  giam_doc: "01ROLE00000000000GIAMDOC00",
  quan_ly: "01ROLE000000000000QUANLY00",
  nhan_vien: "01ROLE0000000000NHANVIEN00",
} as const;
export type RoleName = keyof typeof ROLE_IDS;

export function refuse(script: string, reason: string): never {
  console.error(`${script}: refusing — ${reason}`);
  process.exit(2);
}

export function requireLocal(script: string): void {
  if (process.env["RUNWAY_LOCAL"] !== "1") {
    refuse(script, `RUNWAY_LOCAL=1 not set. This script is dev-only: \`RUNWAY_LOCAL=1 pnpm ${script.replace("dev-seed", "dev:seed")}\`.`);
  }
}

export function validateUser(script: string, email: string, displayName: string): void {
  if (displayName.length === 0 || displayName.length > 100) refuse(script, "--name must be 1-100 chars");
  if (!/^[^\s@'"]+@[^\s@'"]+$/.test(email)) refuse(script, `invalid email '${email}'`);
}

const q = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/** Idempotent SQL: keep existing user (password untouched), update name, grant role INSERT OR IGNORE. */
export async function upsertUserSql(email: string, password: string, displayName: string, role: RoleName): Promise<string> {
  const passwordHash = await hashPassword(password);
  return (
    `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, status, verified_at, created_at, updated_at) ` +
    `VALUES (${q(generateUlid())}, ${q(email)}, ${q(passwordHash)}, ${q(displayName)}, 'active', unixepoch(), unixepoch(), unixepoch()); ` +
    `UPDATE users SET display_name = ${q(displayName)}, verified_at = COALESCE(verified_at, unixepoch()), status = 'active' WHERE email = ${q(email)}; ` +
    `INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT id, '${ROLE_IDS[role]}' FROM users WHERE email = ${q(email)};`
  );
}

/** Always `--local`; never remote. */
export function execLocalD1(script: string, sql: string): void {
  const r = spawnSync(
    "pnpm",
    ["exec", "wrangler", "--config", "apps/api/wrangler.toml", "d1", "execute", LOCAL_DB_NAME, "--local", "--command", sql],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (r.status !== 0) refuse(script, `local D1 update failed:\n${r.stderr || r.stdout}`);
}

/** Always `--local`; returns the rows of ONE read-only statement (wrangler `--json`). */
export function execLocalD1Json<T = Record<string, unknown>>(script: string, sql: string): T[] {
  const r = spawnSync(
    "pnpm",
    ["exec", "wrangler", "--config", "apps/api/wrangler.toml", "d1", "execute", LOCAL_DB_NAME, "--local", "--json", "--command", sql],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (r.status !== 0) refuse(script, `local D1 read failed:\n${r.stderr || r.stdout}`);
  try {
    const out = r.stdout.slice(r.stdout.indexOf("["));
    return (JSON.parse(out) as { results: T[] }[])[0]?.results ?? [];
  } catch {
    return refuse(script, `cannot parse wrangler --json output:\n${r.stdout}`);
  }
}

/** Triggers of a table, exactly as stored (the SQL lives only in the migration — same idea as clearAuditEvents). */
export function readTriggerSql(script: string, table: string): { name: string; sql: string }[] {
  return execLocalD1Json<{ name: string; sql: string }>(
    script,
    `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '${table}' ORDER BY name`,
  );
}
