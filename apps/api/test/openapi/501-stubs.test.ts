import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ProblemDto } from "../../src/dto/error";

/**
 * Route stubs remaining after Phase 5: /admin/* and /demo/* still return
 * 501 until their owning phases (RBAC = Phase 6, demo module = Phase 8)
 * land. /auth/* and /me are now real handlers — their coverage lives in
 * the auth integration suite.
 */
describe("route stubs return 501 not-implemented", () => {
  it("GET /admin/users -> 501 problem+json", async () => {
    const response = await SELF.fetch("https://example.com/admin/users");

    expect(response.status).toBe(501);
    const body = ProblemDto.parse(await response.json());
    expect(body.type).toMatch(/\/not-implemented$/);
    expect(body.status).toBe(501);
  });

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
