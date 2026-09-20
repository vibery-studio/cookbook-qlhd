/**
 * ULID generator (https://github.com/ulid/spec), hand-rolled against
 * WebCrypto (`crypto.getRandomValues`) instead of the `ulid` npm package.
 * The package's browser build remaps Node's `crypto` module via a
 * `package.json#browser` field stub, which bundler resolution in Workers
 * tooling is not guaranteed to honor consistently — hand-rolling removes
 * that resolution risk from a utility used on every write path (Phase 3
 * Risk Assessment: "ULID on Workers").
 *
 * Format: 26-char Crockford base32 string — 48-bit timestamp (ms, 10 chars)
 * followed by 80 bits of randomness (16 chars). Monotonic within the same
 * millisecond: if the timestamp is unchanged since the last call, the
 * random part is incremented instead of re-randomized, guaranteeing
 * lexicographic ordering for IDs generated in the same tick.
 */

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = CROCKFORD_ALPHABET.length; // 32
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = -1;
// 80 bits of randomness, stored as 16 base32 digit values (0-31 each).
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let mutableTime = time;
  const chars = new Array<string>(TIME_LEN);
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = mutableTime % ENCODING_LEN;
    chars[i] = CROCKFORD_ALPHABET[mod]!;
    mutableTime = (mutableTime - mod) / ENCODING_LEN;
  }
  return chars.join("");
}

function randomDigits(): number[] {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  // Each base32 digit needs 5 bits; take the low 5 bits of each random byte.
  // This slightly biases distribution but is irrelevant for ID uniqueness.
  return Array.from(bytes, (b) => b % ENCODING_LEN);
}

function encodeRandom(digits: number[]): string {
  return digits.map((d) => CROCKFORD_ALPHABET[d]).join("");
}

/**
 * Increment the last-used random digits by 1, propagating carry leftward,
 * for monotonic ordering within the same millisecond. Throws if all digits
 * overflow (i.e. >32^16 IDs generated in a single millisecond — practically
 * unreachable).
 */
function incrementRandom(digits: number[]): number[] {
  const next = digits.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    const current = next[i] ?? 0;
    if (current < ENCODING_LEN - 1) {
      next[i] = current + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error("generateUlid: random component overflow within the same millisecond");
}

/**
 * Generates a 26-char Crockford base32 ULID. Monotonic: calls within the
 * same millisecond produce strictly increasing IDs.
 */
export function generateUlid(): string {
  const now = Date.now();

  if (now === lastTime) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomDigits();
  }

  return encodeTime(now) + encodeRandom(lastRandom);
}
