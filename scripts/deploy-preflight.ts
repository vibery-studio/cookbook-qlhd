#!/usr/bin/env tsx
/**
 * Local pre-deploy safety gate. Runs BEFORE any migration or wrangler
 * deploy against production. Any non-zero exit stops the deploy.
 *
 * Checks:
 *   1. wrangler.toml binding parity across [env.*] blocks
 *      (delegates to scripts/validate-wrangler.ts).
 *   2. Bundle size still under the 900KB gzipped ceiling
 *      (delegates to scripts/check-bundle-size.ts).
 *   3. Every required secret is set on the target env
 *      (`wrangler secret list --env <env> --config apps/api/wrangler.toml`).
 *   4. The compiled Worker's expected SCHEMA_HEAD matches the highest
 *      numbered migration on disk (delegates to scripts/get-schema-head.ts).
 *
 * Local-only. Runs under the operator's `wrangler login` OAuth session; no
 * CLOUDFLARE_API_TOKEN required. Called from scripts/deploy-prod.sh.
 *
 * Usage:
 *   pnpm deploy:preflight                  # defaults to --env production
 *   pnpm deploy:preflight -- --env preview
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

type Env = "production" | "preview" | "dev";

const REQUIRED_SECRETS: Record<Env, string[]> = {
  production: ["JWT_SECRET", "TOKEN_PEPPER", "READYZ_TOKEN"],
  preview: ["JWT_SECRET", "TOKEN_PEPPER", "READYZ_TOKEN"],
  dev: [],
};

const OPTIONAL_SECRETS = ["RESEND_API_KEY", "SENTRY_DSN"];

function parseArgs(): { env: Env } {
  const args = process.argv.slice(2);
  let env: Env = "production";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env" && args[i + 1]) {
      const v = args[i + 1];
      if (v !== "production" && v !== "preview" && v !== "dev") {
        console.error(`deploy-preflight: unknown env "${v}"`);
        process.exit(2);
      }
      env = v as Env;
      i++;
    }
  }
  return { env };
}

function log(step: string, status: "ok" | "fail" | "info", detail?: string): void {
  const icon = status === "ok" ? "✓" : status === "fail" ? "✗" : "…";
  process.stdout.write(`  ${icon} ${step}${detail ? ` — ${detail}` : ""}\n`);
}

function runNode(scriptRelPath: string, extraArgs: string[] = []): { ok: boolean; stdout: string; stderr: string } {
  const scriptPath = resolve(process.cwd(), scriptRelPath);
  const r = spawnSync("tsx", [scriptPath, ...extraArgs], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function listSecrets(env: Env): { ok: boolean; names: string[]; error?: string } {
  const args = [
    "wrangler",
    "secret",
    "list",
    "--config",
    "apps/api/wrangler.toml",
  ];
  if (env !== "dev") {
    args.push("--env", env);
  }
  const r = spawnSync("npx", args, { encoding: "utf-8" });
  if (r.status !== 0) {
    return { ok: false, names: [], error: r.stderr || r.stdout || "wrangler secret list failed" };
  }
  // Wrangler output format:
  //   [
  //     { "name": "JWT_SECRET", "type": "secret_text" },
  //     ...
  //   ]
  // Older wrangler prints text lines; parse defensively.
  const raw = (r.stdout ?? "").trim();
  const names: string[] = [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (e && typeof e.name === "string") names.push(e.name);
      }
      return { ok: true, names };
    }
  } catch {
    // Fall through to text-line parse.
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*$/.exec(line);
    if (m) names.push(m[1]!);
  }
  return { ok: true, names };
}

function main(): void {
  const { env } = parseArgs();
  console.log(`\ndeploy-preflight: target env = ${env}\n`);
  const problems: string[] = [];

  // 1. wrangler binding parity
  const parity = runNode("scripts/validate-wrangler.ts");
  if (parity.ok) {
    log("wrangler.toml env binding parity", "ok");
  } else {
    log("wrangler.toml env binding parity", "fail");
    problems.push(parity.stdout + parity.stderr);
  }

  // 2. bundle size
  const bundle = runNode("scripts/check-bundle-size.ts");
  if (bundle.ok) {
    log("bundle size within budget", "ok");
  } else {
    log("bundle size within budget", "fail");
    problems.push(bundle.stdout + bundle.stderr);
  }

  // 3. required secrets set on target env
  if (env !== "dev") {
    const secrets = listSecrets(env);
    if (!secrets.ok) {
      log(`wrangler secret list --env ${env}`, "fail", secrets.error);
      problems.push(secrets.error ?? "");
    } else {
      const present = new Set(secrets.names);
      const missing = REQUIRED_SECRETS[env].filter((n) => !present.has(n));
      if (missing.length === 0) {
        log(
          `required secrets present on env=${env}`,
          "ok",
          `[${REQUIRED_SECRETS[env].join(", ")}]`,
        );
      } else {
        log(
          `required secrets present on env=${env}`,
          "fail",
          `missing: ${missing.join(", ")}`,
        );
        problems.push(`missing secrets on env=${env}: ${missing.join(", ")}`);
      }
      const optionalMissing = OPTIONAL_SECRETS.filter((n) => !present.has(n));
      if (optionalMissing.length > 0) {
        log(
          "optional secrets",
          "info",
          `not set: ${optionalMissing.join(", ")}`,
        );
      }
    }
  }

  // 4. schema head resolvable
  const head = runNode("scripts/get-schema-head.ts");
  if (head.ok && head.stdout.trim().length > 0) {
    log("schema head resolvable", "ok", head.stdout.trim());
  } else {
    log("schema head resolvable", "fail");
    problems.push(head.stderr || "get-schema-head failed");
  }

  if (problems.length > 0) {
    console.error("\ndeploy-preflight: FAILED\n");
    for (const p of problems) {
      if (p.trim().length > 0) console.error(p);
    }
    console.error("\nFix the above and re-run. Nothing was deployed.\n");
    process.exit(1);
  }

  console.log("\ndeploy-preflight: OK — safe to proceed.\n");
  process.exit(0);
}

main();
