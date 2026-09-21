#!/usr/bin/env tsx
/**
 * Post-deploy verifier. Runs after `wrangler deploy` completes and probes
 * the newly-shipped Worker with a retry loop. Any failure exits non-zero
 * so the caller (scripts/deploy-prod.sh) can trigger a rollback.
 *
 * Checks:
 *   1. GET /healthz              → 200, body.ok === true, body.build_sha === expected
 *   2. GET /readyz + X-Readyz-Token → 200, body.checks.db === "ok", body.checks.kv === "ok"
 *   3. GET /me (no cookie)       → 401 (proves auth middleware is wired)
 *
 * Retry loop: 5s interval, max 60s wall clock (12 attempts) per check.
 * This absorbs the KV-eventual-consistency window on a fresh deploy.
 *
 * Usage:
 *   pnpm deploy:verify -- --url https://runway-api-prod.<subdomain>.workers.dev \
 *                         --sha <git-sha> --token $READYZ_TOKEN
 *   READYZ_TOKEN=... pnpm deploy:verify -- --url ... --sha ...
 */

type Args = { url: string; sha: string; token: string };

const RETRY_MAX_MS = 60_000;
const RETRY_INTERVAL_MS = 5_000;

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let url = "";
  let sha = "";
  let token = process.env.READYZ_TOKEN ?? "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (a === "--url" && v) { url = v; i++; }
    else if (a === "--sha" && v) { sha = v; i++; }
    else if (a === "--token" && v) { token = v; i++; }
  }
  if (!url || !sha) {
    console.error("deploy-verify: --url and --sha are required");
    process.exit(2);
  }
  if (!token) {
    console.error("deploy-verify: --token (or $READYZ_TOKEN) is required");
    process.exit(2);
  }
  return { url: url.replace(/\/$/, ""), sha, token };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type CheckResult = { ok: boolean; detail: string };

async function retry(name: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  const started = Date.now();
  let attempt = 0;
  let last: CheckResult = { ok: false, detail: "no attempt" };
  while (Date.now() - started < RETRY_MAX_MS) {
    attempt++;
    try {
      last = await fn();
    } catch (err) {
      last = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (last.ok) {
      console.log(`  ✓ ${name} (attempt ${attempt}, ${Date.now() - started}ms)`);
      return last;
    }
    if (Date.now() - started + RETRY_INTERVAL_MS >= RETRY_MAX_MS) break;
    console.log(`  … ${name} attempt ${attempt} → ${last.detail}; retry in ${RETRY_INTERVAL_MS / 1000}s`);
    await sleep(RETRY_INTERVAL_MS);
  }
  console.error(`  ✗ ${name} — ${last.detail}`);
  return last;
}

async function checkHealthz(url: string, sha: string): Promise<CheckResult> {
  const r = await fetch(`${url}/healthz`, { headers: { accept: "application/json" } });
  if (r.status !== 200) return { ok: false, detail: `status ${r.status}` };
  const body = (await r.json().catch(() => null)) as { ok?: boolean; build_sha?: string } | null;
  if (!body || body.ok !== true) return { ok: false, detail: `ok=${body?.ok}` };
  if (body.build_sha !== sha) {
    return {
      ok: false,
      detail: `build_sha mismatch: got ${body.build_sha}, expected ${sha}`,
    };
  }
  return { ok: true, detail: `build_sha=${body.build_sha}` };
}

async function checkReadyz(url: string, token: string): Promise<CheckResult> {
  const r = await fetch(`${url}/readyz`, {
    headers: { accept: "application/json", "x-readyz-token": token },
  });
  if (r.status === 401) return { ok: false, detail: "token rejected" };
  const body = (await r.json().catch(() => null)) as
    | { ok?: boolean; checks?: { db?: string; kv?: string }; duration_ms?: number }
    | null;
  if (r.status !== 200) return { ok: false, detail: `status ${r.status}, checks=${JSON.stringify(body?.checks)}` };
  if (!body || body.ok !== true) return { ok: false, detail: `checks=${JSON.stringify(body?.checks)}` };
  if (body.checks?.db !== "ok" || body.checks?.kv !== "ok") {
    return { ok: false, detail: `db=${body.checks?.db} kv=${body.checks?.kv}` };
  }
  return { ok: true, detail: `db=ok kv=ok duration=${body.duration_ms}ms` };
}

async function checkMeUnauth(url: string): Promise<CheckResult> {
  const r = await fetch(`${url}/me`, {
    headers: { accept: "application/json" },
    redirect: "manual",
  });
  if (r.status !== 401) return { ok: false, detail: `status ${r.status} (expected 401)` };
  return { ok: true, detail: "401 as expected" };
}

async function main(): Promise<void> {
  const { url, sha, token } = parseArgs();
  console.log(`\ndeploy-verify: target = ${url}  build_sha = ${sha}\n`);

  const healthz = await retry("healthz + build_sha", () => checkHealthz(url, sha));
  if (!healthz.ok) process.exit(1);

  const readyz = await retry("readyz + db/kv", () => checkReadyz(url, token));
  if (!readyz.ok) process.exit(1);

  const meUnauth = await retry("/me anon → 401", () => checkMeUnauth(url));
  if (!meUnauth.ok) process.exit(1);

  console.log("\ndeploy-verify: OK — post-deploy smoke passed.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("deploy-verify: unexpected error", err);
  process.exit(1);
});
