/**
 * FIX-06 — every lock the web shows is decided by the API with the SAME rules the write guards use. Each case reads the
 * computed field (`GET /roles` `can.grant` / `grantable`, `GET /admin/users` `can` / `locked_reason` / `role_options` /
 * `invite_roles`) and then performs the write: a locked answer → the guard refuses with that rule; an open one → it passes.
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
  can: { edit: boolean; delete: boolean; request: boolean; direct: boolean; grant: string[] };
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

interface Option {
  name: string;
  label: string;
  locked_reason: string | null;
}

interface UserRow {
  id: string;
  status: string;
  roles: string[];
  can: { change_role: boolean; set_status: boolean; reinvite: boolean; grant_jit: boolean; revoke_jit: boolean };
  locked_reason: { change_role: string | null; set_status: string | null; grant_jit: string | null };
  role_options: Option[];
  jit_grant: { id: string; expires_at: number } | null;
}

interface UsersPage {
  items: UserRow[];
  invite_roles: Option[];
}

async function usersPage(by: Person): Promise<UsersPage> {
  const res = await by.session.fetch("/admin/users?limit=100");
  expect(res.status).toBe(200);
  return res.json();
}

const row = (page: UsersPage, id: string): UserRow => {
  const r = page.items.find((u) => u.id === id);
  expect(r, `user ${id}`).toBeDefined();
  return r!;
};

const lockOf = (options: Option[], name: string) => options.find((o) => o.name === name)?.locked_reason;

async function ruleOf(res: Response): Promise<string | undefined> {
  return (await res.json<{ rule?: string }>()).rule;
}

const grantJit = (by: Person, userId: string) =>
  by.session.fetch("/admin/jit-grants", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, reason: "Sửa sự cố cấu hình email", minutes: 30 }),
  });

describe("FIX-06 — locks come from the API, from the guards' own rules", () => {
  beforeEach(async () => {
    _resetJtiCache();
    resetNoopEmailBuffer();
    await resetDb();
  });

  it("roles: admin lacks contract:issue → not in can.grant / grantable, and adding it → 403 grant_not_held; a held code → allowed", async () => {
    const admin = await seedAdmin();
    await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
    const res = await admin.session.fetch("/roles");
    const body = await res.json<{ items: RoleDto[]; grantable: string[] }>();
    expect(body.grantable).toContain("settings:read");
    expect(body.grantable).not.toContain("contract:issue");

    const nv = body.items.find((r) => r.name === "nhan_vien")!;
    expect(nv.permissions).not.toContain("contract:issue");
    expect(nv.can.grant).not.toContain("contract:issue");
    expect(nv.can.grant).toContain("settings:read");
    expect(nv.can.grant.some((k) => nv.permissions.includes(k))).toBe(false); // only codes it does not hold yet

    const refused = await requestChangeRaw(admin, nv, [...nv.permissions, "contract:issue"]);
    expect(refused.status).toBe(403);
    expect(await ruleOf(refused)).toBe("grant_not_held");
    const clone = await admin.session.fetch("/roles", { method: "POST", body: JSON.stringify({ label: "Bản sao", permissions: ["contract:issue"] }) });
    expect(clone.status).toBe(403);
    expect(await ruleOf(clone)).toBe("grant_not_held");

    await requestChange(admin, nv, [...nv.permissions, "settings:read"]);
  });

  it("users as admin: invite_roles / role_options / row locks = the PATCH + invite guards (owner_only, self_role, self_disable)", async () => {
    const admin = await seedAdmin();
    const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
    const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
    const page = await usersPage(admin);

    expect(page.invite_roles.map((o) => o.name)).not.toContain("member");
    expect(page.invite_roles.map((o) => o.name)).not.toContain("root");
    expect(lockOf(page.invite_roles, "admin")).toBe("owner_only");
    expect(lockOf(page.invite_roles, "giam_doc")).toBe("owner_only");
    expect(lockOf(page.invite_roles, "quan_ly")).toBeNull();
    expect(lockOf(page.invite_roles, "nhan_vien")).toBeNull();
    const inviteAdmin = await inviteRaw(admin, "admin", "it2@nhatminh.vn", "IT 2");
    expect(inviteAdmin.status).toBe(403);
    expect(await ruleOf(inviteAdmin)).toBe("owner_only");
    const inviteRoot = await inviteRaw(admin, "root", "root2@nhatminh.vn", "Root 2");
    expect(await ruleOf(inviteRoot)).toBe("root_role");

    const self = row(page, admin.userId);
    expect(self.can).toMatchObject({ change_role: false, set_status: false, grant_jit: false });
    expect(self.locked_reason).toEqual({ change_role: "self_role", set_status: "self_disable", reinvite: null, grant_jit: null });
    const selfPatch = await patchUser(admin, admin.userId, { role: "quan_ly" });
    expect(await ruleOf(selfPatch)).toBe("self_role");
    const selfOff = await patchUser(admin, admin.userId, { status: "disabled" });
    expect(selfOff.status).toBe(403);
    expect(await ruleOf(selfOff)).toBe("self_disable");

    const owner = row(page, gd.userId);
    expect(owner.can.change_role).toBe(false);
    expect(owner.locked_reason.change_role).toBe("owner_only");
    const ownerPatch = await patchUser(admin, gd.userId, { role: "quan_ly" });
    expect(ownerPatch.status).toBe(403);
    expect(await ruleOf(ownerPatch)).toBe("owner_only");

    const staff = row(page, nv.userId);
    expect(staff.can.change_role).toBe(true);
    expect(lockOf(staff.role_options, "admin")).toBe("owner_only");
    expect(lockOf(staff.role_options, "quan_ly")).toBeNull();
    expect((await patchUser(admin, nv.userId, { role: "giam_doc" })).status).toBe(403);
    expect((await patchUser(admin, nv.userId, { role: "quan_ly" })).status).toBe(200);
  });

  it("users as Giám đốc: admin row admin_only; JIT locks = grantJit's order (self_grant, already_admin, jit_active, not_active)", async () => {
    const admin = await seedAdmin();
    const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
    const nv = await invite(gd, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
    const pendingRes = await inviteRaw(gd, "nhan_vien", "moi@nhatminh.vn", "Người mới");
    const pendingId = (await pendingRes.json<{ user: { id: string } }>()).user.id;
    let page = await usersPage(gd);

    expect(lockOf(page.invite_roles, "admin")).toBeNull();
    expect(lockOf(page.invite_roles, "giam_doc")).toBeNull();

    const adm = row(page, admin.userId);
    expect(adm.locked_reason).toMatchObject({ change_role: "admin_only", set_status: "admin_only", grant_jit: "already_admin" });
    const disable = await patchUser(gd, admin.userId, { status: "disabled" });
    expect(await ruleOf(disable)).toBe("admin_only");
    expect((await grantJit(gd, admin.userId)).status).toBe(409);

    expect(row(page, gd.userId).locked_reason.grant_jit).toBe("self_grant");
    expect(await ruleOf(await grantJit(gd, gd.userId))).toBe("self_grant");

    const pending = row(page, pendingId);
    expect(pending.can).toMatchObject({ reinvite: true, set_status: false, grant_jit: false });
    expect(pending.locked_reason).toMatchObject({ set_status: "pending", grant_jit: "not_active" });
    expect((await patchUser(gd, pendingId, { status: "disabled" })).status).toBe(409);
    expect((await grantJit(gd, pendingId)).status).toBe(422);

    expect(row(page, nv.userId).can.grant_jit).toBe(true);
    expect((await grantJit(gd, nv.userId)).status).toBe(201);
    page = await usersPage(gd);
    const granted = row(page, nv.userId);
    expect(granted.jit_grant).not.toBeNull();
    expect(granted.can).toMatchObject({ grant_jit: false, revoke_jit: true });
    expect(granted.locked_reason.grant_jit).toBe("jit_active");
    expect((await grantJit(gd, nv.userId)).status).toBe(409);
  });
});
