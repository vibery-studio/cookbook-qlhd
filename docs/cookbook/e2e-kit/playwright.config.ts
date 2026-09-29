/**
 * E2E acceptance for ROADMAP-01 row 4 (PLAN-04): the real UI against a
 * real Worker + local D1. Isolated from the developer's `pnpm dev` data:
 * own persist dir (`apps/api/.wrangler/e2e`) and port 8791 (8788 is used by another local project).
 * Run: `pnpm --filter @runway/web e2e` (needs apps/api/.dev.vars).
 */
import { defineConfig, devices } from "@playwright/test";

export const E2E_PORT = 8791;
export const BASE = `http://localhost:${E2E_PORT}`;
const API = "../api";
const PERSIST = ".wrangler/e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Fail fast: a red run (UI not built yet) must not wait 60 s per missing element (measured: 140 s red runs vs 29 s green).
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: false }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    cwd: API,
    command:
      `rm -rf ${PERSIST} && pnpm exec wrangler d1 migrations apply runway_dev --local --persist-to ${PERSIST} >/dev/null && ` +
      `pnpm exec wrangler dev --persist-to ${PERSIST} --port ${E2E_PORT} --var APP_ORIGIN:${BASE}`,
    url: `${BASE}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
