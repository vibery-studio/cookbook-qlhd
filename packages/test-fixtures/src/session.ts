/**
 * RunwaySession — an authenticated cookie-jar wrapper over a fetcher.
 *
 * Once you have a session (via `loginAs` or the return of `createMember`),
 * every call to `session.fetch(path, init)` auto-attaches:
 *   - the `runway_at` access-cookie
 *   - the `runway_rt` refresh-cookie (path-scoped by the API)
 *   - CSRF headers on mutating verbs
 *
 * Tests stop building `cookie: 'runway_at=...'` strings by hand — this
 * was the top duplication smell across integration tests.
 */
import { CSRF_HEADERS, TEST_ORIGIN } from "./csrf";
import { extractCookie } from "./cookies";

/** Fetch signature miniflare's SELF exports. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface RunwaySession {
  readonly userId: string;
  readonly email: string;
  readonly accessCookie: string;
  readonly refreshCookie: string;
  /** Fetch that auto-attaches session cookies + CSRF headers. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** POST /auth/logout using this session's cookies. */
  logout(): Promise<Response>;
}

export interface CreateSessionInput {
  userId: string;
  email: string;
  accessCookie: string;
  refreshCookie: string;
  fetcher: Fetcher;
  /** Base origin for `session.fetch("/me")`-style relative paths. */
  origin?: string;
}

export function createSession(input: CreateSessionInput): RunwaySession {
  const origin = input.origin ?? TEST_ORIGIN;

  function buildUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (path.startsWith("/")) return `${origin}${path}`;
    return `${origin}/${path}`;
  }

  function buildHeaders(method: string, initHeaders: HeadersInit | undefined): Headers {
    const h = new Headers(initHeaders);
    // Cookie: both access + refresh; the API's per-cookie Path
    // scoping means the refresh cookie won't be used on /me but
    // sending it does no harm.
    const existing = h.get("cookie");
    const cookieValue = `runway_at=${input.accessCookie}; runway_rt=${input.refreshCookie}`;
    h.set("cookie", existing !== null && existing !== "" ? `${existing}; ${cookieValue}` : cookieValue);

    if (!READ_ONLY_METHODS.has(method.toUpperCase())) {
      for (const [k, v] of Object.entries(CSRF_HEADERS)) {
        if (!h.has(k)) h.set(k, v);
      }
    }
    return h;
  }

  return {
    userId: input.userId,
    email: input.email,
    accessCookie: input.accessCookie,
    refreshCookie: input.refreshCookie,
    async fetch(path, init = {}) {
      const method = init.method ?? "GET";
      const headers = buildHeaders(method, init.headers);
      return input.fetcher(buildUrl(path), { ...init, headers });
    },
    async logout() {
      return this.fetch("/auth/logout", { method: "POST" });
    },
  };
}

/**
 * Programmatic login. Hits POST /auth/login with `{email, password}` and
 * captures both cookies. Throws on non-200 so tests fail loudly on
 * misconfigured fixtures.
 */
export async function loginAs(
  fetcher: Fetcher,
  input: { email: string; password: string; origin?: string },
): Promise<{ accessCookie: string; refreshCookie: string }> {
  const origin = input.origin ?? TEST_ORIGIN;
  const res = await fetcher(`${origin}/auth/login`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  if (res.status !== 200) {
    throw new Error(`loginAs: expected 200, got ${res.status} for ${input.email}`);
  }
  const accessCookie = extractCookie(res, "runway_at");
  const refreshCookie = extractCookie(res, "runway_rt");
  if (accessCookie === null || refreshCookie === null) {
    throw new Error("loginAs: response missing runway_at or runway_rt cookie");
  }
  return { accessCookie, refreshCookie };
}
