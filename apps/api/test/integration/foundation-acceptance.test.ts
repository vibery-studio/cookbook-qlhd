/**
 * SPEC-01 acceptance (AC-1 … AC-8): roles, invite-only users, in-app audit, customers, price list.
 * Written before the code (PLAN-01 §1). Calls the API exactly as SPEC-01 §3 says; the tables this row
 * adds are touched only through raw SQL so the file compiles before the schema exists.
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CSRF_HEADERS,
  createAdmin,
  createSession,
  loginAs,
  readLastVerifyToken,
  truncateTables,
  type RunwaySession,
} from "@runway/test-fixtures";
import { getDb } from "../../src/db/client";
import {
  jwtRevocations,
  refreshTokens,
  userRoles,
  users,
  verificationTokens,
} from "../../src/db/schema";
import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import { assignRoleByName } from "../../src/services/admin-service";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);

type Role = "giam_doc" | "quan_ly" | "nhan_vien";
interface Staff {
  userId: string;
  email: string;
  session: RunwaySession;
}

async function resetDb(): Promise<void> {
  for (const table of ["audit_events", "customers"]) {
    try {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // table not created yet (red run) — the assertions below report the real failure
    }
  }
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
}

/** The seeded technical account (DEC-1). */
async function seedAdmin(): Promise<RunwaySession> {
  const admin = await createAdmin({
    fetcher,
    readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
    assignAdminRole: async (userId) => {
      await assignRoleByName({ db: getDb(env), kv: env.SESSIONS, env }, { userId, roleName: "admin" });
    },
    origin: ORIGIN,
  });
  return admin.session;
}

async function inviteRaw(by: RunwaySession, body: Record<string, unknown>): Promise<Response> {
  return by.fetch("/admin/users", { method: "POST", body: JSON.stringify(body) });
}

async function activate(token: string, password = PASSWORD): Promise<Response> {
  return fetcher(`${ORIGIN}/auth/activate`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token, password }),
  });
}

/** Invite → activate through the link → log in. */
async function invite(by: RunwaySession, role: Role, email: string, displayName: string): Promise<Staff> {
  const res = await inviteRaw(by, { email, display_name: displayName, role });
  expect(res.status).toBe(201);
  const body: { user: { id: string }; activation_url: string } = await res.json();
  const token = new URL(body.activation_url).searchParams.get("token");
  expect(token).toBeTruthy();
  expect((await activate(token!)).status).toBe(204);
  const cookies = await loginAs(fetcher, { email, password: PASSWORD, origin: ORIGIN });
  const session = createSession({ userId: body.user.id, email, ...cookies, fetcher, origin: ORIGIN });
  return { userId: body.user.id, email, session };
}

async function team() {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
  return { admin, gd, ql, nv };
}

async function me(s: RunwaySession): Promise<{ roles: string[]; permissions: string[] }> {
  const res = await s.fetch("/me");
  expect(res.status).toBe(200);
  return res.json();
}

const CONTRACT_PERMS = ["contract:read", "contract:write", "contract:submit"];
const APPROVER_PERMS = [...CONTRACT_PERMS, "contract:approve", "contract:issue", "audit:read"];

describe("SPEC-01 foundation (acceptance)", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("AC-1: admin invites the 3 roles; each activates and carries exactly the mockup's permissions", async () => {
    const { admin, gd, ql, nv } = await team();

    const gdMe = await me(gd.session);
    expect(gdMe.roles).toEqual(["giam_doc"]);
    expect([...gdMe.permissions].sort()).toEqual(
      [...APPROVER_PERMS, "template:write", "users:read", "users:write"].sort(),
    );
    const qlMe = await me(ql.session);
    expect(qlMe.roles).toEqual(["quan_ly"]);
    expect([...qlMe.permissions].sort()).toEqual([...APPROVER_PERMS].sort());
    const nvMe = await me(nv.session);
    expect(nvMe.roles).toEqual(["nhan_vien"]);
    expect([...nvMe.permissions].sort()).toEqual([...CONTRACT_PERMS].sort());

    const adminMe = await me(admin);
    expect(adminMe.roles).toEqual(["admin"]);
    expect(adminMe.permissions).toContain("users:write");
    expect(adminMe.permissions).toContain("audit:read");
    expect(adminMe.permissions.filter((p) => p.startsWith("contract:") || p === "template:write")).toEqual([]);

    const roles = await nv.session.fetch("/roles");
    expect(roles.status).toBe(200);
    const matrix: { items: Array<{ name: string; permissions: string[] }> } = await roles.json();
    expect(matrix.items.find((r) => r.name === "nhan_vien")?.permissions.sort()).toEqual([...CONTRACT_PERMS].sort());

    const list = await admin.fetch("/admin/users");
    const body: { items: Array<{ email: string; display_name: string | null; roles: string[] }> } = await list.json();
    expect(body.items.find((u) => u.email === "khanh@nhatminh.vn")).toMatchObject({
      display_name: "Minh Khánh",
      roles: ["nhan_vien"],
    });
  });

  it("AC-1: duplicate email → 409; unknown role → 422", async () => {
    const admin = await seedAdmin();
    await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
    expect((await inviteRaw(admin, { email: " KHANH@nhatminh.vn ", display_name: "X", role: "nhan_vien" })).status).toBe(409);
    expect((await inviteRaw(admin, { email: "a@nhatminh.vn", display_name: "A", role: "admin_super" })).status).toBe(422);
  });

  it("AC-2: public signup is off by default; a used or expired activation link → 400", async () => {
    // test setup re-enables signup for the RUNWAY fixtures; it records the migrated default first
    expect((globalThis as { __SIGNUP_DEFAULT__?: number }).__SIGNUP_DEFAULT__).toBe(0);

    const admin = await seedAdmin();
    const res = await inviteRaw(admin, { email: "a@nhatminh.vn", display_name: "A", role: "nhan_vien" });
    const { activation_url }: { activation_url: string } = await res.json();
    const token = new URL(activation_url).searchParams.get("token")!;
    expect((await activate(token)).status).toBe(204);
    expect((await activate(token)).status).toBe(400);

    const res2 = await inviteRaw(admin, { email: "b@nhatminh.vn", display_name: "B", role: "nhan_vien" });
    const body2: { activation_url: string } = await res2.json();
    const token2 = new URL(body2.activation_url).searchParams.get("token")!;
    await env.DB.prepare("UPDATE verification_tokens SET expires_at = 1 WHERE purpose = 'invite' AND used_at IS NULL").run();
    expect((await activate(token2)).status).toBe(400);
  });

  it("AC-3: a role change and a disable take effect on the very next request", async () => {
    const { admin, ql } = await team();
    expect((await ql.session.fetch("/audit")).status).toBe(200);

    const demote = await admin.fetch(`/admin/users/${ql.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "nhan_vien" }),
    });
    expect(demote.status).toBe(200);
    expect((await ql.session.fetch("/audit")).status).toBe(403);

    const disable = await admin.fetch(`/admin/users/${ql.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(disable.status).toBe(200);
    expect((await ql.session.fetch("/me")).status).toBe(401);
  });

  it("AC-4: the last active admin cannot disable or re-role themselves", async () => {
    const admin = await seedAdmin();
    const { id }: { id: string } = await (await admin.fetch("/me")).json();
    const off = await admin.fetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ status: "disabled" }) });
    expect(off.status).toBe(409);
    const offBody: { type: string } = await off.json();
    expect(offBody.type).toContain("last-admin");
    // FIX-03 (SPEC-06 DEC-5): changing your own role is refused before the last-admin guard → 403 self_role
    const rerole = await admin.fetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role: "giam_doc" }) });
    expect(rerole.status).toBe(403);
    const reroleBody: { rule?: string } = await rerole.json();
    expect(reroleBody.rule).toBe("self_role");
  });

  it("AC-5: a refused call is written to the audit log and readable, newest first", async () => {
    const { gd, nv } = await team();
    const refused = await nv.session.fetch("/audit", { headers: { "cf-connecting-ip": "203.0.113.7" } });
    expect(refused.status).toBe(403);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");

    const res = await gd.session.fetch("/audit?action=permission.denied");
    expect(res.status).toBe(200);
    const body: {
      items: Array<{ ts: number; actor: string; actor_name: string; action: string; metadata: Record<string, unknown>; ip: string }>;
    } = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      actor: nv.userId,
      actor_name: "Minh Khánh",
      action: "permission.denied",
      ip: "203.0.113.7",
    });
    expect(body.items[0]?.metadata).toMatchObject({ permission: "audit:read" });

    // every event lands (DEC-3): logins are there too, newest first
    const all: { items: Array<{ ts: number; action: string }> } = await (await gd.session.fetch("/audit")).json();
    expect(all.items.some((e) => e.action === "auth.login")).toBe(true);
    const ts = all.items.map((e) => e.ts);
    expect(ts).toEqual([...ts].sort((a, b) => b - a));
  });

  it("AC-6: customers — duplicate phone blocked with the existing id; concurrent edit → one 409; audit has no PII", async () => {
    const { nv, gd } = await team();
    const created = await nv.session.fetch("/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Tạp hóa Cô Ba", contact_person: "Trần Thị Ba", phone: "0901 234 567", email: "coba@example.com" }),
    });
    expect(created.status).toBe(201);
    const c: { id: string; version: number } = await created.json();

    const dup = await nv.session.fetch("/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Cô Ba (chi nhánh)", phone: "+84901234567" }),
    });
    expect(dup.status).toBe(409);
    const dupBody: { existing_id: string } = await dup.json();
    expect(dupBody.existing_id).toBe(c.id);

    const edit = (address: string) =>
      nv.session.fetch(`/customers/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ address, expected_version: c.version }),
      });
    const first = await edit("12 Lê Lợi, Q.1");
    expect(first.status).toBe(200);
    const second = await edit("99 Hai Bà Trưng, Q.3");
    expect(second.status).toBe(409);

    const got: { address: string } = await (await nv.session.fetch(`/customers/${c.id}`)).json();
    expect(got.address).toBe("12 Lê Lợi, Q.1");

    const log: { items: Array<{ action: string; target: string; metadata: unknown }> } = await (
      await gd.session.fetch(`/audit?target=customer:${c.id}`)
    ).json();
    expect(log.items.map((e) => e.action).sort()).toEqual(["customer.created", "customer.updated"]);
    const raw = JSON.stringify(log.items);
    expect(raw).not.toContain("0901");
    expect(raw).not.toContain("coba@example.com");
    expect(raw).not.toContain("Lê Lợi");
  });

  it("AC-6: search by name / phone; no DELETE route", async () => {
    const { nv } = await team();
    await nv.session.fetch("/customers", { method: "POST", body: JSON.stringify({ name: "Nhà thuốc An Khang", phone: "0908 111 222" }) });
    await nv.session.fetch("/customers", { method: "POST", body: JSON.stringify({ name: "Cà phê Góc Phố", phone: "0908 333 444" }) });
    const byName: { items: Array<{ name: string }> } = await (await nv.session.fetch("/customers?q=an%20khang")).json();
    expect(byName.items.map((x) => x.name)).toEqual(["Nhà thuốc An Khang"]);
    const byPhone: { items: Array<{ name: string }> } = await (await nv.session.fetch("/customers?q=0908333444")).json();
    expect(byPhone.items.map((x) => x.name)).toEqual(["Cà phê Góc Phố"]);
    const first: { items: Array<{ id: string }> } = await (await nv.session.fetch("/customers")).json();
    const del = await nv.session.fetch(`/customers/${first.items[0]!.id}`, { method: "DELETE" });
    expect([404, 405]).toContain(del.status);
  });

  it("AC-7: the price list answers by date in the business zone", async () => {
    const { nv } = await team();
    const at = async (date?: string) => {
      const res = await nv.session.fetch(date ? `/price-list?date=${date}` : "/price-list");
      expect(res.status).toBe(200);
      const body: { date: string; items: Array<{ code: string; unit_price: number }> } = await res.json();
      return body;
    };
    const june = await at("2026-06-30");
    expect(june.items.find((p) => p.code === "G6")?.unit_price).toBe(2_400_000);
    const july = await at("2026-07-01");
    expect(july.items.find((p) => p.code === "G6")?.unit_price).toBe(2_700_000);
    expect(july.items.find((p) => p.code === "G12")?.unit_price).toBe(4_800_000);
    expect(july.items.find((p) => p.code === "DT14")?.unit_price).toBe(0);
    expect(july.items.filter((p) => p.code === "G6")).toHaveLength(1);

    const today = await at();
    const vnToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    expect(today.date).toBe(vnToday);

    expect((await nv.session.fetch("/price-list?date=2026-13-40")).status).toBe(422);
  });

  it("AC-8: not logged in → 401 with no data; nhan_vien inviting → 403 + permission.denied", async () => {
    for (const path of ["/customers", "/audit", "/price-list", "/admin/users", "/roles"]) {
      const res = await fetcher(`${ORIGIN}${path}`);
      expect(res.status, path).toBe(401);
      expect(await res.text()).not.toContain("items");
    }
    const { gd, nv } = await team();
    const res = await inviteRaw(nv.session, { email: "x@nhatminh.vn", display_name: "X", role: "giam_doc" });
    expect(res.status).toBe(403);
    const log: { items: Array<{ actor: string; metadata: Record<string, unknown> }> } = await (
      await gd.session.fetch("/audit?action=permission.denied")
    ).json();
    expect(log.items[0]).toMatchObject({ actor: nv.userId, metadata: { permission: "users:write" } });
  });
});
