import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ProblemDto } from "../../src/dto/error";

/**
 * Route stubs (auth/me/admin/demo) are owned by a parallel agent working in
 * `src/routes/**`. All four groups already exist as of this test's
 * authoring, each `notImplemented` handler returning 501 Problem+JSON with
 * `type` ending in `/not-implemented`. Request bodies must satisfy each
 * route's Zod schema — otherwise OpenAPIHono's request validator throws a
 * 422 before the handler ever runs, which would make these tests assert the
 * wrong thing.
 */
describe("route stubs return 501 not-implemented", () => {
  it("POST /auth/signup -> 501 problem+json", async () => {
    const response = await SELF.fetch("https://example.com/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", password: "correct-horse-battery" }),
    });

    expect(response.status).toBe(501);
    const body = ProblemDto.parse(await response.json());
    expect(body.type).toMatch(/\/not-implemented$/);
    expect(body.status).toBe(501);
  });

  it("GET /me -> 501 problem+json", async () => {
    const response = await SELF.fetch("https://example.com/me");

    expect(response.status).toBe(501);
    const body = ProblemDto.parse(await response.json());
    expect(body.type).toMatch(/\/not-implemented$/);
    expect(body.status).toBe(501);
  });

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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "hello", body: "world" }),
    });

    expect(response.status).toBe(501);
    const body = ProblemDto.parse(await response.json());
    expect(body.type).toMatch(/\/not-implemented$/);
    expect(body.status).toBe(501);
  });
});
