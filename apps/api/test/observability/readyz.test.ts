import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const READYZ_TOKEN = "test-readyz-token-min-16";

describe("readyz endpoint", () => {
  it("returns 401 problem+json without X-Readyz-Token", async () => {
    const res = await SELF.fetch("https://example.com/readyz");
    expect(res.status).toBe(401);
    const body: { title: string; type: string } = await res.json();
    expect(body.title).toContain("readyz");
    expect(body.type).toContain("/unauthorized");
  });

  it("returns 401 with wrong token", async () => {
    const res = await SELF.fetch("https://example.com/readyz", {
      headers: { "x-readyz-token": "wrong-token-xxxxxxx" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with checks map when token matches", async () => {
    const res = await SELF.fetch("https://example.com/readyz", {
      headers: { "x-readyz-token": READYZ_TOKEN },
    });
    expect(res.status).toBe(200);
    const body: {
      ok: boolean;
      build_sha: string;
      checks: { db: string; kv: string };
      duration_ms: number;
    } = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checks.db).toBe("ok");
    expect(body.checks.kv).toBe("ok");
    expect(typeof body.duration_ms).toBe("number");
    expect(typeof body.build_sha).toBe("string");
  });
});
