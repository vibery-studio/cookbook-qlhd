#!/usr/bin/env tsx
/**
 * CI drift-check. Regenerates `src/generated/types.ts` into a temp
 * location, compares it byte-for-byte against the committed copy, and
 * exits non-zero when they differ.
 *
 * Local usage:
 *   pnpm --filter @runway/client check
 *
 * If this fails locally: run `pnpm --filter @runway/client generate`
 * and commit the result. If it fails in CI: the spec changed without
 * regenerating the client — regenerate + commit before merging.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SPEC_PATH = path.join(REPO_ROOT, "packages/contracts/dist/openapi.json");
const OUT_FILE = path.join(__dirname, "..", "src", "generated", "types.ts");

async function main(): Promise<void> {
  if (!existsSync(SPEC_PATH)) {
    console.error(`client:check: ${SPEC_PATH} missing — run 'pnpm openapi:export' first`);
    process.exit(2);
  }
  if (!existsSync(OUT_FILE)) {
    console.error(
      `client:check: ${OUT_FILE} missing — run 'pnpm --filter @runway/client generate' and commit`,
    );
    process.exit(2);
  }

  const specUrl = new URL(`file://${SPEC_PATH}`);
  const ast = await openapiTS(specUrl, { defaultNonNullable: true });
  const freshBody = astToString(ast);
  const committed = readFileSync(OUT_FILE, "utf8");

  // Trim the auto-generated banner from the committed file; compare
  // only the meaningful body so a banner-only edit doesn't fail check.
  const committedBody = committed.split("/* eslint-disable */\n").pop() ?? committed;
  if (committedBody.trim() === freshBody.trim()) {
    console.log("client:check: generated client is up-to-date with the spec.");
    return;
  }

  console.error("client:check: DRIFT DETECTED");
  console.error("The committed src/generated/types.ts does NOT match a fresh regeneration.");
  console.error("");
  console.error("Fix: pnpm --filter @runway/client generate && git add packages/client/src/generated");
  console.error("");
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error("client:check: FAILED");
  console.error(err);
  process.exit(1);
});
