import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "../src/jwt";

const SECRET = "test-jwt-secret-at-least-32-bytes-long";

function base64url(input: object | string): string {
  const json = typeof input === "string" ? input : JSON.stringify(input);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("jwt", () => {
  it("signs then verifies, recovering matching claims", async () => {
    const now = 1_700_000_000;
    const token = await signAccessToken({ secret: SECRET, ttlSeconds: 120, sub: "user_01", jti: "jti_01", now });
    const claims = await verifyAccessToken(token, SECRET, now);

    expect(claims.sub).toBe("user_01");
    expect(claims.jti).toBe("jti_01");
    expect(claims.iat).toBe(now);
    expect(claims.exp).toBe(now + 120);
  });

  it("throws when verified with the wrong secret", async () => {
    const token = await signAccessToken({ secret: SECRET, ttlSeconds: 120, sub: "user_01", jti: "jti_01" });
    await expect(verifyAccessToken(token, "a-completely-different-secret-value")).rejects.toThrow();
  });

  it("throws when expired (negative ttl)", async () => {
    const token = await signAccessToken({ secret: SECRET, ttlSeconds: -1, sub: "user_01", jti: "jti_01" });
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
  });

  it("throws when verified 200s after a 120s ttl token was issued", async () => {
    const now = 1_700_000_000;
    const token = await signAccessToken({ secret: SECRET, ttlSeconds: 120, sub: "user_01", jti: "jti_01", now });
    await expect(verifyAccessToken(token, SECRET, now + 200)).rejects.toThrow();
  });

  it("rejects an alg=none forged token (HS256 enforcement)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url({ alg: "none", typ: "JWT" });
    const payload = base64url({ sub: "user_01", jti: "jti_01", iat: now, exp: now + 120 });
    const forged = `${header}.${payload}.`;

    await expect(verifyAccessToken(forged, SECRET)).rejects.toThrow();
  });

  it("decodes sub, jti, iat, exp on verify", async () => {
    const token = await signAccessToken({ secret: SECRET, ttlSeconds: 120, sub: "user_42", jti: "jti_42" });
    const claims = await verifyAccessToken(token, SECRET);

    expect(claims).toHaveProperty("sub", "user_42");
    expect(claims).toHaveProperty("jti", "jti_42");
    expect(typeof claims.iat).toBe("number");
    expect(typeof claims.exp).toBe("number");
  });
});
