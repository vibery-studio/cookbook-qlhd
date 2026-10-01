#!/usr/bin/env tsx
/**
 * Create a working admin login on the LOCAL dev D1 — one command.
 *
 * Usage (with `pnpm dev` running):
 *   RUNWAY_LOCAL=1 pnpm dev:seed-admin
 *   RUNWAY_LOCAL=1 pnpm dev:seed-admin --email giamdoc@example.local --password '…'
 *
 * Why this exists: `db:seed:admin` always targets the REMOTE D1 and only grants
 * a role to an existing user. Public signup is now OFF (flag `signup.enabled` = 0, migration 0010),
 * so this no longer goes through the API: it hashes the password with @runway/auth and inserts the
 * user (active, verified, display_name, admin role) straight into the local D1 with one
 * `wrangler d1 execute --local`, then proves it with a real login against the dev server.
 * Idempotent: an existing user is kept (password untouched, name updated); the role grant is INSERT OR IGNORE.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_PASSWORD, execLocalD1, refuse as refuseWith, requireLocal, upsertUserSql, validateUser } from "./lib/dev-seed.ts";

const refuse = (reason: string): never => refuseWith("dev-seed-admin", reason);
requireLocal("dev-seed-admin");

const { values } = parseArgs({
  options: {
    email: { type: "string", default: "admin@runway.local" },
    password: { type: "string", default: DEFAULT_PASSWORD },
    name: { type: "string", default: "Quản trị hệ thống" },
  },
});
const email = values.email!.trim().toLowerCase();
const password = values.password!;
const displayName = values.name!.trim();
validateUser("dev-seed-admin", email, displayName);

// The dev server's origin: apps/api/.dev.vars APP_ORIGIN, else wrangler's default port.
function devOrigin(): string {
  try {
    const m = readFileSync("apps/api/.dev.vars", "utf8").match(/^APP_ORIGIN=(.+)$/m);
    if (m?.[1]) return m[1].trim();
  } catch {
    /* no .dev.vars */
  }
  return "http://localhost:8787";
}
const BASE = devOrigin();
const headers = { "content-type": "application/json", origin: BASE, "x-requested-with": "fetch" };

async function main(): Promise<void> {
  try {
    await fetch(`${BASE}/healthz`);
  } catch {
    refuse(`no dev server at ${BASE} — start \`pnpm dev\` first`);
  }

  execLocalD1("dev-seed-admin", await upsertUserSql(email, password, displayName, "admin"));
  console.log(`local D1: ${email} active + admin role + name "${displayName}"`)

  const login = await fetch(`${BASE}/auth/login`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  if (login.status !== 200) {
    refuse(`login ${login.status} — if the user existed with another password, pass --password`);
  }
  console.log(`login: 200 ✓  →  ${email} / ${password === DEFAULT_PASSWORD ? password : "(your --password)"}`);
  console.log("Note: a role change is picked up on the next login (the principal cache is per session).");
}

void main();
