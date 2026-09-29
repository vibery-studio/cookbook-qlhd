#!/usr/bin/env tsx
/**
 * Create a working admin login on the LOCAL dev D1 — one command.
 *
 * Usage (with `pnpm dev` running):
 *   RUNWAY_LOCAL=1 pnpm dev:seed-admin
 *   RUNWAY_LOCAL=1 pnpm dev:seed-admin --email giamdoc@example.local --password '…'
 *
 * Why this exists: `db:seed:admin` always targets the REMOTE D1 and only grants
 * a role to an existing user; dev no longer prints the email-verify token. This
 * signs up through the real API (the app hashes the password), then marks the
 * user verified + active and grants the admin role in the local D1 (one
 * `wrangler d1 execute --local`), then proves it with a real login.
 * Idempotent: an existing user is kept; the role grant is INSERT OR IGNORE.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const LOCAL_DB_NAME = "runway_dev";
const ADMIN_ROLE_ID = "01ROLE0000000000000ADMIN00"; // migrations/0001_seed_rbac.sql

function refuse(reason: string): never {
  console.error(`dev-seed-admin: refusing — ${reason}`);
  process.exit(2);
}

if (process.env["RUNWAY_LOCAL"] !== "1") {
  refuse("RUNWAY_LOCAL=1 not set. This script is dev-only: `RUNWAY_LOCAL=1 pnpm dev:seed-admin`.");
}

const { values } = parseArgs({
  options: {
    email: { type: "string", default: "admin@runway.local" },
    password: { type: "string", default: "correct-horse-battery-staple" },
  },
});
const email = values.email!.trim().toLowerCase();
const password = values.password!;
if (!/^[^\s@'"]+@[^\s@'"]+$/.test(email)) refuse(`invalid email '${email}'`);

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

  const signup = await fetch(`${BASE}/auth/signup`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  if (signup.status !== 201 && signup.status !== 409) {
    refuse(`signup ${signup.status}: ${await signup.text()}`);
  }
  console.log(`signup: ${signup.status === 201 ? "created" : "already exists (kept)"}`);

  const sql =
    `UPDATE users SET verified_at = COALESCE(verified_at, unixepoch()), status = 'active' WHERE email = '${email}'; ` +
    `INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT id, '${ADMIN_ROLE_ID}' FROM users WHERE email = '${email}';`;
  const r = spawnSync(
    "pnpm",
    ["exec", "wrangler", "--config", "apps/api/wrangler.toml", "d1", "execute", LOCAL_DB_NAME, "--local", "--command", sql],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (r.status !== 0) refuse(`local D1 update failed:\n${r.stderr || r.stdout}`);
  console.log("local D1: verified + active + admin role");

  const login = await fetch(`${BASE}/auth/login`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  if (login.status !== 200) {
    refuse(`login ${login.status} — if the user existed with another password, pass --password`);
  }
  console.log(`login: 200 ✓  →  ${email} / ${password === "correct-horse-battery-staple" ? password : "(your --password)"}`);
  console.log("Note: a role change is picked up on the next login (the principal cache is per session).");
}

void main();
