#!/usr/bin/env tsx
/**
 * One local login per business role on the LOCAL dev D1 — one command, no dev server needed.
 *   RUNWAY_LOCAL=1 pnpm dev:seed-team [--password '…']
 * Idempotent: existing user kept (password untouched, name updated); role grant is INSERT OR IGNORE.
 */
import { parseArgs } from "node:util";
import { DEFAULT_PASSWORD, execLocalD1, refuse as refuseWith, requireLocal, upsertUserSql, validateUser, type RoleName } from "./lib/dev-seed.ts";

const refuse = (reason: string): never => refuseWith("dev-seed-team", reason);
requireLocal("dev-seed-team");

const { values } = parseArgs({ options: { password: { type: "string", default: DEFAULT_PASSWORD } } });
const password = values.password!;

const TEAM: { email: string; role: RoleName; name: string }[] = [
  { email: "admin@runway.local", role: "admin", name: "Quản trị hệ thống" },
  { email: "giamdoc@runway.local", role: "giam_doc", name: "Nguyễn Nhật Minh" },
  { email: "quanly@runway.local", role: "quan_ly", name: "Tường Vi" },
  { email: "nhanvien@runway.local", role: "nhan_vien", name: "Minh Khánh" },
  // C-11-001: root exists only through this seeder (the app never gives it) — toggles two-layer approval.
  { email: "root@runway.local", role: "root", name: "Root admin" },
];

async function main(): Promise<void> {
  for (const u of TEAM) validateUser("dev-seed-team", u.email, u.name);
  const sql = (await Promise.all(TEAM.map((u) => upsertUserSql(u.email, password, u.name, u.role)))).join(" ");
  execLocalD1("dev-seed-team", sql);
  console.log("local D1 seeded (password " + (password === DEFAULT_PASSWORD ? password : "(your --password)") + "):");
  console.log("email".padEnd(24) + "role");
  for (const u of TEAM) console.log(u.email.padEnd(24) + u.role);
}

void main().catch((e) => refuse(String(e)));
