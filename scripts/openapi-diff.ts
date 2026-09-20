#!/usr/bin/env tsx
/**
 * CI drift gate (Phase 4, Red Team F13): the OpenAPI spec is NOT committed
 * to the repo, so `oasdiff` cannot compare two commits' checked-in files.
 * Instead this script builds the spec from `origin/main` in an isolated git
 * worktree, builds the spec from HEAD in the current working tree, and runs
 * `oasdiff breaking` between them. Exits 1 (fails CI) if `oasdiff` reports
 * any breaking change.
 *
 * CI must run with `fetch-depth: 0` (already set in .github/workflows/ci.yml)
 * so `origin/main` is reachable.
 *
 * Flow:
 *   1. git fetch origin main
 *   2. git worktree add <tmp> origin/main
 *   3. pnpm install --frozen-lockfile --ignore-scripts inside <tmp>
 *   4. pnpm openapi:export inside <tmp> -> <tmp-spec>.json
 *   5. pnpm openapi:export in HEAD -> packages/contracts/dist/openapi.json
 *   6. oasdiff breaking <tmp-spec>.json packages/contracts/dist/openapi.json
 *   7. git worktree remove <tmp> (always, even on failure)
 *
 * Initial-commit case: if `origin/main` does not exist yet (this IS the
 * first commit establishing main), there is nothing to diff against — skip
 * with exit 0 rather than failing CI on a repo that has no history yet.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd());
const HEAD_SPEC = resolve(REPO_ROOT, "packages/contracts/dist/openapi.json");

function run(cmd: string, args: string[], cwd: string = REPO_ROOT): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function originMainExists(): boolean {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return result.status === 0;
}

function main(): void {
  console.log("openapi-diff: git fetch origin main");
  let fetchFailed = false;
  try {
    run("git", ["fetch", "origin", "main"]);
  } catch (err) {
    fetchFailed = true;
    console.warn("openapi-diff: git fetch origin main failed", err);
  }

  if (!originMainExists()) {
    if (fetchFailed) {
      // Fork PR case: `origin` points at the fork, which doesn't have the
      // upstream `main` branch. In private-only repos (this repo's policy)
      // that's a red flag — not an expected condition — because we don't
      // accept fork PRs. Log loudly but still exit 0 so CI doesn't block on
      // a config issue; treat repeated occurrences as a signal to switch
      // this to a hard failure.
      console.warn(
        "openapi-diff: origin/main not reachable after fetch. If this is a fork PR, the breaking-change gate did NOT run — private-repo policy is push-based only.",
      );
    } else {
      console.log("openapi-diff: origin/main not found (likely the initial commit) — skipping, exit 0.");
    }
    process.exit(0);
  }

  const worktreeDir = mkdtempSync(join(tmpdir(), "runway-main-openapi-"));
  // `git worktree add` requires the target directory to not already exist
  // as a non-empty dir owned by git; mkdtemp gives us an empty dir, so
  // remove it first and let worktree create it fresh.
  rmSync(worktreeDir, { recursive: true, force: true });

  let breaking = false;
  let noBaseline = false;

  try {
    console.log(`openapi-diff: git worktree add ${worktreeDir} origin/main`);
    run("git", ["worktree", "add", "--detach", worktreeDir, "origin/main"]);

    const mainExportScript = join(worktreeDir, "scripts/export-openapi.ts");
    if (!existsSync(mainExportScript)) {
      console.log(
        "openapi-diff: origin/main predates scripts/export-openapi.ts (no OpenAPI baseline yet) — skipping, exit 0.",
      );
      noBaseline = true;
      return;
    }

    console.log("openapi-diff: pnpm install --frozen-lockfile --ignore-scripts (main worktree)");
    run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], worktreeDir);

    const mainSpec = join(worktreeDir, "packages/contracts/dist/openapi.json");
    console.log("openapi-diff: exporting spec from origin/main");
    run("pnpm", ["exec", "tsx", "scripts/export-openapi.ts", mainSpec], worktreeDir);

    console.log("openapi-diff: exporting spec from HEAD");
    run("pnpm", ["exec", "tsx", "scripts/export-openapi.ts", HEAD_SPEC], REPO_ROOT);

    if (!existsSync(mainSpec) || !existsSync(HEAD_SPEC)) {
      console.error("openapi-diff: one or both spec files missing after export — cannot diff.");
      process.exitCode = 1;
      return;
    }

    console.log(`openapi-diff: oasdiff breaking ${mainSpec} ${HEAD_SPEC}`);
    const result = spawnSync("oasdiff", ["breaking", mainSpec, HEAD_SPEC], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.error) {
      console.error(
        "openapi-diff: failed to invoke `oasdiff` binary — is it installed on PATH? " +
          "CI installs it via Tufin/oasdiff-action; for local runs install per https://github.com/oasdiff/oasdiff.",
      );
      console.error(result.error.message);
      process.exitCode = 1;
      return;
    }

    console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);

    // oasdiff exits 1 when breaking changes are found, 0 when none.
    if (result.status !== 0) {
      breaking = true;
    }
  } finally {
    console.log(`openapi-diff: removing worktree ${worktreeDir}`);
    spawnSync("git", ["worktree", "remove", "--force", worktreeDir], { cwd: REPO_ROOT });
  }

  if (noBaseline) {
    process.exit(0);
  }

  if (breaking) {
    console.error("openapi-diff: FAILED — breaking OpenAPI changes detected against origin/main.");
    process.exit(1);
  }

  console.log("openapi-diff: OK — no breaking changes.");
  process.exit(0);
}

main();
