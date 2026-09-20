/**
 * Constant-time byte comparison. WebCrypto has no `timingSafeEqual` in the
 * Workers runtime, so we hand-roll XOR-accumulate here. Iterates over
 * `max(a.length, b.length)` regardless of where the buffers actually differ,
 * and folds the length difference into the accumulator so mismatched-length
 * inputs take the same code path (and roughly the same time) as an
 * equal-length mismatch — no early return on length check.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let acc = a.length ^ b.length;

  for (let i = 0; i < len; i++) {
    const av = i < a.length ? (a[i] ?? 0) : 0;
    const bv = i < b.length ? (b[i] ?? 0) : 0;
    acc |= av ^ bv;
  }

  return acc === 0;
}

/**
 * String variant: encodes both inputs to UTF-8 bytes then delegates to
 * `timingSafeEqual`.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  return timingSafeEqual(encoder.encode(a), encoder.encode(b));
}
