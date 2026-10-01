/**
 * FIX-05 — "Giám đốc = owner, admin = IT ops" (closes the sockpuppet-admin four-eyes bypass and the giam_doc deadlock).
 *   R1. A giam_doc holder may approve ADDING codes to giam_doc (own_role does not apply to the owner's own role).
 *   R2. The `admin` role changes through a change request; only a giam_doc holder (≠ requester) approves it
 *       (403 `owner_only` for anyone else). Admin may propose.
 *   R3. Inviting / assigning a role that carries `roles:write` (admin, giam_doc, custom) → giam_doc holders only
 *       (403 `owner_only` + one permission.denied). Admin still invites Quản lý / Nhân viên.
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

/** Seed grants (0001 + 0010 + 0017 + 0020 + 0022 + 0025) — restored after each test (approvals mutate roles). */
const SEED_GRANTS: Record<string, string[]> = {
  admin: [
    "audit:read",
    "flags:read",
    "flags:write",
    "notes:read",
    "notes:write",
    "roles:write",
    "settings:read",
    "settings:write",
    "users:read",
    "users:write",
  ],
  giam_doc: [
    "audit:read",
    "contract:approve",
    "contract:issue",
    "contract:read",
    "contract:submit",
    "contract:write",
    "delivery_note:write",
    "jit:grant",
    "payment_request:write",
    "price:write",
    "product:write",
    "quote:write",
    "reviews:write",
    "roles:write",
    "template:write",
    "users:read",
    "users:write",
  ],
  quan_ly: [
    "audit:read",
    "contract:approve",
    "contract:issue",
    "contract:read",
    "contract:submit",
    "contract:write",
    "delivery_note:write",
    "payment_request:write",
    "price:write",
    "product:write",
    "quote:write",
  ],
};

interface Person {
  userId: string;
  email: string;
  session: RunwaySession;
}

interface RoleDto {
  id: string;
  name: string;
  version: number;
  permissions: string[];
  can: { edit: boolean; delete: boolean; request: boolean };
  locked_reason: string | null;
  request_locked_reason: string | null;
}

interface ChangeRequestDto {
  id: string;
  status: string;
  can: { approve: boolean; reject: boolean; withdraw: boolean };
  locked_reason: string | null;
}

async function restoreSeedRoles(): Promise<void> {
  await env.DB.prepare("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'r\\_%' ESCAPE '\\')").run();
  await env.DB.prepare("DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'r\\_%' ESCAPE '\\')").run();
  await env.DB.prepare("DELETE FROM roles WHERE name LIKE 'r\\_%' ESCAPE '\\'").run();
  for (const [role, keys] of Object.entries(SEED_GRANTS)) {
    const marks = keys.map(() => "?").join(",");
    await env.DB.prepare(
      `DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = ?) AND permission_id NOT IN (SELECT id FROM permissions WHERE key IN (${marks}))`,
    )
      .bind(role, ...keys)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = ? AND p.key IN (${marks})`,
    )
      .bind(role, ...keys)
      .run();
  }
  await env.DB.prepare("UPDATE roles SET version = 1").run();
}

async function resetDb(): Promise<void> {
  await clearAuditEvents(env.DB);
  for (const table of ["access_review_items", "access_reviews", "role_change_requests", "sod_pairs", "jit_grants", "idempotency_keys"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
  await restoreSeedRoles();
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

const inviteRaw = (by: Person, role: string, email: string, displayName: string) =>
  by.session.fetch("/admin/users", { method: "POST", body: JSON.stringify({ email, display_name: displayName, role }) });

async function invite(by: Person, role: string, email: string, displayName: string): Promise<Person> {
  const res = await inviteRaw(by, role, email, displayName);
  expect(res.status, `invite ${email} as ${role}`).toBe(201);
  const body: { user: { id: string }; activation_url: string } = await res.json();
  const token = new URL(body.activation_url).searchParams.get("token");
  const act = await fetcher(`${ORIGIN}/auth/activate`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token, password: PASSWORD }),
  });
  expect(act.status).toBe(204);
  const cookies = await loginAs(fetcher, { email, password: PASSWORD, origin: ORIGIN });
  return { userId: body.user.id, email, session: createSession({ userId: body.user.id, email, ...cookies, fetcher, origin: ORIGIN }) };
}

const patchUser = (by: Person, id: string, body: Record<string, unknown>) =>
  by.session.fetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });

async function role(by: Person, name: string): Promise<RoleDto> {
  const res = await by.session.fetch("/roles");
  expect(res.status).toBe(200);
  const r = (await res.json<{ items: RoleDto[] }>()).items.find((x) => x.name === name);
  expect(r, `role ${name}`).toBeDefined();
  return r!;
}

const requestChangeRaw = (by: Person, r: RoleDto, permissions: string[]) =>
  by.session.fetch(`/roles/${r.id}/change-requests`, {
    method: "POST",
    body: JSON.stringify({ expected_version: r.version, permissions }),
  });

async function requestChange(by: Person, r: RoleDto, permissions: string[]): Promise<ChangeRequestDto> {
  const res = await requestChangeRaw(by, r, permissions);
  expect(res.status, `change request on ${r.name}`).toBe(201);
  return res.json();
}

const approve = (by: Person, id: string) =>
  by.session.fetch(`/role-change-requests/${id}/approve`, { method: "POST", body: JSON.stringify({}) });

async function requestAs(by: Person, id: string): Promise<ChangeRequestDto> {
  const res = await by.session.fetch("/role-change-requests");
  expect(res.status).toBe(200);
  return (await res.json<{ items: ChangeRequestDto[] }>()).items.find((r) => r.id === id)!;
}

async function rolePermsInDb(name: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT p.key AS k FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id WHERE r.name = ? ORDER BY p.key",
  )
    .bind(name)
    .all<{ k: string }>();
  return rows.results.map((r) => r.k);
}

async function rolesOfUser(userId: string): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT r.name AS name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?")
    .bind(userId)
    .all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

async function denials(actor: string): Promise<Array<{ target: string; metadata: Record<string, unknown> }>> {
  const rows = await env.DB.prepare(
    "SELECT target, metadata FROM audit_events WHERE action = 'permission.denied' AND actor = ? ORDER BY ts",
  )
    .bind(actor)
    .all<{ target: string; metadata: string | null }>();
  return rows.results.map((r) => ({ target: r.target, metadata: JSON.parse(r.metadata ?? "{}") as Record<string, unknown> }));
}

async function problemOf(res: Response, status: number, slug: string): Promise<{ type: string; rule?: string }> {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body: { type: string; rule?: string } = await res.json();
  expect(body.type.endsWith(`/${slug}`), `type ${body.type} ends with /${slug}`).toBe(true);
  return body;
}

async function expectRule(res: Response, rule: string): Promise<void> {
  expect((await problemOf(res, 403, "forbidden")).rule).toBe(rule);
}

const without = (xs: string[], ...drop: string[]) => xs.filter((x) => !drop.includes(x));

async function team(): Promise<{ admin: Person; gd: Person; ql: Person }> {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  return { admin, gd, ql };
}

describe("FIX-05 — Giám đốc owns roles:write; admin is IT ops", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("R3: once a Giám đốc exists, admin cannot invite or assign a role carrying roles:write (admin, giam_doc, custom) nor change the Giám đốc's role → 403 owner_only + one denied row each; Quản lý / Nhân viên still fine", async () => {
    const { admin, gd, ql } = await team();
    const usersBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();

    await expectRule(await inviteRaw(admin, "admin", "puppet@nhatminh.vn", "Bù Nhìn"), "owner_only");
    await expectRule(await inviteRaw(admin, "giam_doc", "puppet2@nhatminh.vn", "Bù Nhìn 2"), "owner_only");
    await expectRule(await patchUser(admin, ql.userId, { role: "admin" }), "owner_only");
    await expectRule(await patchUser(admin, ql.userId, { role: "giam_doc" }), "owner_only");

    // a custom role that carries roles:write (Giám đốc makes it — they hold every code in it)
    const created = await gd.session.fetch("/roles", {
      method: "POST",
      body: JSON.stringify({ label: "Phân quyền phụ", permissions: ["roles:write", "users:read"] }),
    });
    expect(created.status).toBe(201);
    const custom: RoleDto = await created.json();
    await expectRule(await inviteRaw(admin, custom.name, "puppet3@nhatminh.vn", "Bù Nhìn 3"), "owner_only");
    await expectRule(await patchUser(admin, ql.userId, { role: custom.name }), "owner_only");
    // nor remove the Giám đốc (that would reopen the first-Giám-đốc bootstrap that let team() invite them)
    await expectRule(await patchUser(admin, gd.userId, { role: "nhan_vien" }), "owner_only");
    expect(await rolesOfUser(gd.userId)).toEqual(["giam_doc"]);

    const rows = await denials(admin.userId);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ target: "user:new", metadata: { rule: "owner_only", permission: "users:write", role: "admin" } });
    expect(rows[2]).toMatchObject({ target: `user:${ql.userId}`, metadata: { rule: "owner_only", role: "admin" } });
    expect(await rolesOfUser(ql.userId)).toEqual(["quan_ly"]);
    const usersAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(usersAfter?.n).toBe(usersBefore?.n);

    // IT ops keeps managing ordinary staff
    expect((await inviteRaw(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh")).status).toBe(201);
    expect((await patchUser(admin, ql.userId, { role: "nhan_vien" })).status).toBe(200);
  }, 60_000);

  it("R3: Giám đốc invites / assigns admin → 201 / 200; still never their own role (self_role)", async () => {
    const { gd, ql } = await team();
    const it2 = await invite(gd, "admin", "it2@nhatminh.vn", "Quản trị 2");
    expect(await rolesOfUser(it2.userId)).toEqual(["admin"]);
    expect((await patchUser(gd, ql.userId, { role: "admin" })).status).toBe(200);
    expect(await rolesOfUser(ql.userId)).toEqual(["admin"]);
    await expectRule(await patchUser(gd, gd.userId, { role: "admin" }), "self_role");
    expect(await rolesOfUser(gd.userId)).toEqual(["giam_doc"]);
  }, 60_000);

  it("R1: admin requests +settings:read on giam_doc → 201 (no deadlock); Giám đốc approves → 200, the code lands", async () => {
    const { admin, gd } = await team();
    const gdRole = await role(admin, "giam_doc");
    expect(gdRole.can.request).toBe(true);
    expect(gdRole.request_locked_reason).toBeNull();

    const req = await requestChange(admin, gdRole, [...gdRole.permissions, "settings:read"]);
    const asGd = await requestAs(gd, req.id);
    expect(asGd).toMatchObject({ can: { approve: true }, locked_reason: null });
    const res = await approve(gd, req.id);
    expect(res.status).toBe(200);
    expect(await rolePermsInDb("giam_doc")).toContain("settings:read");
  }, 60_000);

  it("R2: admin proposes a change to the admin role → 201; another admin cannot approve (owner_only); Giám đốc approves → 200", async () => {
    const { admin, gd } = await team();
    const admin2 = await invite(gd, "admin", "it2@nhatminh.vn", "Quản trị 2");

    const adminRole = await role(admin, "admin");
    expect(adminRole.can.request).toBe(true);
    const req = await requestChange(admin, adminRole, without(adminRole.permissions, "notes:write"));

    const asAdmin2 = await requestAs(admin2, req.id);
    expect(asAdmin2).toMatchObject({ can: { approve: false }, locked_reason: "owner_only" });
    await expectRule(await approve(admin2, req.id), "owner_only");
    const rows = await denials(admin2.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ target: `role:${adminRole.id}`, metadata: { rule: "owner_only", permission: "roles:write" } });
    expect(await rolePermsInDb("admin")).toContain("notes:write");

    expect((await requestAs(gd, req.id)).can.approve).toBe(true);
    expect((await approve(gd, req.id)).status).toBe(200);
    expect(await rolePermsInDb("admin")).not.toContain("notes:write");
  }, 60_000);

  it("R2: Giám đốc is the only owner → their own request on the admin role has no approver (409, and GET /roles says so)", async () => {
    const { gd } = await team();
    const adminRole = await role(gd, "admin");
    expect(adminRole.can.request).toBe(false);
    expect(adminRole.request_locked_reason).toBe("no_approver");
    await problemOf(await requestChangeRaw(gd, adminRole, without(adminRole.permissions, "notes:write")), 409, "no-eligible-approver");
  }, 60_000);

  it("unchanged for other roles: Giám đốc requests +jit:grant on quan_ly, admin approves → 200", async () => {
    const { admin, gd } = await team();
    const qlRole = await role(gd, "quan_ly");
    const req = await requestChange(gd, qlRole, [...qlRole.permissions, "jit:grant"]);
    expect((await approve(admin, req.id)).status).toBe(200);
    expect(await rolePermsInDb("quan_ly")).toContain("jit:grant");
  }, 60_000);
});
