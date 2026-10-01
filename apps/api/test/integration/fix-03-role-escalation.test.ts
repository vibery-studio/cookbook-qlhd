/**
 * FIX-03 (SPEC-06 DEC-5 A): no self-escalation through the Users screen.
 *   - changing your OWN role → 403 forbidden, rule self_role
 *   - assigning `admin` when you are not admin → 403 forbidden, rule admin_only
 *   - each refusal writes exactly one `permission.denied` audit row; nothing else changes
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAuditEvents,
  CSRF_HEADERS,
  createAdmin,
  createSession,
  loginAs,
  readLastVerifyToken,
  truncateTables,
  type RunwaySession,
} from "@runway/test-fixtures";
import { getDb } from "../../src/db/client";
import { jwtRevocations, refreshTokens, userRoles, users, verificationTokens } from "../../src/db/schema";
import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import { assignRoleByName } from "../../src/services/admin-service";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);

interface Staff {
  userId: string;
  session: RunwaySession;
}

async function resetDb(): Promise<void> {
  await clearAuditEvents(env.DB);
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
}

async function seedAdmin(): Promise<Staff> {
  const admin = await createAdmin({
    fetcher,
    readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
    assignAdminRole: async (userId) => {
      await assignRoleByName({ db: getDb(env), kv: env.SESSIONS, env }, { userId, roleName: "admin" });
    },
    origin: ORIGIN,
  });
  const { id }: { id: string } = await (await admin.session.fetch("/me")).json();
  return { userId: id, session: admin.session };
}

async function invite(by: RunwaySession, role: string, email: string, displayName: string): Promise<Staff> {
  const res = await by.fetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, display_name: displayName, role }),
  });
  expect(res.status).toBe(201);
  const body: { user: { id: string }; activation_url: string } = await res.json();
  const token = new URL(body.activation_url).searchParams.get("token")!;
  const act = await fetcher(`${ORIGIN}/auth/activate`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token, password: PASSWORD }),
  });
  expect(act.status).toBe(204);
  const cookies = await loginAs(fetcher, { email, password: PASSWORD, origin: ORIGIN });
  return { userId: body.user.id, session: createSession({ userId: body.user.id, email, ...cookies, fetcher, origin: ORIGIN }) };
}

const patch = (s: RunwaySession, id: string, body: Record<string, unknown>) =>
  s.fetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });

async function rolesOf(s: RunwaySession): Promise<string[]> {
  const body: { roles: string[] } = await (await s.fetch("/me")).json();
  return body.roles;
}

async function denials(): Promise<Array<{ actor: string; target: string; metadata: Record<string, unknown> }>> {
  const rows = await env.DB.prepare(
    "SELECT actor, target, metadata FROM audit_events WHERE action = 'permission.denied' ORDER BY ts",
  ).all<{ actor: string; target: string; metadata: string | null }>();
  return rows.results.map((r) => ({ actor: r.actor, target: r.target, metadata: JSON.parse(r.metadata ?? "{}") as Record<string, unknown> }));
}

async function expectRule(res: Response, rule: string): Promise<void> {
  expect(res.status).toBe(403);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body: { type: string; rule?: string } = await res.json();
  expect(body.type).toContain("forbidden");
  expect(body.rule).toBe(rule);
}

describe("FIX-03 — no self-escalation via PATCH /admin/users/{id}", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("Giám đốc cannot make themselves admin → 403 self_role, one permission.denied row, role unchanged", async () => {
    const admin = await seedAdmin();
    const gd = await invite(admin.session, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");

    await expectRule(await patch(gd.session, gd.userId, { role: "admin" }), "self_role");
    expect(await rolesOf(gd.session)).toEqual(["giam_doc"]);
    const rows = await denials();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: gd.userId, target: `user:${gd.userId}` });
    expect(rows[0]?.metadata).toMatchObject({ rule: "self_role", permission: "users:write" });

    // any own-role change, not only upwards
    await expectRule(await patch(gd.session, gd.userId, { role: "quan_ly" }), "self_role");
    expect(await rolesOf(gd.session)).toEqual(["giam_doc"]);
    // own display name is still editable
    expect((await patch(gd.session, gd.userId, { display_name: "Minh N." })).status).toBe(200);
  });

  it("Giám đốc cannot assign admin to someone else → 403 admin_only; other role changes still work", async () => {
    const admin = await seedAdmin();
    const gd = await invite(admin.session, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
    const ql = await invite(admin.session, "quan_ly", "vi@nhatminh.vn", "Tường Vi");

    await expectRule(await patch(gd.session, ql.userId, { role: "admin" }), "admin_only");
    expect(await rolesOf(ql.session)).toEqual(["quan_ly"]);
    const rows = await denials();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: gd.userId, target: `user:${ql.userId}` });
    expect(rows[0]?.metadata).toMatchObject({ rule: "admin_only", permission: "users:write" });

    expect((await patch(gd.session, ql.userId, { role: "nhan_vien" })).status).toBe(200);
    expect(await rolesOf(ql.session)).toEqual(["nhan_vien"]);
  });

  it("admin may assign admin to another user, but not change their own role (self_role, not last-admin)", async () => {
    const admin = await seedAdmin();
    const ql = await invite(admin.session, "quan_ly", "vi@nhatminh.vn", "Tường Vi");

    const promote = await patch(admin.session, ql.userId, { role: "admin" });
    expect(promote.status).toBe(200);
    expect(await rolesOf(ql.session)).toEqual(["admin"]);

    // two admins now — the self change is still refused by the self rule
    await expectRule(await patch(admin.session, admin.userId, { role: "giam_doc" }), "self_role");
    expect(await rolesOf(admin.session)).toEqual(["admin"]);
    expect(await denials()).toHaveLength(1);
  });

  it("Giám đốc cannot demote, disable or rename another admin → 403 admin_only each, one row each, nothing changes", async () => {
    const admin = await seedAdmin();
    const gd = await invite(admin.session, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
    const second = await invite(admin.session, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
    expect((await patch(admin.session, second.userId, { role: "admin" })).status).toBe(200);

    await expectRule(await patch(gd.session, second.userId, { role: "nhan_vien" }), "admin_only");
    await expectRule(await patch(gd.session, second.userId, { status: "disabled" }), "admin_only");
    await expectRule(await patch(gd.session, second.userId, { display_name: "Đổi tên" }), "admin_only");

    expect(await rolesOf(second.session)).toEqual(["admin"]); // still active (session works) and still admin
    const row = await env.DB.prepare("SELECT display_name, status FROM users WHERE id = ?").bind(second.userId).first();
    expect(row).toMatchObject({ display_name: "Tường Vi", status: "active" });
    const rows = await denials();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toMatchObject({ actor: gd.userId, target: `user:${second.userId}` });
      expect(r.metadata).toMatchObject({ rule: "admin_only", permission: "users:write" });
    }

    // an admin still manages another admin
    expect((await patch(admin.session, second.userId, { role: "quan_ly" })).status).toBe(200);
  });
});
