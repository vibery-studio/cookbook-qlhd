/**
 * Smoke test for @runway/test-fixtures — proves the four core helpers
 * (createMember, createAdmin, RunwaySession.fetch, readLastVerifyToken)
 * work end-to-end against the real API. If a phase-1-3 change breaks a
 * fixture assumption, this test catches it before consumer tests do.
 */
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAdmin,
  createMember,
  readLastVerifyToken,
  truncateTables,
} from "@runway/test-fixtures";
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

const memberDeps = {
  fetcher: (input: string, init?: RequestInit) => SELF.fetch(input, init),
  readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
  origin: ORIGIN,
};

const adminDeps = {
  ...memberDeps,
  assignAdminRole: async (userId: string) => {
    await assignRoleByName(
      { db: getDb(env), kv: env.SESSIONS, env },
      { userId, roleName: "admin" },
    );
  },
};

async function resetDb(): Promise<void> {
  await truncateTables(getDb(env), [
    verificationTokens,
    refreshTokens,
    jwtRevocations,
    userRoles,
    users,
  ]);
}

describe("@runway/test-fixtures smoke", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("createMember → session.fetch('/me') → 200 with the caller's id", async () => {
    const member = await createMember(memberDeps, { email: "smoke-member@example.com" });
    expect(member.userId).toMatch(/^[0-9A-Z]{26}$/); // ULID shape
    expect(member.email).toBe("smoke-member@example.com");
    expect(member.session.accessCookie.length).toBeGreaterThan(0);

    const me = await member.session.fetch("/me");
    expect(me.status).toBe(200);
    const body: { id: string; roles: string[] } = await me.json();
    expect(body.id).toBe(member.userId);
    expect(body.roles).toEqual([]);
  });

  it("createAdmin → session hits /admin/users with 200", async () => {
    const admin = await createAdmin(adminDeps, { email: "smoke-admin@example.com" });
    const res = await admin.session.fetch("/admin/users");
    expect(res.status).toBe(200);
    const body: { items: Array<{ email: string; roles: string[] }> } = await res.json();
    const self = body.items.find((u) => u.email === "smoke-admin@example.com");
    expect(self?.roles).toEqual(["admin"]);
  });

  it("mutating fetch through session auto-attaches CSRF headers", async () => {
    const admin = await createAdmin(adminDeps, { email: "smoke-csrf@example.com" });
    // PUT without RunwaySession would require CSRF_HEADERS manually — using
    // session.fetch proves the wrapper adds them. If it didn't, requireOrigin
    // would reject with 403.
    const res = await admin.session.fetch("/admin/settings/email.from_name", {
      method: "PUT",
      body: JSON.stringify({ value: "smoke test" }),
    });
    expect(res.status).toBe(200);
  });

  it("session.logout revokes the refresh chain; subsequent refresh is rejected", async () => {
    const member = await createMember(memberDeps, { email: "smoke-logout@example.com" });
    const logout = await member.session.logout();
    expect(logout.status).toBe(200);

    // Access cookie survives until its 120s TTL — logout only revokes
    // the REFRESH chain. Prove that by trying to refresh: the endpoint
    // must reject because the refresh token was rotated to revoked.
    const refresh = await member.session.fetch("/auth/refresh", { method: "POST" });
    expect(refresh.status).toBe(401);
  });
});
