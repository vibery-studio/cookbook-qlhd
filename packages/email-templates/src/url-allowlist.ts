/**
 * URL allowlist for template rendering. Throws on any URL that isn't
 * plainly `https://…` or same-origin as `appOrigin`. Catches XSS attempts
 * like `javascript:alert(1)`, `data:text/html,...`, and accidental
 * relative paths (which would render as broken links in email clients).
 *
 * Called by `render.ts` for every URL-typed prop BEFORE the template
 * interpolates it into HTML. If the check throws, the render itself
 * is aborted — the sending path never sees a poisoned URL.
 */
export class UnsafeUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`unsafe url refused (${reason}): ${url}`);
    this.name = "UnsafeUrlError";
  }
}

/**
 * `appOrigin` is `env.APP_ORIGIN` (e.g., `https://runway.dev`). URLs
 * matching it exactly (or `https://` from any host) pass; everything
 * else throws. No wildcards, no protocol-relative (`//example.com`).
 *
 * We do NOT trust `URL()` parsing alone for the protocol check — a
 * javascript: URL parses fine. Do a case-insensitive prefix match on
 * the raw string first.
 */
export function sanitizeUrl(rawUrl: string, appOrigin: string): string {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    throw new UnsafeUrlError(String(rawUrl), "empty or non-string");
  }

  const trimmed = rawUrl.trim();
  // Reject any URL whose lowercased prefix isn't `https://`. This blocks
  // `javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative
  // `//example.com`, and plain relative paths (`/verify?token=...`).
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("https://")) {
    throw new UnsafeUrlError(trimmed, "not https");
  }

  // Now parse — if this throws, the URL is malformed even though it
  // starts with https://.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError(trimmed, "malformed");
  }

  // Enforce https on the parsed protocol (belt+braces — a well-crafted
  // string could sneak `https://x` past the prefix check with unicode
  // homoglyphs; parsed.protocol is authoritative).
  if (parsed.protocol !== "https:") {
    throw new UnsafeUrlError(trimmed, `parsed protocol ${parsed.protocol}`);
  }

  // Optional: refuse credentials embedded in the URL (`https://user:pass@…`).
  // These embed secrets in the rendered HTML and are almost never legit
  // for an outbound email link.
  if (parsed.username !== "" || parsed.password !== "") {
    throw new UnsafeUrlError(trimmed, "embedded credentials");
  }

  // If appOrigin is provided and looks like an origin, additionally
  // require the URL's origin to match it. `appOrigin` may be empty
  // (`""`) when a template legitimately links off-site (e.g., help
  // articles); in that case skip the origin match.
  if (appOrigin !== "") {
    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(appOrigin).origin;
    } catch {
      throw new UnsafeUrlError(appOrigin, "invalid appOrigin");
    }
    if (parsed.origin !== expectedOrigin) {
      throw new UnsafeUrlError(trimmed, `origin ${parsed.origin} != ${expectedOrigin}`);
    }
  }

  return trimmed;
}
