/**
 * C-11-001 — Root admin toggles "cơ chế duyệt 2 lớp" (two-layer approval) for role permission changes.
 *   - `root` (seeder-only) holds `security:write` + `audit:read`; nobody gets `root` through the app (403 `root_role`).
 *   - `PUT /security/two-layer {enabled, reason}` (security:write) → audit `security.two_layer_changed`.
 *   - OFF: a permanent admin / Giám đốc changes a role's permissions directly (`PUT /roles/{id}/permissions`), same guards
 *     (SoD, grant_not_held, JIT, admin role → owner only, root never, pending request locks). ON: 409 `two-layer-on`.
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
  await env.DB.prepare("DELETE FROM settings WHERE key = 'security.two_layer_role_change'").run();
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

interface TwoLayer {
  enabled: boolean;
  updated_at: number | null;
  updated_by_name: string | null;
}

/** A root admin exists only through the seeder: invite a placeholder, swap its role to `root` in D1, then activate. */
async function seedRoot(by: Person): Promise<Person> {
  const email = "root@nhatminh.vn";
  const res = await inviteRaw(by, "nhan_vien", email, "Root");
  expect(res.status).toBe(201);
  const body: { user: { id: string }; activation_url: string } = await res.json();
  await env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(body.user.id).run();
  await env.DB.prepare("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'root'").bind(body.user.id).run();
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

async function team(): Promise<{ admin: Person; gd: Person; ql: Person; root: Person }> {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const root = await seedRoot(admin);
  return { admin, gd, ql, root };
}

const putTwoLayer = (by: Person, body: Record<string, unknown>) =>
  by.session.fetch("/security/two-layer", { method: "PUT", body: JSON.stringify(body) });

async function setTwoLayer(by: Person, enabled: boolean): Promise<void> {
  const res = await putTwoLayer(by, { enabled, reason: enabled ? "Bật lại sau đợt sắp xếp" : "Đội nhỏ, sắp xếp lại quyền" });
  expect(res.status).toBe(200);
}

const direct = (by: Person, r: RoleDto, permissions: string[]) =>
  by.session.fetch(`/roles/${r.id}/permissions`, { method: "PUT", body: JSON.stringify({ expected_version: r.version, permissions }) });

async function auditRows(action: string): Promise<Array<{ actor: string; target: string; metadata: Record<string, unknown> }>> {
  const rows = await env.DB.prepare("SELECT actor, target, metadata FROM audit_events WHERE action = ? ORDER BY ts, id")
    .bind(action)
    .all<{ actor: string; target: string; metadata: string | null }>();
  return rows.results.map((r) => ({ actor: r.actor, target: r.target, metadata: JSON.parse(r.metadata ?? "{}") as Record<string, unknown> }));
}

const mePerms = async (p: Person): Promise<string[]> => (await (await p.session.fetch("/me")).json<{ permissions: string[] }>()).permissions;

describe("C-11-001 — root toggles two-layer approval for permission changes", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("root: security:write + audit:read only; toggles OFF with a reason → 200 + one security.two_layer_changed row; same value → no row; admin cannot write; readers = roles:write | security:write", async () => {
    const { admin, ql, root } = await team();
    expect([...(await mePerms(root))].sort()).toEqual(["audit:read", "security:write"]);
    expect(await mePerms(admin)).not.toContain("security:write");

    const before = await root.session.fetch("/security/two-layer");
    expect(before.status).toBe(200);
    expect(await before.json<TwoLayer>()).toMatchObject({ enabled: true });
    expect((await admin.session.fetch("/security/two-layer")).status).toBe(200);
    await problemOf(await ql.session.fetch("/security/two-layer"), 403, "forbidden");

    expect((await putTwoLayer(root, { enabled: false, reason: "ngắn" })).status).toBe(422);
    await problemOf(await putTwoLayer(admin, { enabled: false, reason: "Admin tự tắt cho nhanh" }), 403, "forbidden");

    const off = await putTwoLayer(root, { enabled: false, reason: "Đội nhỏ, sắp xếp lại quyền" });
    expect(off.status).toBe(200);
    expect(await off.json<TwoLayer>()).toMatchObject({ enabled: false, updated_by_name: "Root" });
    expect((await (await admin.session.fetch("/security/two-layer")).json<TwoLayer>()).enabled).toBe(false);
    const rows = await auditRows("security.two_layer_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: root.userId, metadata: { enabled: false, reason: "Đội nhỏ, sắp xếp lại quyền" } });

    expect((await putTwoLayer(root, { enabled: false, reason: "Bấm lại lần nữa thôi" })).status).toBe(200);
    expect(await auditRows("security.two_layer_changed")).toHaveLength(1);

    const roles = await (await admin.session.fetch("/roles")).json<{ two_layer: boolean; items: RoleDto[] }>();
    expect(roles.two_layer).toBe(false);
  }, 60_000);

  it("OFF: admin removes and adds a permission on quan_ly directly → 200, version + 1, audit direct:true, holders see it at once", async () => {
    const { admin, ql, root } = await team();
    await setTwoLayer(root, false);
    const qlRole = await role(admin, "quan_ly");
    expect(qlRole.can).toMatchObject({ direct: true });

    const removed = await direct(admin, qlRole, without(qlRole.permissions, "audit:read"));
    expect(removed.status).toBe(200);
    const after: RoleDto = await removed.json();
    expect(after.version).toBe(qlRole.version + 1);
    expect(await rolePermsInDb("quan_ly")).not.toContain("audit:read");
    expect(await mePerms(ql)).not.toContain("audit:read");

    const added = await direct(admin, after, [...after.permissions, "notes:read"]);
    expect(added.status).toBe(200);
    expect((await added.json<RoleDto>()).version).toBe(qlRole.version + 2);
    expect(await rolePermsInDb("quan_ly")).toContain("notes:read");

    const rows = await auditRows("role.permissions_changed");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actor: admin.userId, target: `role:${qlRole.id}`, metadata: { name: "quan_ly", added: [], removed: ["audit:read"], direct: true } });
    expect(rows[1]).toMatchObject({ metadata: { added: ["notes:read"], removed: [], direct: true } });
    expect(await auditRows("role.change_requested")).toHaveLength(0);
  }, 60_000);

  it("OFF: guards still hold — SoD 409, grant_not_held 403, admin role only by Giám đốc (owner_only), own role 403, no roles:write 403, pending request locks (and stays approvable)", async () => {
    const { admin, gd, ql, root } = await team();
    await setTwoLayer(root, false);

    expect((await gd.session.fetch("/sod-pairs", { method: "POST", body: JSON.stringify({ perm_a: "contract:approve", perm_b: "notes:read" }) })).status).toBe(201);
    const qlRole = await role(gd, "quan_ly");
    await problemOf(await direct(gd, qlRole, [...qlRole.permissions, "notes:read"]), 409, "sod-conflict");
    await expectRule(await direct(admin, qlRole, [...qlRole.permissions, "jit:grant"]), "grant_not_held");

    const adminRole = await role(admin, "admin");
    expect(adminRole.can).toMatchObject({ direct: false });
    await expectRule(await direct(admin, adminRole, without(adminRole.permissions, "notes:write")), "owner_only");
    expect(await rolePermsInDb("admin")).toContain("notes:write");
    expect((await direct(gd, await role(gd, "admin"), without(adminRole.permissions, "notes:write"))).status).toBe(200);
    expect(await rolePermsInDb("admin")).not.toContain("notes:write");

    const gdRole = await role(gd, "giam_doc");
    await expectRule(await direct(gd, gdRole, without(gdRole.permissions, "jit:grant")), "own_role");
    await problemOf(await direct(ql, await role(ql, "nhan_vien"), []), 403, "forbidden");

    const nv = await role(admin, "nhan_vien");
    const pending = await requestChange(admin, nv, without(nv.permissions, "contract:submit"));
    await problemOf(await direct(gd, await role(gd, "nhan_vien"), without(nv.permissions, "contract:read")), 409, "request-pending");
    expect((await approve(gd, pending.id)).status).toBe(200);
    expect(await rolePermsInDb("nhan_vien")).not.toContain("contract:submit");
  }, 60_000);

  it("root role: never through the app — change request, direct change, label, invite, assign, or touching a root holder → 403 root_role", async () => {
    const { admin, gd, ql, root } = await team();
    await setTwoLayer(root, false);
    const rootRole = await role(gd, "root");
    expect(rootRole.can).toMatchObject({ edit: false, delete: false, request: false, direct: false });
    expect(rootRole.locked_reason).toBe("root");

    await expectRule(await requestChangeRaw(gd, rootRole, [...rootRole.permissions, "users:read"]), "root_role");
    await expectRule(await direct(gd, rootRole, without(rootRole.permissions, "audit:read")), "root_role");
    await expectRule(
      await gd.session.fetch(`/roles/${rootRole.id}`, { method: "PATCH", body: JSON.stringify({ expected_version: rootRole.version, description: "x" }) }),
      "root_role",
    );
    await expectRule(await inviteRaw(gd, "root", "root2@nhatminh.vn", "Root 2"), "root_role");
    await expectRule(await inviteRaw(admin, "root", "root3@nhatminh.vn", "Root 3"), "root_role");
    await expectRule(await patchUser(gd, ql.userId, { role: "root" }), "root_role");
    await expectRule(await patchUser(admin, root.userId, { role: "nhan_vien" }), "root_role");
    expect(await rolesOfUser(root.userId)).toEqual(["root"]);
    expect(await rolesOfUser(ql.userId)).toEqual(["quan_ly"]);
    expect(await rolePermsInDb("root")).toEqual(["audit:read", "security:write"]);
    const denied = [...(await denials(gd.userId)), ...(await denials(admin.userId))];
    expect(denied.filter((d) => d.metadata["rule"] === "root_role")).toHaveLength(7);
  }, 60_000);

  it("ON again → direct path 409 two-layer-on (nothing changes); change requests work as before", async () => {
    const { admin, gd, root } = await team();
    await setTwoLayer(root, false);
    await setTwoLayer(root, true);
    expect((await auditRows("security.two_layer_changed")).map((r) => r.metadata["enabled"])).toEqual([false, true]);

    const qlRole = await role(admin, "quan_ly");
    expect(qlRole.can).toMatchObject({ direct: false });
    await problemOf(await direct(admin, qlRole, without(qlRole.permissions, "audit:read")), 409, "two-layer-on");
    expect(await rolePermsInDb("quan_ly")).toContain("audit:read");

    const req = await requestChange(admin, qlRole, without(qlRole.permissions, "audit:read"));
    expect((await approve(gd, req.id)).status).toBe(200);
    expect(await rolePermsInDb("quan_ly")).not.toContain("audit:read");
  }, 60_000);
});
