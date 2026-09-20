import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ProblemDto } from "../../src/dto/error";

/**
 * Route stubs remaining after Phase 9: `GET /demo/notes` still 501
 * (list pagination lands with the Phase 11 golden-path recipe).
 * `POST /demo/notes` is now real; its unauthenticated path returns
 * 401 via `requireAuth`, and full coverage lives in the demo /
 * idempotency integration suite.
 */
describe("route stubs return 501 not-implemented", () => {
  it("GET /demo/notes -> 501 problem+json", async () => {
    const response = await SELF.fetch("https://example.com/demo/notes");

    expect(response.status).toBe(501);
    const body = ProblemDto.parse(await response.json());
    expect(body.type).toMatch(/\/not-implemented$/);
    expect(body.status).toBe(501);
  });
});
