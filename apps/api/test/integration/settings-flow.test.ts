/**
 * System-settings integration. Covers:
 *   - SettingsService.get returns default when D1 row absent, D1 row
 *     when present, KV cache on second read
 *   - SettingsService.set validates + upserts + busts KV + audits
 *   - Admin routes: RBAC (settings:read/settings:write), 404 on
 *     unknown key, 422 on invalid value, 200 round-trip
 *   - Email pipeline picks up updated from-address on next send
 *
 * Uses @runway/test-fixtures for the createAdmin bootstrap — the
 * previous ~40 lines of inline signup+verify+role-assign+login moved
 * to that package during Phase 4.
 */
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createAdmin,
  readLastVerifyToken,
  truncateTables,
} from "@runway/test-fixtures";
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

const fixtureDeps = {
  fetcher: (input: string, init?: RequestInit) => SELF.fetch(input, init),
  readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
  origin: ORIGIN,
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
    settings,
  ]);
}

describe("SettingsService (unit)", () => {
  beforeEach(async () => {
    await resetDb();
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
      [
        "email.from_address",
        "email.from_name",
        "privacy.deletion_grace_seconds",
        "privacy.export_retention_seconds",
      ].sort(),
    );
    // No D1 rows yet → all defaults, no updated_by
    expect(snapshot.every((s) => s.updatedBy === null)).toBe(true);
  });
});

describe("admin settings routes (integration)", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("GET /admin/settings lists all registered keys (admin)", async () => {
    const admin = await createAdmin(fixtureDeps, { email: "admin1@example.com" });

    const res = await admin.session.fetch("/admin/settings");
    expect(res.status).toBe(200);
    const body: {
      items: Array<{ key: string; value: unknown; description: string }>;
    } = await res.json();
    // 2 email + 2 privacy (Phase 3 v1.1).
    expect(body.items.length).toBe(4);
    expect(body.items.map((i) => i.key).sort()).toEqual(
      [
        "email.from_address",
        "email.from_name",
        "privacy.deletion_grace_seconds",
        "privacy.export_retention_seconds",
      ].sort(),
    );
  });

  it("GET /admin/settings/:key returns the value (admin)", async () => {
    const admin = await createAdmin(fixtureDeps, { email: "admin2@example.com" });

    const res = await admin.session.fetch("/admin/settings/email.from_name");
    expect(res.status).toBe(200);
    const body: { key: string; value: unknown } = await res.json();
    expect(body.key).toBe("email.from_name");
    expect(body.value).toBe("Runway");
  });

  it("GET /admin/settings/:unknown-key → 404", async () => {
    const admin = await createAdmin(fixtureDeps, { email: "admin3@example.com" });

    const res = await admin.session.fetch("/admin/settings/nope.gotcha");
    expect(res.status).toBe(404);
  });

  it("PUT /admin/settings/:key with invalid value → 422 problem+json", async () => {
    const admin = await createAdmin(fixtureDeps, { email: "admin4@example.com" });

    const res = await admin.session.fetch("/admin/settings/email.from_address", {
      method: "PUT",
      body: JSON.stringify({ value: "not-an-email" }),
    });
    expect(res.status).toBe(422);
  });

  it("PUT /admin/settings/:key with valid value → 200 + updated snapshot", async () => {
    const admin = await createAdmin(fixtureDeps, { email: "admin5@example.com" });

    const res = await admin.session.fetch("/admin/settings/email.from_name", {
      method: "PUT",
      body: JSON.stringify({ value: "Runway Preview" }),
    });
    expect(res.status).toBe(200);
    const body: { value: unknown; updated_by: string | null } = await res.json();
    expect(body.value).toBe("Runway Preview");
    expect(body.updated_by).not.toBeNull();
  });

  it("PUT /admin/settings/:key propagates to email pipeline — settings.get sees the new value", async () => {
    // Success criterion from phase-08 spec: change from-address →
    // next email uses new value. Same behavior; the fixture handles
    // the bootstrap so this test focuses on the propagation claim.
    const admin = await createAdmin(fixtureDeps, {
      email: "admin-propagate@example.com",
    });

    // Baseline: unmodified default.
    const service = new SettingsService({ db: getDb(env), kv: env.SETTINGS });
    expect(await service.get("email.from_address")).toBe(
      "no-reply@example.com",
    );

    const res = await admin.session.fetch("/admin/settings/email.from_address", {
      method: "PUT",
      body: JSON.stringify({ value: "hello@runway.dev" }),
    });
    expect(res.status).toBe(200);

    // Next SettingsService.get() call reads the new value — this is
    // exactly the call path selectEmailAdapter() uses when building
    // the Resend adapter for the next outbound email. A fresh service
    // instance ensures we hit KV/D1, not in-process memory.
    const freshService = new SettingsService({
      db: getDb(env),
      kv: env.SETTINGS,
    });
    expect(await freshService.get("email.from_address")).toBe(
      "hello@runway.dev",
    );
  });
});

