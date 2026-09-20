import { scryptAsync } from "@noble/hashes/scrypt";
import { timingSafeEqual } from "./compare";

export interface PasswordHashParams {
  N: number;
  r: number;
  p: number;
}

/** OWASP 2024 recommended scrypt parameters for interactive login. */
export const OWASP_2024_PARAMS: PasswordHashParams = { N: 2 ** 17, r: 8, p: 1 };

const SALT_BYTES = 16;
const DK_LEN = 64;
const HASH_PREFIX = "scrypt";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Hashes a password with scrypt. Format:
 * `scrypt$N$r$p$salt_b64$hash_b64`
 */
export async function hashPassword(
  password: string,
  params: PasswordHashParams = OWASP_2024_PARAMS,
): Promise<string> {
  const { N, r, p } = params;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await scryptAsync(password, salt, { N, r, p, dkLen: DK_LEN });

  return `${HASH_PREFIX}$${N}$${r}$${p}$${toBase64(salt)}$${toBase64(derived)}`;
}

/**
 * Parses an encoded scrypt hash string and returns its parameters.
 * Throws on malformed input (not `scrypt$...` shape). Used by
 * `verifyPassword` internally, and exposed so callers (e.g. the auth
 * service) can detect a hash encoded under weaker-than-current-policy
 * parameters and force a rehash on next successful login.
 */
interface SplitHash {
  N: string;
  r: string;
  p: string;
  saltB64: string;
  hashB64: string;
}

function splitHash(encoded: string): SplitHash {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    throw new Error("Malformed scrypt hash string");
  }

  const [, N, r, p, saltB64, hashB64] = parts;
  if (!N || !r || !p || !saltB64 || !hashB64) {
    throw new Error("Malformed scrypt hash string");
  }

  return { N, r, p, saltB64, hashB64 };
}

export function parseHashParams(encoded: string): PasswordHashParams {
  const { N: nStr, r: rStr, p: pStr } = splitHash(encoded);
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);

  if (!Number.isInteger(N) || N <= 0 || !Number.isInteger(r) || r <= 0 || !Number.isInteger(p) || p <= 0) {
    throw new Error("Malformed scrypt hash parameters");
  }

  return { N, r, p };
}

interface ParsedHash extends PasswordHashParams {
  salt: Uint8Array;
  hash: Uint8Array;
}

function parseHash(encoded: string): ParsedHash {
  const params = parseHashParams(encoded); // throws on malformed input
  const { saltB64, hashB64 } = splitHash(encoded);

  return {
    ...params,
    salt: fromBase64(saltB64),
    hash: fromBase64(hashB64),
  };
}

/**
 * Verifies a password against an encoded scrypt hash. Throws on malformed
 * `encoded` input. Returns `false` for a wrong password, `true` for a match.
 *
 * Does NOT reject hashes encoded under weaker-than-current-policy params —
 * that would lock out legitimate users whose accounts were hashed under an
 * older policy. Use `parseHashParams` to detect and flag downgrade for a
 * forced rehash instead.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const { N, r, p, salt, hash } = parseHash(encoded);
  const derived = await scryptAsync(password, salt, { N, r, p, dkLen: hash.length });
  return timingSafeEqual(derived, hash);
}
