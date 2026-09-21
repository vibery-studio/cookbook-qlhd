/**
 * Cookie utilities extracted from ~5 duplicated copies in
 * `apps/api/test/integration/*.test.ts`. Same behavior; callers should
 * import `extractCookie` from here going forward.
 */

/**
 * Read a Set-Cookie value from a fetch Response. Returns `null` when the
 * cookie name is absent from the response's Set-Cookie header. Handles
 * multi-cookie responses via a simple linear scan — the miniflare test
 * runner never returns more than a handful of cookies per response, so
 * a scanner beats pulling in a full cookie-parser dependency.
 */
export function extractCookie(response: Response, name: string): string | null {
  const raw = response.headers.get("set-cookie");
  if (raw === null) return null;
  const idx = raw.indexOf(`${name}=`);
  if (idx === -1) return null;
  const start = idx + name.length + 1;
  const endIdx = raw.indexOf(";", start);
  return raw.slice(start, endIdx === -1 ? undefined : endIdx);
}
