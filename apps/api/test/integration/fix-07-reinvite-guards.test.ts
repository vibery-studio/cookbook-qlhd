/**
 * FIX-07 — re-inviting a pending account is the same escalation as inviting/assigning its roles: a non-owner must not mint an
 * activation link for a pending Giám đốc / admin / `roles:write` account (activation takeover). The row's `can.reinvite` /
 * `locked_reason.reinvite` come from the same rule.
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

interface Person {
  userId: string;
  email: string;
  session: RunwaySession;
}

async function resetDb(): Promise<void> {
  await clearAuditEvents(env.DB);
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
}

async function seedAdmin(): Promise<Person> {
  const admin = await createAdmin({
    fetcher,
    readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
    assignAdminRole: async (userId) => {
      await assignRoleByName({ db: getDb(env), kv: env.SESSIONS, env }, { userId, roleName: "admin" });
    },
    origin: ORIGIN,
  });
  return { userId: admin.userId, email: admin.session.email, session: admin.session };
}

const inviteRaw = (by: Person, role: string, email: string) =>
  by.session.fetch("/admin/users", { method: "POST", body: JSON.stringify({ email, display_name: email, role }) });

async function activeUser(by: Person, role: string, email: string): Promise<Person> {
  const p = await invitePending(by, role, email);
  const act = await fetcher(`${ORIGIN}/auth/activate`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token: p.token, password: PASSWORD }),
  });
  expect(act.status).toBe(204);
  const cookies = await loginAs(fetcher, { email, password: PASSWORD, origin: ORIGIN });
  return { userId: p.userId, email, session: createSession({ userId: p.userId, email, ...cookies, fetcher, origin: ORIGIN }) };
}

async function invitePending(by: Person, role: string, email: string): Promise<{ userId: string; token: string }> {
  const res = await inviteRaw(by, role, email);
  expect(res.status, `invite ${email} as ${role}`).toBe(201);
  const body: { user: { id: string }; activation_url: string } = await res.json();
  return { userId: body.user.id, token: new URL(body.activation_url).searchParams.get("token") ?? "" };
}

const reinvite = (by: Person, id: string) => by.session.fetch(`/admin/users/${id}/invite`, { method: "POST" });

interface Row {
  id: string;
  can: { reinvite: boolean };
  locked_reason: { reinvite: string | null };
}

describe("FIX-07 — reinvite obeys the assign guards", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("admin cannot re-invite a pending giam_doc / admin; owner can; nhan_vien still fine", async () => {
    const admin = await seedAdmin();
    const gd = await activeUser(admin, "giam_doc", "minh@nhatminh.vn"); // bootstrap: first owner
    const pendingGd = await invitePending(gd, "giam_doc", "gd2@nhatminh.vn");
    const pendingAdmin = await invitePending(gd, "admin", "it@nhatminh.vn");
    const pendingNv = await invitePending(admin, "nhan_vien", "nv@nhatminh.vn");

    for (const victim of [pendingGd, pendingAdmin]) {
      const res = await reinvite(admin, victim.userId);
      expect(res.status).toBe(403);
      const problem: { rule: string } = await res.json();
      expect(problem.rule).toBe("owner_only");
    }
    const denied = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'permission.denied' AND actor = ?").bind(admin.userId).first<{ n: number }>();
    expect(denied?.n).toBe(2);

    // the old (first) link of the victim is still the only live one — nothing was minted
    const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM verification_tokens WHERE user_id = ? AND used_at IS NULL").bind(pendingGd.userId).first<{ n: number }>();
    expect(live?.n).toBe(1);

    // the screen says the same
    const page: { items: Row[] } = await (await admin.session.fetch("/admin/users?limit=100")).json();
    const byId = new Map(page.items.map((r) => [r.id, r]));
    expect(byId.get(pendingGd.userId)?.can.reinvite).toBe(false);
    expect(byId.get(pendingGd.userId)?.locked_reason.reinvite).toBe("owner_only");
    expect(byId.get(pendingAdmin.userId)?.locked_reason.reinvite).toBe("owner_only");
    expect(byId.get(pendingNv.userId)?.can.reinvite).toBe(true);
    expect(byId.get(pendingNv.userId)?.locked_reason.reinvite).toBeNull();

    // controls
    expect((await reinvite(admin, pendingNv.userId)).status).toBe(200);
    expect((await reinvite(gd, pendingGd.userId)).status).toBe(200);
    expect((await reinvite(gd, pendingAdmin.userId)).status).toBe(200);
  });
});
