import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashToken, tokenEntropyBits } from "../src/tokens";

describe("generateOpaqueToken", () => {
  it("returns a 43-char base64url string for 32 bytes", () => {
    const token = generateOpaqueToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates 1000 distinct tokens", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(generateOpaqueToken());
    }
    expect(tokens.size).toBe(1000);
  });
});

describe("hashToken", () => {
  it("returns a hex string", () => {
    const hash = hashToken("some-raw-token", "pepper-value");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    // HMAC-SHA256 -> 32 bytes -> 64 hex chars
    expect(hash).toHaveLength(64);
  });

  it("is deterministic for the same token and pepper", () => {
    const a = hashToken("some-raw-token", "pepper-value");
    const b = hashToken("some-raw-token", "pepper-value");
    expect(a).toBe(b);
  });

  it("changes when the pepper changes", () => {
    const a = hashToken("some-raw-token", "pepper-value-1");
    const b = hashToken("some-raw-token", "pepper-value-2");
    expect(a).not.toBe(b);
  });

  it("changes when the token changes", () => {
    const a = hashToken("token-a", "pepper-value");
    const b = hashToken("token-b", "pepper-value");
    expect(a).not.toBe(b);
  });
});

describe("tokenEntropyBits", () => {
  it("reports >= 256 bits for a 32-byte token", () => {
    const token = generateOpaqueToken(32);
    expect(tokenEntropyBits(token)).toBeGreaterThanOrEqual(256);
  });
});
