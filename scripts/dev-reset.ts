#!/usr/bin/env tsx
/**
 * Local-dev reset (Phase 4 v1.1). Wipes the miniflare-local D1 state,
 * re-applies every migration in order (which seeds RBAC, settings,
 * flags), then optionally creates a canonical dev-admin user for
 * bootstrap.
 *
 * SAFETY: This script REFUSES to touch remote D1. Guardrails:
 *   1. Env-var gate — must set `RUNWAY_LOCAL=1` to run.
 *   2. Hard-coded refusal on any db name containing `prod` or `preview`.
 *   3. Always passes `--local` to wrangler.
 *
 * Usage:
 *   RUNWAY_LOCAL=1 pnpm dev:reset
 *   RUNWAY_LOCAL=1 pnpm dev:reset --skip-admin
 *
 * The dev-admin credentials are printed at the end so a fresh clone
 * can log in immediately.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const LOCAL_DB_NAME = "runway_dev";
const FORBIDDEN_DB_MARKERS = ["prod", "preview"];

const DEV_ADMIN_EMAIL = "admin@runway.local";
const DEV_ADMIN_PASSWORD = "correct-horse-battery-staple";

function refuse(reason: string): never {
  console.error(`dev-reset: refusing — ${reason}`);
  process.exit(2);
}

function requireLocalGate(): void {
  if (process.env["RUNWAY_LOCAL"] !== "1") {
    refuse(
      "RUNWAY_LOCAL=1 not set. This script is dev-only. Re-run with " +
        "`RUNWAY_LOCAL=1 pnpm dev:reset` after confirming you want to wipe local D1.",
    );
  }
  const suspect = FORBIDDEN_DB_MARKERS.find((m) => LOCAL_DB_NAME.includes(m));
  if (suspect !== undefined) {
    refuse(`LOCAL_DB_NAME contains '${suspect}' — refusing to run against a possibly-remote db.`);
  }
}

function wipeMiniflareState(): void {
  const stateDir = path.resolve(process.cwd(), ".wrangler/state");
  if (!existsSync(stateDir)) {
    console.log("dev-reset: no .wrangler/state to wipe (fresh clone?)");
    return;
  }
  console.log(`dev-reset: wiping ${stateDir}`);
  rmSync(stateDir, { recursive: true, force: true });
}

function applyMigrations(): void {
  console.log("dev-reset: applying migrations (wrangler d1 migrations apply --local)…");
  const result = spawnSync(
    "pnpm",
    ["--dir", ".", "db:migrate:local"],
    { stdio: "inherit", cwd: process.cwd() },
  );
  if (result.status !== 0) {
    refuse(`migrations failed with exit ${result.status ?? "?"}`);
  }
}

interface Args {
  skipAdmin: boolean;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      "skip-admin": { type: "boolean", default: false },
    },
  });
  return { skipAdmin: values["skip-admin"] === true };
}

function printAdminCredentials(): void {
  console.log("");
  console.log("dev-reset: DONE");
  console.log("");
  console.log("The migrations have created empty tables + seeded RBAC/settings/flags.");
  console.log("");
  console.log("To create the dev-admin user, run `pnpm dev` in a separate terminal, then:");
  console.log("");
  console.log(`  curl -X POST http://localhost:8787/auth/signup \\`);
  console.log(`    -H 'content-type: application/json' \\`);
  console.log(`    -H 'origin: http://localhost:8787' \\`);
  console.log(`    -H 'x-requested-with: fetch' \\`);
  console.log(`    -d '{"email":"${DEV_ADMIN_EMAIL}","password":"${DEV_ADMIN_PASSWORD}"}'`);
  console.log("");
  console.log("Then verify the email (dev prints the token to server logs) and:");
  console.log("");
  console.log(`  pnpm db:seed:admin --email ${DEV_ADMIN_EMAIL} --db ${LOCAL_DB_NAME}`);
  console.log("");
  console.log("Log in with those credentials.");
}

function main(): void {
  requireLocalGate();
  const args = parseCliArgs();

  const started = Date.now();
  wipeMiniflareState();
  applyMigrations();
  if (!args.skipAdmin) {
    printAdminCredentials();
  }
  const durationSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`dev-reset: completed in ${durationSec}s`);
}

main();
