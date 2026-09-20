import { describe, expect, it } from "vitest";
import { verifyOrigin, normalizeOrigin } from "../src/origin";

describe("verifyOrigin", () => {
  it("returns true for exact matching origins", () => {
    expect(verifyOrigin("https://runway.dev", "https://runway.dev")).toBe(true);
  });

  it("returns false for an explicit default port vs implicit (case-sensitive-ish exactness)", () => {
    expect(verifyOrigin("https://runway.dev:443", "https://runway.dev")).toBe(false);
  });

  it("returns false for scheme mismatch (http vs https)", () => {
    expect(verifyOrigin("http://runway.dev", "https://runway.dev")).toBe(false);
  });

  it("returns false for null header", () => {
    expect(verifyOrigin(null, "https://runway.dev")).toBe(false);
  });

  it("returns false for undefined header", () => {
    expect(verifyOrigin(undefined, "https://runway.dev")).toBe(false);
  });

  it("returns false for malformed header", () => {
    expect(verifyOrigin("not-a-url", "https://runway.dev")).toBe(false);
  });

  it("is case-sensitive on host", () => {
    expect(verifyOrigin("https://Runway.dev", "https://runway.dev")).toBe(false);
  });
});

describe("normalizeOrigin", () => {
  it("strips path and query", () => {
    expect(normalizeOrigin("https://runway.dev/path?q=1")).toBe("https://runway.dev");
  });

  it("preserves a non-default port", () => {
    expect(normalizeOrigin("http://localhost:8787/foo")).toBe("http://localhost:8787");
  });
});
