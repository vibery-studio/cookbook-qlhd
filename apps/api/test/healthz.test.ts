import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /healthz", () => {
  it("returns 200 with { ok: true, build_sha }", async () => {
    const response = await SELF.fetch("https://example.com/healthz");

    expect(response.status).toBe(200);
    const body: { ok: boolean; build_sha: string } = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.build_sha).toBe("string");
  });
});
