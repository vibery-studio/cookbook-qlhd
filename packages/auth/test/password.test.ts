import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, parseHashParams, OWASP_2024_PARAMS } from "../src/password";

describe("password", () => {
  it("roundtrips: hash then verify with correct password", async () => {
    const hash = await hashPassword("s3cret-p4ssw0rd-abc");
    await expect(verifyPassword("s3cret-p4ssw0rd-abc", hash)).resolves.toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("s3cret-p4ssw0rd-abc");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("encodes hash string with OWASP 2024 params", async () => {
    const hash = await hashPassword("s3cret-p4ssw0rd-abc");
    const params = parseHashParams(hash);
    expect(params).toEqual(OWASP_2024_PARAMS);
  });

  it("detects downgraded (weak) params via parseHashParams without rejecting verify", async () => {
    // Hand-craft a hash string with weak params (N=2^10) as if hashed under
    // an older, weaker policy.
    const weakHash = await hashPassword("s3cret-p4ssw0rd-abc", { N: 2 ** 10, r: 8, p: 1 });
    const params = parseHashParams(weakHash);

    expect(params.N).toBe(2 ** 10);
    expect(params.N).toBeLessThan(OWASP_2024_PARAMS.N);

    // verifyPassword must NOT reject weak-but-valid hashes — that would
    // lock out legitimate users. A caller compares params against current
    // policy to decide whether to force a rehash.
    await expect(verifyPassword("s3cret-p4ssw0rd-abc", weakHash)).resolves.toBe(true);
  });

  it("throws on malformed encoded hash", async () => {
    expect(() => parseHashParams("not-a-scrypt-hash")).toThrow();
    expect(() => parseHashParams("scrypt$abc$8$1$salt$hash")).toThrow();
    expect(() => parseHashParams("scrypt$131072$8$1$onlysalt")).toThrow();
    await expect(verifyPassword("anything", "garbage")).rejects.toThrow();
  });

  it("takes meaningfully long to hash (scrypt is expensive, not free)", async () => {
    const start = performance.now();
    await hashPassword("s3cret-p4ssw0rd-abc");
    const elapsed = performance.now() - start;
    // Loose bound for CI variance; the point is scrypt N=2^17 is actually
    // expensive, not a specific target latency.
    expect(elapsed).toBeGreaterThan(50);
  });
});
