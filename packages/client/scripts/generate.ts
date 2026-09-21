#!/usr/bin/env tsx
/**
 * Regenerate `packages/client/src/generated/types.ts` from the
 * exported OpenAPI spec at `packages/contracts/dist/openapi.json`.
 *
 * Pipeline:
 *   1. Ensure `packages/contracts/dist/openapi.json` exists. If not,
 *      run `pnpm openapi:export` first (which lives at the workspace
 *      root and depends on the API build).
 *   2. Invoke `openapi-typescript` programmatically over the spec.
 *   3. Write the resulting TypeScript to `src/generated/types.ts`
 *      with an AUTO-GENERATED banner.
 *
 * Idempotent: re-running with an unchanged spec produces byte-identical
 * output (openapi-typescript is deterministic). CI drift-check
 * (`pnpm --filter @runway/client check`) exploits this to catch
 * "spec changed but client not regenerated" mistakes.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SPEC_PATH = path.join(REPO_ROOT, "packages/contracts/dist/openapi.json");
const OUT_DIR = path.join(__dirname, "..", "src", "generated");
const OUT_FILE = path.join(OUT_DIR, "types.ts");

const BANNER = `/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Regenerate with: pnpm --filter @runway/client generate
 * Source spec:     packages/contracts/dist/openapi.json
 *
 * CI runs \`pnpm --filter @runway/client check\` which diffs this
 * file against a fresh regeneration and fails on drift, so keep the
 * committed copy in sync with every OpenAPI-visible change.
 */
/* eslint-disable */
`;

async function ensureSpec(): Promise<void> {
  if (existsSync(SPEC_PATH)) return;
  console.log("client:generate: openapi.json missing, running pnpm openapi:export…");
  const res = spawnSync("pnpm", ["openapi:export"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (res.status !== 0) {
    throw new Error(`openapi:export failed with exit ${res.status ?? "?"}`);
  }
  if (!existsSync(SPEC_PATH)) {
    throw new Error(`openapi:export ran but ${SPEC_PATH} still missing`);
  }
}

async function main(): Promise<void> {
  await ensureSpec();

  const specUrl = new URL(`file://${SPEC_PATH}`);
  const ast = await openapiTS(specUrl, {
    // Emit `unknown` instead of `any` for permissive shapes — tighter
    // TS narrowing at the call site.
    defaultNonNullable: true,
  });
  const body = astToString(ast);

  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }
  writeFileSync(OUT_FILE, `${BANNER}\n${body}`, "utf8");
  console.log(`client:generate: wrote ${OUT_FILE} (${body.length} bytes)`);
}

main().catch((err: unknown) => {
  console.error("client:generate: FAILED");
  console.error(err);
  process.exit(1);
});
