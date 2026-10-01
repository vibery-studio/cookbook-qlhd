#!/usr/bin/env tsx
/**
 * DEMO team (admin · giám đốc · quản lý · nhân viên · root) on a REMOTE D1 — the one the Worker really uses.
 *   DEMO_PASSWORD='…≥12 ký tự…' pnpm demo:seed-remote [--db runway_prod] [--env production] [--dry-run]
 * Idempotent: existing user kept (password untouched), name updated; role grant INSERT OR IGNORE.
 * Products + price levels already come from migration 0022 (DEMO), so they are NOT seeded here.
 * The password is mandatory and never defaulted: the repo is public, a default would be a public credential.
 * Runs `wrangler d1 execute --remote` under the operator's own wrangler session (like scripts/seed-admin.ts).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { refuse as refuseWith, upsertUserSql, validateUser, type RoleName } from "./lib/dev-seed.ts";

const S = "seed-demo-remote";
const refuse = (reason: string): never => refuseWith(S, reason);

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "runway_prod" },
    env: { type: "string", default: "production" },
    "dry-run": { type: "boolean", default: false },
  },
});
const password = process.env["DEMO_PASSWORD"] ?? "";
if (password.length < 12) refuse("set DEMO_PASSWORD (>= 12 ký tự) in the environment; it is never defaulted and never printed");

const TEAM: { email: string; role: RoleName; name: string }[] = [
  { email: "admin@runway.local", role: "admin", name: "Quản trị hệ thống" },
  { email: "giamdoc@runway.local", role: "giam_doc", name: "Nguyễn Nhật Minh" },
  { email: "quanly@runway.local", role: "quan_ly", name: "Tường Vi" },
  { email: "nhanvien@runway.local", role: "nhan_vien", name: "Minh Khánh" },
  { email: "root@runway.local", role: "root", name: "Root admin" },
];

async function main(): Promise<void> {
  for (const u of TEAM) validateUser(S, u.email, u.name);
  console.log(`target: ${values.db} (--remote, env ${values.env})`);
  for (const u of TEAM) console.log(u.email.padEnd(24) + u.role);
  if (values["dry-run"] === true) return console.log("dry-run: nothing written");

  const sql = (await Promise.all(TEAM.map((u) => upsertUserSql(u.email, password, u.name, u.role)))).join("\n");
  const dir = mkdtempSync(join(tmpdir(), "seed-demo-"));
  const file = join(dir, "seed.sql");
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    const r = spawnSync(
      "pnpm",
      ["exec", "wrangler", "--config", "apps/api/wrangler.toml", "d1", "execute", values.db!, "--remote", "--env", values.env!, "--file", file, "-y"],
      { stdio: "inherit" },
    );
    if (r.status !== 0) refuse("remote D1 update failed (see wrangler output above)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("done. Đăng nhập bằng email ở trên và DEMO_PASSWORD bạn vừa đặt.");
}

void main().catch((e) => refuse(String(e)));
