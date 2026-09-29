import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("security headers", () => {
  it("all headers are set on every response, including /healthz", async () => {
    const res = await SELF.fetch("https://example.com/healthz");
    expect(res.status).toBe(200);

    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("security headers set on error responses (404)", async () => {
    const res = await SELF.fetch("https://example.com/no-such-path");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("/docs (dev only) lets Swagger UI load its CDN assets; every other route keeps default-src 'self' only", async () => {
    // FIX-01: the strict API CSP blocked swagger-ui.css/js from cdn.jsdelivr.net → blank /docs page
    const docs = await SELF.fetch("https://example.com/docs");
    expect(docs.status).toBe(200);
    const csp = docs.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/style-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
    expect(csp).toMatch(/script-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
    expect(csp).toContain("frame-ancestors 'none'");

    const api = await SELF.fetch("https://example.com/healthz");
    expect(api.headers.get("content-security-policy")).not.toContain("jsdelivr");
  });
});
