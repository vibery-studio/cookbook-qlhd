import { SignJWT, jwtVerify } from "jose";

export interface AccessTokenClaims {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface JwtSignOpts {
  secret: string;
  ttlSeconds: number;
  sub: string;
  jti: string;
  now?: number;
}

const ALG = "HS256";

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Signs an HS256 access token JWT. */
export async function signAccessToken(opts: JwtSignOpts): Promise<string> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const exp = now + opts.ttlSeconds;

  return new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(opts.sub)
    .setJti(opts.jti)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(encodeSecret(opts.secret));
}

/**
 * Verifies an HS256 access token JWT. Throws on invalid signature, expiry,
 * or algorithm mismatch (defends against alg-confusion / alg=none forgery).
 * Does NOT check `jti` revocation — that requires D1 access and is the
 * auth middleware's responsibility.
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
  now?: number,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, encodeSecret(secret), {
    algorithms: [ALG],
    currentDate: now !== undefined ? new Date(now * 1000) : undefined,
  });

  const { sub, jti, iat, exp } = payload;
  if (typeof sub !== "string" || typeof jti !== "string" || typeof iat !== "number" || typeof exp !== "number") {
    throw new Error("Malformed access token claims");
  }

  return { sub, jti, iat, exp };
}
