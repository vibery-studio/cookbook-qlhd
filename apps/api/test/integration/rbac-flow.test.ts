/**
 * RBAC integration: proves member users hit 403 on admin routes, seeded
 * admins pass, `/me` reflects real roles+permissions from the join, and
 * assigning a role invalidates the KV session cache so the next request
 * sees the new grant without waiting for TTL.
 *
 * Uses @runway/test-fixtures for signup/verify/login and session cookie
 * handling — the previous ~40 lines of local helpers moved to that
 * package during Phase 4.
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
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

const fixtureDeps = {
  fetcher: (input: string, init?: RequestInit) => SELF.fetch(input, init),
  readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
  origin: ORIGIN,
};

async function resetDb(): Promise<void> {
  // Order: children before parents (D1 has no FK cascade). Same order as
  // apps/api/src/dao/user-dao.ts#deleteUser.
  await truncateTables(getDb(env), [
    verificationTokens,
    refreshTokens,
    jwtRevocations,
    userRoles,
    users,
  ]);
}

describe("rbac flow (integration)", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("member calling /admin/users -> 403 problem+json", async () => {
    const member = await createMember(fixtureDeps, { email: "member1@example.com" });

    const res = await member.session.fetch("/admin/users");
    expect(res.status).toBe(403);
    const body: { type: string; title: string } = await res.json();
    expect(body.title).toBe("Forbidden");
    expect(body.type).toContain("/forbidden");
  });

  it("admin calling /admin/users -> 200 with paginated list", async () => {
    const admin = await createMember(fixtureDeps, { email: "admin1@example.com" });

    // Grant admin, then bust the KV cache so the middleware re-loads.
    const result = await assignRoleByName(
      { db: getDb(env), kv: env.SESSIONS, env },
      { userId: admin.userId, roleName: "admin" },
    );
    expect(result).toEqual({ kind: "ok", assigned: true });

    const res = await admin.session.fetch("/admin/users");
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
    const user = await createMember(fixtureDeps, { email: "self@example.com" });

    // Pre-role: /me shows no roles/permissions
    const me1 = await user.session.fetch("/me");
    const body1: { roles: string[]; permissions: string[] } = await me1.json();
    expect(body1.roles).toEqual([]);
    expect(body1.permissions).toEqual([]);

    // Grant member (invalidates cache)
    await assignRoleByName(
      { db: getDb(env), kv: env.SESSIONS, env },
      { userId: user.userId, roleName: "member" },
    );

    // Post-grant: /me should surface member + notes:read/notes:write.
    // Cache was invalidated by assignRoleByName, so the next hit reloads
    // from D1 (no manual sleep-for-TTL needed).
    const me2 = await user.session.fetch("/me");
    const body2: { roles: string[]; permissions: string[] } = await me2.json();
    expect(body2.roles).toEqual(["member"]);
    expect([...body2.permissions].sort()).toEqual(["notes:read", "notes:write"]);
  });

  it("anonymous calling /admin/users -> 401/403", async () => {
    const res = await SELF.fetch(`${ORIGIN}/admin/users`);
    // requireAuth throws 401 with problem+json when the access cookie
    // is missing — this test asserts we DON'T accidentally leak a
    // 200/500 for the anonymous case.
    expect([401, 403]).toContain(res.status);
  });

  it("assignRoleByName is idempotent and returns assigned:false on repeat", async () => {
    const user = await createMember(fixtureDeps, { email: "twice@example.com" });
    const deps = { db: getDb(env), kv: env.SESSIONS, env };

    const first = await assignRoleByName(deps, { userId: user.userId, roleName: "admin" });
    expect(first).toEqual({ kind: "ok", assigned: true });

    const second = await assignRoleByName(deps, { userId: user.userId, roleName: "admin" });
    expect(second).toEqual({ kind: "ok", assigned: false });
  });

  it("unknown role name -> unknown-role outcome (no D1 write)", async () => {
    const user = await createMember(fixtureDeps, { email: "unknown-role@example.com" });
    const result = await assignRoleByName(
      { db: getDb(env), kv: env.SESSIONS, env },
      { userId: user.userId, roleName: "moderator" },
    );
    expect(result).toEqual({ kind: "unknown-role" });
  });
});
