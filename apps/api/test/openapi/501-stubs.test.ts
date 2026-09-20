import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ProblemDto } from "../../src/dto/error";

/**
 * Route stubs remaining after Phase 6: /demo/* still returns 501 until
 * Phase 8 (demo module) lands. /admin/users is now a real RBAC-gated
 * handler; unauthenticated calls return 401 via `requireAuth`, and
 * missing-permission (member cookie without users:read) returns 403 via
 * `requirePerm`. Auth+RBAC coverage lives in the rbac integration suite.
 */
describe("route stubs return 501 not-implemented", () => {
  it("POST /demo/notes -> 501 problem+json", async () => {
    const response = await SELF.fetch("https://example.com/demo/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:8787",
        "x-requested-with": "fetch",
      },
      body: JSON.stringify({ title: "hello", body: "world" }),
    });

    expect(response.status).toBe(501);
    const body = ProblemDto.parse(await response.json());
    expect(body.type).toMatch(/\/not-implemented$/);
    expect(body.status).toBe(501);
  });
});
