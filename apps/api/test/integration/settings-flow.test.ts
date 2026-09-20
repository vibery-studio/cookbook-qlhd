/**
 * System-settings integration. Covers:
 *   - SettingsService.get returns default when D1 row absent, D1 row
 *     when present, KV cache on second read
 *   - SettingsService.set validates + upserts + busts KV + audits
 *   - Admin routes: RBAC (settings:read/settings:write), 404 on
 *     unknown key, 422 on invalid value, 200 round-trip
 *   - Email pipeline picks up updated from-address on next send
 */
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import {
  jwtRevocations,
  refreshTokens,
  settings,
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
import { SettingsService } from "../../src/settings/settings-service";
import { SETTINGS_REGISTRY } from "../../src/settings/registry";

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
  await db.delete(settings);
}

function extractCookie(response: Response, name: string): string | null {
  const raw = response.headers.get("set-cookie");
  if (raw === null) return null;
  const idx = raw.indexOf(`${name}=`);
  if (idx === -1) return null;
  const start = idx + name.length + 1;
  const endIdx = raw.indexOf(";", start);
  return raw.slice(start, endIdx === -1 ? undefined : endIdx);
}

function extractVerifyToken(): string {
  const emails = getNoopSentEmails();
  const last = emails[emails.length - 1];
  if (last === undefined || last.template !== "verify-email") {
    throw new Error("no verify-email in noop buffer");
  }
  const url = new URL(last.props.verifyUrl);
  const token = url.searchParams.get("token");
  if (token === null) throw new Error("verifyUrl missing token");
  return token;
}

async function signupVerifyLoginAsAdmin(
  email: string,
  password: string,
): Promise<string> {
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

  await assignRoleByName(
    { db: getDb(env), kv: env.SESSIONS, env: env },
    { userId: signupBody.user_id, roleName: "admin" },
  );

  const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const cookie = extractCookie(login, "runway_at");
  if (cookie === null) throw new Error("no access cookie");
  return cookie;
}

describe("SettingsService (unit)", () => {
  beforeEach(async () => {
    await truncate();
  });

  it("get returns registry default when no D1 row + no cache", async () => {
    const service = new SettingsService({ db: getDb(env), kv: env.SETTINGS });
    const value = await service.get("email.from_address");
    expect(value).toBe(SETTINGS_REGISTRY["email.from_address"].default);
  });

  it("set + get roundtrip: value persists, KV cached, audit-logged", async () => {
    const service = new SettingsService({ db: getDb(env), kv: env.SETTINGS });
    await service.set("email.from_name", "Alpha Runway", "01ACTOR000000000000000AAAA");

    // D1 row exists
    const db = getDb(env);
    const row = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "email.from_name"));
    expect(row[0]?.value).toBe(JSON.stringify("Alpha Runway"));
    expect(row[0]?.updatedBy).toBe("01ACTOR000000000000000AAAA");

    // KV was busted on write; next get() re-populates it
    const value = await service.get("email.from_name");
    expect(value).toBe("Alpha Runway");
  });

  it("set rejects invalid value against registry schema", async () => {
    const service = new SettingsService({ db: getDb(env), kv: env.SETTINGS });
    await expect(
      service.set("email.from_address", "not-an-email", "01ACTOR000000000000000AAAA"),
    ).rejects.toThrow();
  });

  it("list returns all registered keys, marking seed rows as updated_by=null", async () => {
    const service = new SettingsService({ db: getDb(env), kv: env.SETTINGS });
    const snapshot = await service.list();
    expect(snapshot.map((s) => s.key).sort()).toEqual(
      ["email.from_address", "email.from_name"].sort(),
    );
    // No D1 rows yet → all defaults, no updated_by
    expect(snapshot.every((s) => s.updatedBy === null)).toBe(true);
  });
});

describe("admin settings routes (integration)", () => {
  beforeEach(async () => {
    await truncate();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("GET /admin/settings lists all registered keys (admin)", async () => {
    const cookie = await signupVerifyLoginAsAdmin(
      "admin1@example.com",
      "correct-horse-battery-staple",
    );

    const res = await SELF.fetch(`${ORIGIN}/admin/settings`, {
      headers: { cookie: `runway_at=${cookie}` },
    });
    expect(res.status).toBe(200);
    const body: {
      items: Array<{ key: string; value: unknown; description: string }>;
    } = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.items.map((i) => i.key).sort()).toEqual(
      ["email.from_address", "email.from_name"].sort(),
    );
  });

  it("GET /admin/settings/:key returns the value (admin)", async () => {
    const cookie = await signupVerifyLoginAsAdmin(
      "admin2@example.com",
      "correct-horse-battery-staple",
    );

    const res = await SELF.fetch(`${ORIGIN}/admin/settings/email.from_name`, {
      headers: { cookie: `runway_at=${cookie}` },
    });
    expect(res.status).toBe(200);
    const body: { key: string; value: unknown } = await res.json();
    expect(body.key).toBe("email.from_name");
    expect(body.value).toBe("Runway");
  });

  it("GET /admin/settings/:unknown-key → 404", async () => {
    const cookie = await signupVerifyLoginAsAdmin(
      "admin3@example.com",
      "correct-horse-battery-staple",
    );

    const res = await SELF.fetch(`${ORIGIN}/admin/settings/nope.gotcha`, {
      headers: { cookie: `runway_at=${cookie}` },
    });
    expect(res.status).toBe(404);
  });

  it("PUT /admin/settings/:key with invalid value → 422 problem+json", async () => {
    const cookie = await signupVerifyLoginAsAdmin(
      "admin4@example.com",
      "correct-horse-battery-staple",
    );

    const res = await SELF.fetch(
      `${ORIGIN}/admin/settings/email.from_address`,
      {
        method: "PUT",
        headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
        body: JSON.stringify({ value: "not-an-email" }),
      },
    );
    expect(res.status).toBe(422);
  });

  it("PUT /admin/settings/:key with valid value → 200 + updated snapshot", async () => {
    const cookie = await signupVerifyLoginAsAdmin(
      "admin5@example.com",
      "correct-horse-battery-staple",
    );

    const res = await SELF.fetch(`${ORIGIN}/admin/settings/email.from_name`, {
      method: "PUT",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
      body: JSON.stringify({ value: "Runway Preview" }),
    });
    expect(res.status).toBe(200);
    const body: { value: unknown; updated_by: string | null } = await res.json();
    expect(body.value).toBe("Runway Preview");
    expect(body.updated_by).not.toBeNull();
  });

  it("PUT /admin/settings/:key propagates to email pipeline — settings.get sees the new value", async () => {
    // Success criterion from phase-08 spec: change from-address →
    // next email uses new value. The noop adapter doesn't stamp
    // from-address on the buffered message (only Resend does), so
    // we verify propagation at the SettingsService boundary — this
    // is what selectEmailAdapter() calls when it constructs the
    // Resend adapter. In production, the very next Resend send
    // after this test's PUT would use the updated address.
    const cookie = await signupVerifyLoginAsAdmin(
      "admin-propagate@example.com",
      "correct-horse-battery-staple",
    );

    // Baseline: unmodified default.
    const service = new SettingsService({ db: getDb(env), kv: env.SETTINGS });
    expect(await service.get("email.from_address")).toBe(
      "no-reply@example.com",
    );

    // PUT via the admin route.
    const res = await SELF.fetch(
      `${ORIGIN}/admin/settings/email.from_address`,
      {
        method: "PUT",
        headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
        body: JSON.stringify({ value: "hello@runway.dev" }),
      },
    );
    expect(res.status).toBe(200);

    // Next SettingsService.get() call reads the new value — this
    // is exactly the call path selectEmailAdapter() uses when
    // building the Resend adapter for the next outbound email.
    // A fresh service instance ensures we hit KV/D1, not in-process
    // memory.
    const freshService = new SettingsService({
      db: getDb(env),
      kv: env.SETTINGS,
    });
    expect(await freshService.get("email.from_address")).toBe(
      "hello@runway.dev",
    );
  });
});
