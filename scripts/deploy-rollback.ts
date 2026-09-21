#!/usr/bin/env tsx
/**
 * Rollback the production (or preview) Worker to the previous known-good
 * version. Wraps `wrangler rollback` and, when a recovery-point manifest
 * exists (written by scripts/deploy-prod.sh before migrations run), prints
 * the D1 Time Travel bookmark id so the operator can restore the DB if a
 * migration also needs undoing.
 *
 * Does NOT restore the DB automatically — Time Travel restore is a
 * destructive whole-DB operation and requires the operator to confirm the
 * bookmark id against the pre-deploy timestamp. See docs/deploy.md for the
 * manual restore steps.
 *
 * Usage:
 *   pnpm deploy:rollback                                 # env=production
 *   pnpm deploy:rollback -- --env preview
 *   pnpm deploy:rollback -- --env production --version <version-id>
 *   pnpm deploy:rollback -- --manifest .deploy-recovery.json
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

type Env = "production" | "preview";

type RecoveryManifest = {
  env: Env;
  sha: string;
  timestamp: string;
  actor: string;
  bookmark_id?: string;
  bookmark_name?: string;
  d1_database?: string;
};

type Args = {
  env: Env;
  version?: string;
  manifestPath: string;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let env: Env = "production";
  let version: string | undefined;
  let manifestPath = ".deploy-recovery.json";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (a === "--env" && v) {
      if (v !== "production" && v !== "preview") {
        console.error(`deploy-rollback: unknown env "${v}"`);
        process.exit(2);
      }
      env = v as Env;
      i++;
    } else if (a === "--version" && v) {
      version = v;
      i++;
    } else if (a === "--manifest" && v) {
      manifestPath = v;
      i++;
    }
  }
  return { env, version, manifestPath };
}

function loadManifest(path: string): RecoveryManifest | null {
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, "utf-8")) as RecoveryManifest;
  } catch (err) {
    console.error(`deploy-rollback: manifest ${abs} is not valid JSON`, err);
    return null;
  }
}

function ghAnnotation(kind: "warning" | "error", message: string): void {
  // GH Actions consumes ::warning::/::error:: from stdout. When run
  // locally it just prints as text — no harm.
  process.stdout.write(`::${kind}::${message}\n`);
}

function runWrangler(args: string[]): number {
  console.log(`\n> npx wrangler ${args.join(" ")}\n`);
  const r = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit" });
  return r.status ?? 1;
}

function main(): void {
  const { env, version, manifestPath } = parseArgs();

  console.log(`\ndeploy-rollback: env=${env}${version ? ` version=${version}` : ""}\n`);

  const manifest = loadManifest(manifestPath);
  if (manifest) {
    console.log("Recovery manifest found:");
    console.log(`  SHA:           ${manifest.sha}`);
    console.log(`  Deployed at:   ${manifest.timestamp}`);
    console.log(`  Actor:         ${manifest.actor}`);
    if (manifest.bookmark_id) {
      console.log(`  D1 database:   ${manifest.d1_database ?? "(unknown)"}`);
      console.log(`  Bookmark id:   ${manifest.bookmark_id}`);
      console.log(`  Bookmark name: ${manifest.bookmark_name ?? "(unnamed)"}`);
    } else {
      console.log("  D1 bookmark:   (none recorded — migrations may not have run)");
    }
    console.log("");
  } else {
    console.log(
      `No recovery manifest at ${manifestPath}. Worker rollback will still fire; DB is untouched.\n`,
    );
  }

  // Rollback the Worker.
  const wranglerArgs = ["rollback", "--config", "apps/api/wrangler.toml", "--env", env];
  if (version) wranglerArgs.push(version);
  const code = runWrangler(wranglerArgs);
  if (code !== 0) {
    ghAnnotation("error", `wrangler rollback exited ${code} (env=${env})`);
    process.exit(code);
  }

  ghAnnotation(
    "warning",
    `Worker rolled back on env=${env}. ${
      manifest?.bookmark_id
        ? `DB not restored — Time Travel bookmark ${manifest.bookmark_id} available if a migration also needs undoing (see docs/deploy.md).`
        : "No DB bookmark recorded."
    }`,
  );

  console.log("\ndeploy-rollback: OK — Worker rolled back. Verify /healthz next.\n");
  process.exit(0);
}

main();
