#!/usr/bin/env tsx
/**
 * Exports the OpenAPI 3.1 document generated from the Zod route
 * declarations to `packages/contracts/dist/openapi.json`. Run via
 * `pnpm openapi:export` (local dev convenience — see apps/api build script)
 * and by `scripts/openapi-diff.ts` in CI (Phase 4, Red Team F13: the spec is
 * NOT committed to the repo; `.gitignore` excludes `packages/contracts/dist/`).
 *
 * Approach A (this script): import `createApp` + `mountRoutes` directly —
 * both are pure Zod/Hono schema declarations with no runtime dependency on
 * D1/KV/Queue bindings (those only appear as TypeScript types, erased at
 * build time). `createApp(env)` takes an `env` argument only to keep the
 * factory signature stable for future phases; nothing in the current
 * implementation reads through it at construction time, so a minimal stub
 * object is sufficient here. If this ever breaks (a future phase makes
 * construction genuinely env-dependent, e.g. conditionally registering
 * routes), this script will throw at import/build time — see Approach B
 * (hit a running `wrangler dev` instance's `/openapi.json`) in phase-04.md.
 *
 * Output path is configurable via CLI arg for openapi-diff.ts's dual-ref
 * comparison; defaults to `packages/contracts/dist/openapi.json`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve paths relative to THIS script's location (repo-root/scripts/),
// not `process.cwd()` — turbo and pnpm workspace scripts can invoke this
// with cwd set to a package dir (e.g. apps/api), which would otherwise
// write the spec to the wrong place.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const outArg = process.argv[2];
const OUT_PATH = outArg
  ? resolve(process.cwd(), outArg)
  : resolve(REPO_ROOT, "packages/contracts/dist/openapi.json");

// Minimal stub satisfying the `Bindings` shape at the type level only.
// `createApp` does not read any of these fields at runtime (see comment
// above) — this cast exists purely to satisfy TypeScript, not because the
// script provides working D1/KV bindings.
const stubEnv = {
  APP_ENV: "development",
  APP_ORIGIN: "http://localhost:8787",
  BUILD_SHA: "openapi-export",
  JWT_SECRET: "0".repeat(32),
  TOKEN_PEPPER: "0".repeat(32),
  READYZ_TOKEN: "0".repeat(16),
  EMAIL_PROVIDER: "noop",
  PASSWORD_MIN_LENGTH: 12,
  RATE_LIMIT_AUTH_LOGIN: 5,
  RATE_LIMIT_AUTH_SIGNUP: 3,
} as unknown as import("../apps/api/src/env").Bindings;

async function main(): Promise<void> {
  try {
    const { createApp } = await import("../apps/api/src/openapi");
    const { mountRoutes } = await import("../apps/api/src/routes");

    const app = createApp(stubEnv);
    mountRoutes(app);

    // `createApp` already registers the `/openapi.json` route via
    // `app.doc31(...)` (see apps/api/src/openapi.ts). Dispatching an
    // in-process request through Hono's own router — rather than calling a
    // document-generation method directly — guarantees this script emits
    // byte-identical output to what a running Worker would serve, with no
    // dependency on a specific `@hono/zod-openapi` internal method name.
    const res = await app.request("/openapi.json");
    if (!res.ok) {
      throw new Error(`GET /openapi.json returned ${res.status}`);
    }
    const document: unknown = await res.json();

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    console.log(`export-openapi: wrote ${OUT_PATH}`);
  } catch (err) {
    // Approach A failure fallback (phase-04.md Task 4.4): write a TODO
    // placeholder instead of a valid spec so downstream tooling (oasdiff)
    // fails loudly rather than silently comparing against stale/missing
    // output, and so the orchestrator has a clear signal to diagnose.
    console.error("export-openapi: Approach A (direct import) failed:", err);
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(
      OUT_PATH,
      `${JSON.stringify(
        {
          TODO: "export-openapi Approach A failed at runtime — see stderr from scripts/export-openapi.ts. Diagnose the import chain (apps/api/src/openapi.ts, apps/api/src/routes/index.ts) for a Workers-only runtime dependency (e.g. hono/adapter) and either fix it or switch to Approach B (wrangler dev + fetch /openapi.json).",
          error: err instanceof Error ? err.message : String(err),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    process.exitCode = 1;
  }
}

main();
