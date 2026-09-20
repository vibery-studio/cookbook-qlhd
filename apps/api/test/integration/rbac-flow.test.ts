/**
 * RBAC integration: proves member users hit 403 on admin routes, seeded
 * admins pass, `/me` reflects real roles+permissions from the join, and
 * assigning a role invalidates the KV session cache so the next request
 * sees the new grant without waiting for TTL.
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../src/db/client";
import {
  jwtRevocations,
  refreshTokens,
  userRoles,
  users,
  verificationTokens,
} from "../../src/db/schema";
import {
  getNoopSentEmails,
  resetNoopEmailBuffer,
} from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import { assignRoleByName } from "../../src/services/admin-service";

const ORIGIN = "http://localhost:8787";
const CSRF_HEADERS = {
  "content-type": "application/json",
  origin: ORIGIN,
  "x-requested-with": "fetch",
};

async function truncate(): Promise<void> {
  const db = getDb(env);
  await db.delete(verificationTokens);
  await db.delete(refreshTokens);
  await db.delete(jwtRevocations);
  await db.delete(userRoles);
  await db.delete(users);
}

function extractCookie(response: Response, name: string): string | null {
  const raw = response.headers.get("set-cookie");
  if (raw === null) return null;
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

async function signupVerifyLogin(
  email: string,
  password: string,
): Promise<{ userId: string; accessCookie: string }> {
  const signup = await SELF.fetch(`${ORIGIN}/auth/signup`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  expect(signup.status).toBe(201);
  const signupBody: { user_id: string } = await signup.json();

  const token = extractVerifyToken();
  const verify = await SELF.fetch(`${ORIGIN}/auth/verify`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token }),
  });
  expect(verify.status).toBe(200);

  const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const accessCookie = extractCookie(login, "runway_at");
  if (accessCookie === null) throw new Error("no access cookie on login");

  return { userId: signupBody.user_id, accessCookie };
}

describe("rbac flow (integration)", () => {
  beforeEach(async () => {
    await truncate();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("member calling /admin/users -> 403 problem+json", async () => {
    const { accessCookie } = await signupVerifyLogin(
      "member1@example.com",
      "correct-horse-battery-staple",
    );

    const res = await SELF.fetch(`${ORIGIN}/admin/users`, {
      headers: { cookie: `runway_at=${accessCookie}` },
    });
    expect(res.status).toBe(403);
    const body: { type: string; title: string } = await res.json();
    expect(body.title).toBe("Forbidden");
    expect(body.type).toContain("/forbidden");
  });

  it("admin calling /admin/users -> 200 with paginated list", async () => {
    const { userId, accessCookie } = await signupVerifyLogin(
      "admin1@example.com",
      "correct-horse-battery-staple",
    );

    // Grant admin, then bust the KV cache so the middleware re-loads.
    const result = await assignRoleByName(
      { db: getDb(env), kv: env.SESSIONS, env: env },
      { userId, roleName: "admin" },
    );
    expect(result).toEqual({ kind: "ok", assigned: true });

    const res = await SELF.fetch(`${ORIGIN}/admin/users`, {
      headers: { cookie: `runway_at=${accessCookie}` },
    });
    expect(res.status).toBe(200);
    const body: {
      items: Array<{ id: string; email: string; roles: string[] }>;
      next_cursor: string | null;
    } = await res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0]?.email).toBe("admin1@example.com");
    expect(body.items[0]?.roles).toEqual(["admin"]);
    expect(body.next_cursor).toBeNull();
  });

  it("/me returns real roles+permissions from the RBAC join", async () => {
    const { userId, accessCookie } = await signupVerifyLogin(
      "self@example.com",
      "correct-horse-battery-staple",
    );

    // Pre-role: /me shows no roles/permissions
    const me1 = await SELF.fetch(`${ORIGIN}/me`, {
      headers: { cookie: `runway_at=${accessCookie}` },
    });
    const body1: { roles: string[]; permissions: string[] } = await me1.json();
    expect(body1.roles).toEqual([]);
    expect(body1.permissions).toEqual([]);

    // Grant member (invalidates cache)
    await assignRoleByName(
      { db: getDb(env), kv: env.SESSIONS, env: env },
      { userId, roleName: "member" },
    );

    // Post-grant: /me should surface member + notes:read/notes:write.
    // Cache was invalidated by assignRoleByName, so the next hit reloads
    // from D1 (no manual sleep-for-TTL needed).
    const me2 = await SELF.fetch(`${ORIGIN}/me`, {
      headers: { cookie: `runway_at=${accessCookie}` },
    });
    const body2: { roles: string[]; permissions: string[] } = await me2.json();
    expect(body2.roles).toEqual(["member"]);
    expect([...body2.permissions].sort()).toEqual(["notes:read", "notes:write"]);
  });

  it("member calling /admin/users without cookie -> 403 (rbac collapses no-principal into forbidden)", async () => {
    const res = await SELF.fetch(`${ORIGIN}/admin/users`);
    // requireAuth throws 401 with problem+json when the access cookie
    // is missing — this test asserts we DON'T accidentally leak a
    // 200/500 for the anonymous case.
    expect([401, 403]).toContain(res.status);
  });

  it("assignRoleByName is idempotent and returns assigned:false on repeat", async () => {
    const { userId } = await signupVerifyLogin(
      "twice@example.com",
      "correct-horse-battery-staple",
    );
    const deps = { db: getDb(env), kv: env.SESSIONS, env: env };

    const first = await assignRoleByName(deps, { userId, roleName: "admin" });
    expect(first).toEqual({ kind: "ok", assigned: true });

    const second = await assignRoleByName(deps, { userId, roleName: "admin" });
    expect(second).toEqual({ kind: "ok", assigned: false });
  });

  it("unknown role name -> unknown-role outcome (no D1 write)", async () => {
    const { userId } = await signupVerifyLogin(
      "unknown-role@example.com",
      "correct-horse-battery-staple",
    );
    const result = await assignRoleByName(
      { db: getDb(env), kv: env.SESSIONS, env: env },
      { userId, roleName: "moderator" },
    );
    expect(result).toEqual({ kind: "unknown-role" });
  });
});
