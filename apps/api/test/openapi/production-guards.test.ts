import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * vitest-pool-workers binds a single `env` per test run (from
 * `.dev.vars`/`wrangler.toml`, i.e. `APP_ENV=development` locally and in
 * CI's unit/integration job) — there is no supported per-test override of
 * Worker bindings mid-suite. So this file asserts the dev-side behavior
 * here; the production-side 404s (the actual security-relevant guard) are
 * exercised against a prod-configured deployment in Phase 11's Bruno E2E
 * collection, per plan.md Phase 4 Risk Assessment ("Swagger UI +
 * `/openapi.json` in prod").
 */
describe("openapi/docs production guards", () => {
  it("env under test is development (guards its own assumption)", () => {
    expect(env.APP_ENV).toBe("development");
  });

  it("GET /openapi.json returns a valid OpenAPI 3.1 document outside production", async () => {
    const response = await SELF.fetch("https://example.com/openapi.json");

    expect(response.status).toBe(200);
    const body = await response.json<{ openapi?: string; info?: { title?: string } }>();
    expect(body.openapi).toBe("3.1.0");
    expect(body.info?.title).toBe("Runway API");
  });

  it("GET /docs returns Swagger UI HTML outside production", async () => {
    const response = await SELF.fetch("https://example.com/docs");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});

/**
 * Production-side 404 assertions. vitest-pool-workers binds a single env
 * per test run (this file's env is `APP_ENV=development` per wrangler.toml
 * top-level `[vars]`), so we can't flip `APP_ENV` inside a suite here.
 *
 * The prod-404 guard is verified by Phase 11's Bruno E2E collection under
 * a prod-configured deployment (`APP_ENV=production` via env-specific
 * wrangler vars). This `describe.skip` is a grep-anchor so a future
 * engineer removing the E2E coverage will still find this scaffold and
 * remember to re-enable the check somewhere.
 */
describe.skip("openapi/docs production guards — prod-side (Phase 11 E2E owns this)", () => {
  it("GET /openapi.json returns 404 problem+json in production", () => {
    // Asserted in docs/bruno/collection/production/openapi-404.bru
  });
  it("GET /docs returns 404 problem+json in production", () => {
    // Asserted in docs/bruno/collection/production/docs-404.bru
  });
});
