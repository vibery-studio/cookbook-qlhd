/**
 * Verifies the `Origin` header equals the allowed origin exactly
 * (case-sensitive, scheme+host+port). Returns `false` on missing,
 * malformed, or mismatched input — never throws, so callers can use it
 * directly as a gate.
 *
 * Compares raw strings rather than routing both sides through the WHATWG
 * URL parser: `new URL()` silently drops a default port (e.g.
 * `https://host:443` normalizes to `https://host`), which would make an
 * explicit-port header equal an implicit-port allowlist entry. `Origin`
 * headers sent by browsers never include a path/query, so exact string
 * equality is the correct (and simplest) comparison here.
 */
export function verifyOrigin(originHeader: string | null | undefined, allowedOrigin: string): boolean {
  if (!originHeader) {
    return false;
  }

  // Validate shape (throws on malformed input) without using the parsed
  // result for comparison, to avoid the default-port normalization trap.
  try {
    void new URL(originHeader);
  } catch {
    return false;
  }

  return originHeader === allowedOrigin;
}

/**
 * Parses a URL and returns its origin as `${protocol}//${host}` — no
 * trailing slash, no path, no query string.
 */
export function normalizeOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}
