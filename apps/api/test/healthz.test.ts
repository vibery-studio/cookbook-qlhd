import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /healthz", () => {
  it("returns 200 with { ok: true }", async () => {
    const response = await SELF.fetch("https://example.com/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
