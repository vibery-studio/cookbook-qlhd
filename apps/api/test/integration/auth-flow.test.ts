/**
 * Full auth flow integration: signup -> capture noop-email token -> verify
 * -> login -> /me -> refresh -> /me -> logout -> /me 401. Also covers CSRF
 * middleware (Origin + X-Requested-With), timing-safe login, concurrent
 * refresh + verify races, and logout jti revocation.
 *
 * Runs inside miniflare via vitest-pool-workers so cookies, D1, and KV are
 * real bindings.
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import {
  jwtRevocations,
  refreshTokens,
  users,
  verificationTokens,
} from "../../src/db/schema";
import {
  getNoopSentEmails,
  resetNoopEmailBuffer,
} from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";

const ORIGIN = "http://localhost:8787";
const CSRF_HEADERS = {
  "content-type": "application/json",
  origin: ORIGIN,
  "x-requested-with": "fetch",
};

async function truncateAuthTables(): Promise<void> {
  const db = getDb(env);
  await db.delete(verificationTokens);
  await db.delete(refreshTokens);
  await db.delete(jwtRevocations);
  await db.delete(users);
}

function extractCookie(response: Response, name: string): string | null {
  const raw = response.headers.get("set-cookie");
  if (raw === null) return null;
  // Workers concatenates multiple Set-Cookie headers with a comma. Cookie
  // values themselves can contain commas only inside quoted strings — we
  // don't quote anything, so a naive split-by-`, ` is unsafe against the
  // `expires=` attribute which always has a comma. Instead scan for the
  // exact `name=` prefix and stop at the next `;` or the end of the value.
  const idx = raw.indexOf(`${name}=`);
  if (idx === -1) return null;
  const start = idx + name.length + 1;
  const end = raw.indexOf(";", start);
  return raw.slice(start, end === -1 ? undefined : end);
}

function extractVerifyToken(): string {
  const emails = getNoopSentEmails();
  const last = emails[emails.length - 1];
  if (last === undefined || last.template !== "verify-email") {
    throw new Error("no verify-email in noop buffer");
  }
  const url = new URL(last.props.verifyUrl);
  const token = url.searchParams.get("token");
  if (token === null) throw new Error("verifyUrl missing token param");
  return token;
}

async function signupAndVerify(
  email: string,
  password: string,
): Promise<void> {
  const signup = await SELF.fetch(`${ORIGIN}/auth/signup`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  expect(signup.status).toBe(201);

  const token = extractVerifyToken();
  const verify = await SELF.fetch(`${ORIGIN}/auth/verify`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token }),
  });
  expect(verify.status).toBe(200);
}

describe("auth flow (integration)", () => {
  beforeEach(async () => {
    await truncateAuthTables();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("golden path: signup -> verify -> login -> /me -> refresh -> /me -> logout -> /me 401", async () => {
    const email = "gold@example.com";
    const password = "correct-horse-battery-staple";

    await signupAndVerify(email, password);

    const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(200);
    const accessCookie = extractCookie(login, "runway_at");
    const refreshCookie = extractCookie(login, "runway_rt");
    expect(accessCookie).not.toBeNull();
    expect(refreshCookie).not.toBeNull();

    const me1 = await SELF.fetch(`${ORIGIN}/me`, {
      headers: { cookie: `runway_at=${accessCookie}` },
    });
    expect(me1.status).toBe(200);
    const me1Body: { email: string } = await me1.json();
    expect(me1Body.email).toBe(email);

    const refreshRes = await SELF.fetch(`${ORIGIN}/auth/refresh`, {
      method: "POST",
      headers: {
        ...CSRF_HEADERS,
        cookie: `runway_rt=${refreshCookie}`,
      },
    });
    expect(refreshRes.status).toBe(200);
    const newAccess = extractCookie(refreshRes, "runway_at");
    const newRefresh = extractCookie(refreshRes, "runway_rt");
    expect(newAccess).not.toBeNull();
    expect(newRefresh).not.toBeNull();
    expect(newRefresh).not.toBe(refreshCookie);

    const me2 = await SELF.fetch(`${ORIGIN}/me`, {
      headers: { cookie: `runway_at=${newAccess}` },
    });
    expect(me2.status).toBe(200);

    const logout = await SELF.fetch(`${ORIGIN}/auth/logout`, {
      method: "POST",
      headers: {
        ...CSRF_HEADERS,
        cookie: `runway_at=${newAccess}; runway_rt=${newRefresh}`,
      },
    });
    expect(logout.status).toBe(200);

    // Old access cookie must now fail — jti is revoked.
    _resetJtiCache();
    const me3 = await SELF.fetch(`${ORIGIN}/me`, {
      headers: { cookie: `runway_at=${newAccess}` },
    });
    expect(me3.status).toBe(401);
  });

  it("CSRF: POST without Origin header -> 403", async () => {
    const res = await SELF.fetch(`${ORIGIN}/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "fetch",
      },
      body: JSON.stringify({ email: "x@example.com", password: "whatever12345" }),
    });
    expect(res.status).toBe(403);
  });

  it("CSRF: POST without X-Requested-With header -> 403", async () => {
    const res = await SELF.fetch(`${ORIGIN}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "x@example.com", password: "whatever12345" }),
    });
    expect(res.status).toBe(403);
  });

  // Ratio test performs 4 scrypt logins (warmup + known + unknown +
  // known) — each ~500ms locally, ~1.5s under CI contention. Give
  // it a wide budget so we don't false-fail on slow runners.
  it("login: unknown email is timing-close to known-email-wrong-password", { timeout: 30_000 }, async () => {
    await signupAndVerify("known@example.com", "correct-horse-battery-staple");

    async function measure(email: string): Promise<number> {
      const start = performance.now();
      await SELF.fetch(`${ORIGIN}/auth/login`, {
        method: "POST",
        headers: CSRF_HEADERS,
        body: JSON.stringify({ email, password: "wrong-password-attempt" }),
      });
      return performance.now() - start;
    }

    // Warm caches so first-call cold-start doesn't skew the delta.
    await measure("warmup@example.com");
    await measure("known@example.com");

    const unknown = await measure("nobody@example.com");
    const known = await measure("known@example.com");

    // Proportional check instead of fixed-ms — CI runners are slow +
    // noisy, and an absolute-delta bound flakes because scrypt itself
    // varies by ±hundreds of ms per call under contention. What we
    // *really* want to prove: the unknown-email path did comparable
    // scrypt work to the known path (via the dummy hash). If we
    // ever short-circuited on unknown-email, `unknown` would be near
    // zero while `known` was ~hundreds of ms — a ratio, not a
    // delta, catches that.
    const smaller = Math.min(unknown, known);
    const larger = Math.max(unknown, known);
    // Require the shorter of the two to be at least 30% of the longer.
    // A skipped-scrypt regression would produce a ratio near 0.
    expect(smaller / larger).toBeGreaterThan(0.3);
  });

  it("concurrent refresh: exactly one 200, the other 401 reuse-detected", async () => {
    const email = "race@example.com";
    const password = "correct-horse-battery-staple";
    await signupAndVerify(email, password);

    const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const refreshCookie = extractCookie(login, "runway_rt");

    const [a, b] = await Promise.all([
      SELF.fetch(`${ORIGIN}/auth/refresh`, {
        method: "POST",
        headers: { ...CSRF_HEADERS, cookie: `runway_rt=${refreshCookie}` },
      }),
      SELF.fetch(`${ORIGIN}/auth/refresh`, {
        method: "POST",
        headers: { ...CSRF_HEADERS, cookie: `runway_rt=${refreshCookie}` },
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    // Winner gets 200; loser gets 401 (either "not-found" -> invalid or
    // "reuse-detected"). Both losers surface as 401 to the client.
    expect(statuses).toEqual([200, 401]);
  });

  it("concurrent verify: one 200, others 410", async () => {
    const email = "concurrent-verify@example.com";
    const password = "correct-horse-battery-staple";
    const signup = await SELF.fetch(`${ORIGIN}/auth/signup`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    expect(signup.status).toBe(201);
    const token = extractVerifyToken();

    const results = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        SELF.fetch(`${ORIGIN}/auth/verify`, {
          method: "POST",
          headers: CSRF_HEADERS,
          body: JSON.stringify({ token }),
        }),
      ),
    );

    const okCount = results.filter((r) => r.status === 200).length;
    const goneCount = results.filter((r) => r.status === 410).length;
    expect(okCount).toBe(1);
    expect(goneCount).toBe(4);
  });

  it("signup duplicate email -> 409", async () => {
    const email = "dup@example.com";
    const password = "correct-horse-battery-staple";
    const first = await SELF.fetch(`${ORIGIN}/auth/signup`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    expect(first.status).toBe(201);

    const second = await SELF.fetch(`${ORIGIN}/auth/signup`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    expect(second.status).toBe(409);
  });

  it("login before verify -> 403 not-verified", async () => {
    const email = "unverified@example.com";
    const password = "correct-horse-battery-staple";
    const signup = await SELF.fetch(`${ORIGIN}/auth/signup`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    expect(signup.status).toBe(201);

    const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(403);
  });

  it("/me without cookie -> 401", async () => {
    const res = await SELF.fetch(`${ORIGIN}/me`);
    expect(res.status).toBe(401);
  });

  it("logout revokes the refresh row in D1 (path scoping fix)", async () => {
    const email = "logout-revoke@example.com";
    const password = "correct-horse-battery-staple";
    await signupAndVerify(email, password);

    const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const accessCookie = extractCookie(login, "runway_at");
    const refreshCookie = extractCookie(login, "runway_rt");

    // Confirm the refresh row exists pre-logout (non-null revokedAt filter).
    const db = getDb(env);
    const preLogoutRows = await db.select().from(refreshTokens);
    expect(preLogoutRows.length).toBe(1);
    expect(preLogoutRows[0]?.revokedAt).toBeNull();

    const logoutRes = await SELF.fetch(`${ORIGIN}/auth/logout`, {
      method: "POST",
      headers: {
        ...CSRF_HEADERS,
        cookie: `runway_at=${accessCookie}; runway_rt=${refreshCookie}`,
      },
    });
    expect(logoutRes.status).toBe(200);

    // Refresh row MUST be revoked — this is the assertion the golden path
    // couldn't make because it constructs cookies manually. In production
    // a browser would only send `runway_rt` to /auth/logout if its Path
    // scope covers /auth/logout (fixed to Path=/auth).
    const postLogoutRows = await db.select().from(refreshTokens);
    expect(postLogoutRows.length).toBe(1);
    expect(postLogoutRows[0]?.revokedAt).not.toBeNull();
  });

  it("concurrent refresh: winner's new session survives (no chain-nuke)", async () => {
    const email = "winner-survives@example.com";
    const password = "correct-horse-battery-staple";
    await signupAndVerify(email, password);

    const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const refreshCookie = extractCookie(login, "runway_rt");
    const loginBody: { user_id: string } = await login.json();
    const loginUserId = loginBody.user_id;

    const [a, b] = await Promise.all([
      SELF.fetch(`${ORIGIN}/auth/refresh`, {
        method: "POST",
        headers: { ...CSRF_HEADERS, cookie: `runway_rt=${refreshCookie}` },
      }),
      SELF.fetch(`${ORIGIN}/auth/refresh`, {
        method: "POST",
        headers: { ...CSRF_HEADERS, cookie: `runway_rt=${refreshCookie}` },
      }),
    ]);

    const winner = a.status === 200 ? a : b;
    expect(winner.status).toBe(200);
    const winnerRefresh = extractCookie(winner, "runway_rt");
    const winnerAccess = extractCookie(winner, "runway_at");

    // Winner's brand-new refresh cookie must still work — a chain-nuke
    // would have revoked it during the loser's reuse-detected branch.
    const followup = await SELF.fetch(`${ORIGIN}/auth/refresh`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_rt=${winnerRefresh}` },
    });
    expect(followup.status).toBe(200);

    // And the winner's access token must resolve /me.
    const me = await SELF.fetch(`${ORIGIN}/me`, {
      headers: { cookie: `runway_at=${winnerAccess}` },
    });
    expect(me.status).toBe(200);

    // Confirm no rows for this user are wholesale-revoked by chain-nuke.
    const db = getDb(env);
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, loginUserId));
    const liveRows = rows.filter((r) => r.revokedAt === null);
    // After 3 refreshes (initial login + winner rotate + followup rotate),
    // exactly one live row is expected.
    expect(liveRows.length).toBe(1);
  });
});
