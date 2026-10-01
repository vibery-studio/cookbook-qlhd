/**
 * SPEC-06 API acceptance — AC-1 · AC-2 · AC-3 · AC-4 · AC-5 · AC-6 (+ race) · AC-7 (custom-role part + member) · AC-9 · AC-10
 * (PLAN-06 §1).
 * Written before the code: roles.label/is_system/version, `roles:write`, GET /roles {items, catalog},
 * POST /roles, PATCH /roles/{id}, DELETE /roles/{id}?expected_version, `role: string` on /admin/users.
 * Calls the API exactly as SPEC-06 §3.2 says. AC-7's self_role / admin_only part belongs to FIX-03
 * (`fix-03-role-escalation.test.ts`), not here.
 * Not-yet-existing columns are only touched through raw SQL inside try/catch (reset) or in the one test that needs them
 * (role-limit), so this file compiles today and each test reports its own failure.
 * FR-13: audit_events is append-only (D1 trigger) → cleanup goes through `clearAuditEvents()` from `@runway/test-fixtures`,
 * which drops whatever triggers sit on the table, deletes, and recreates them from sqlite_master.
 * The tests mutate seeded system roles (quan_ly, giam_doc); `restoreSeedRoles()` puts them back before AND after each test.
 */
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { generateUlid } from "../../src/utils/id";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);
const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** SPEC-06 AC-1: 15 codes of today's catalog + `roles:write`. */
const CATALOG = [
  "audit:read",
  "contract:approve",
  "contract:issue",
  "contract:read",
  "contract:submit",
  "contract:write",
  "flags:read",
  "flags:write",
  "notes:read",
  "notes:write",
  "roles:write",
  "settings:read",
  "settings:write",
  "template:write",
  "users:read",
  "users:write",
];

/** Seed grants of the system roles these tests edit (0010_seed_foundation.sql + SPEC-06 §3.1 roles:write for giam_doc). */
const SEED_GRANTS: Record<string, string[]> = {
  giam_doc: [
    "audit:read",
    "contract:approve",
    "contract:issue",
    "contract:read",
    "contract:submit",
    "contract:write",
    "roles:write",
    "template:write",
    "users:read",
    "users:write",
  ],
  quan_ly: ["audit:read", "contract:approve", "contract:issue", "contract:read", "contract:submit", "contract:write"],
  nhan_vien: ["contract:read", "contract:submit", "contract:write"],
};

interface Person {
  userId: string;
  session: RunwaySession;
}

interface RoleDto {
  id: string;
  name: string;
  label: string;
  description: string | null;
  is_system: boolean;
  version: number;
  holders: number;
  permissions: string[];
  can: { edit: boolean; delete: boolean };
  locked_reason: null | "system" | "own_role" | "admin";
}

interface RolesBody {
  items: RoleDto[];
  catalog: string[];
}

interface ProblemBody {
  type: string;
  status: number;
  rule?: string;
  permissions?: string[];
  holders?: number;
}

// ---------------------------------------------------------------- db

async function restoreSeedRoles(): Promise<void> {
  // custom roles (server-generated name r_…) and their grants
  await env.DB.prepare("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'r\\_%' ESCAPE '\\')").run();
  await env.DB.prepare("DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'r\\_%' ESCAPE '\\')").run();
  await env.DB.prepare("DELETE FROM roles WHERE name LIKE 'r\\_%' ESCAPE '\\'").run();
  // system roles back to their seed grants (exact set)
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
  try {
    await env.DB.prepare("UPDATE roles SET version = 1").run();
  } catch {
    // `version` not created yet (red run) — the assertions report the real failure
  }
}

async function auditCount(): Promise<number> {
  return (await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events"))?.n ?? -1;
}

async function resetDb(): Promise<void> {
  await clearAuditEvents(env.DB);
  try {
    await env.DB.prepare("DELETE FROM idempotency_keys").run();
  } catch {
    // table name differs / absent — not load-bearing here
  }
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
  await restoreSeedRoles();
}

async function sqlFirst<T>(query: string, ...binds: unknown[]): Promise<T | null> {
  return env.DB.prepare(query)
    .bind(...binds)
    .first<T>();
}

async function deniedCount(actorId: string): Promise<number> {
  return (
    (await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'permission.denied' AND actor = ?", actorId))?.n ??
    -1
  );
}

async function auditMeta(action: string): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DB.prepare("SELECT metadata FROM audit_events WHERE action = ? ORDER BY ts")
    .bind(action)
    .all<{ metadata: string | null }>();
  return rows.results.map((r) => (r.metadata === null ? {} : (JSON.parse(r.metadata) as Record<string, unknown>)));
}

async function roleless(): Promise<number> {
  return (
    (await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)"))
      ?.n ?? -1
  );
}

// ---------------------------------------------------------------- people

async function seedAdmin(): Promise<Person> {
  const admin = await createAdmin({
    fetcher,
    readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
    assignAdminRole: async (userId) => {
      await assignRoleByName({ db: getDb(env), kv: env.SESSIONS, env }, { userId, roleName: "admin" });
    },
    origin: ORIGIN,
  });
  return { userId: admin.userId, session: admin.session };
}

function inviteRaw(by: Person, role: string, email: string, displayName: string): Promise<Response> {
  return by.session.fetch("/admin/users", { method: "POST", body: JSON.stringify({ email, display_name: displayName, role }) });
}

async function activate(res: Response, email: string): Promise<Person> {
  expect(res.status).toBe(201);
  const body: { user: { id: string }; activation_url: string } = await res.json();
  const token = new URL(body.activation_url).searchParams.get("token");
  const act = await fetcher(`${ORIGIN}/auth/activate`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token, password: PASSWORD }),
  });
  expect(act.status).toBe(204);
  const cookies = await loginAs(fetcher, { email, password: PASSWORD, origin: ORIGIN });
  return { userId: body.user.id, session: createSession({ userId: body.user.id, email, ...cookies, fetcher, origin: ORIGIN }) };
}

async function invite(by: Person, role: string, email: string, displayName: string): Promise<Person> {
  return activate(await inviteRaw(by, role, email, displayName), email);
}

const gdOf = (admin: Person) => invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
const qlOf = (admin: Person) => invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
const nvOf = (admin: Person) => invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");

// ---------------------------------------------------------------- roles API

async function listRoles(by: Person): Promise<RolesBody> {
  const res = await by.session.fetch("/roles");
  expect(res.status).toBe(200);
  return res.json();
}

async function role(by: Person, name: string): Promise<RoleDto> {
  const r = (await listRoles(by)).items.find((x) => x.name === name);
  expect(r, `role ${name}`).toBeDefined();
  return r!;
}

function createRoleRaw(by: Person, body: Record<string, unknown>, key?: string): Promise<Response> {
  return by.session.fetch("/roles", {
    method: "POST",
    headers: key !== undefined ? { "Idempotency-Key": key } : undefined,
    body: JSON.stringify(body),
  });
}

async function createRole(by: Person, label: string, permissions: string[]): Promise<RoleDto> {
  const res = await createRoleRaw(by, { label, description: `Vai trò ${label}`, permissions });
  expect(res.status, `POST /roles ${label}`).toBe(201);
  return res.json();
}

function patchRole(by: Person, id: string, body: Record<string, unknown>): Promise<Response> {
  return by.session.fetch(`/roles/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

function deleteRole(by: Person, id: string, version: number): Promise<Response> {
  return by.session.fetch(`/roles/${id}?expected_version=${version}`, { method: "DELETE" });
}

async function problemOf(res: Response, status: number, slug: string): Promise<ProblemBody> {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body: ProblemBody = await res.json();
  expect(body.type.endsWith(`/${slug}`), `type ${body.type} ends with /${slug}`).toBe(true);
  return body;
}

async function expectRule(res: Response, rule: string): Promise<ProblemBody> {
  const body = await problemOf(res, 403, "forbidden");
  expect(body.rule).toBe(rule);
  return body;
}

async function permsOf(p: Person): Promise<string[]> {
  const res = await p.session.fetch("/me");
  expect(res.status).toBe(200);
  return (await res.json<{ permissions: string[] }>()).permissions;
}

const without = (xs: string[], ...drop: string[]) => xs.filter((x) => !drop.includes(x));
const sorted = <T extends string | number>(xs: readonly T[]): T[] => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// ================================================================ tests

describe("SPEC-06 roles API (acceptance)", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  afterEach(async () => {
    await restoreSeedRoles();
  });

  it("AC-1: roles:write for admin + Giám đốc only; GET /roles has the 16-code catalog, 5 system roles with Vietnamese labels, can/locked_reason per caller", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const ql = await qlOf(admin);
    const nv = await nvOf(admin);

    expect(await permsOf(admin)).toContain("roles:write");
    expect(await permsOf(gd)).toContain("roles:write");
    expect(await permsOf(ql)).not.toContain("roles:write");
    expect(await permsOf(nv)).not.toContain("roles:write");

    const asGd = await listRoles(gd);
    expect(sorted(asGd.catalog)).toEqual(CATALOG);
    const labels: Record<string, string> = {
      admin: "Quản trị hệ thống",
      member: "Thành viên (nền)",
      giam_doc: "Giám đốc",
      quan_ly: "Quản lý",
      nhan_vien: "Nhân viên",
    };
    for (const [name, label] of Object.entries(labels)) {
      const r = asGd.items.find((x) => x.name === name);
      expect(r, name).toMatchObject({ name, label, is_system: true, version: 1 });
      expect(r!.id).toMatch(/^[0-9A-Z]{26}$/);
    }
    const gdRole = asGd.items.find((x) => x.name === "giam_doc")!;
    expect(gdRole.holders).toBe(1);
    expect(sorted(gdRole.permissions)).toEqual(SEED_GRANTS["giam_doc"]);
    // caller-relative: own role, admin, other system role
    expect(gdRole).toMatchObject({ can: { edit: false, delete: false }, locked_reason: "own_role" });
    expect(asGd.items.find((x) => x.name === "admin")).toMatchObject({ can: { edit: false, delete: false }, locked_reason: "admin" });
    expect(asGd.items.find((x) => x.name === "quan_ly")).toMatchObject({ can: { edit: true, delete: false } });

    // without roles:write every can is false (still readable — SPEC-04a FR-9)
    const asNv = await listRoles(nv);
    expect(sorted(asNv.catalog)).toEqual(CATALOG);
    expect(asNv.items.every((r) => !r.can.edit && !r.can.delete)).toBe(true);
  }, 60_000);

  it("AC-2: Giám đốc drops contract:issue from Quản lý → 200, version+1; logged-in Quản lý gets 403 on the next call (no re-login); one role.permissions_changed row", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const ql = await qlOf(admin);

    // warm Quản lý's principal cache (GET /me → KV session:<id>) while the permission is live
    expect(await permsOf(ql)).toContain("contract:issue");

    const before = await role(gd, "quan_ly");
    const res = await patchRole(gd, before.id, {
      expected_version: before.version,
      permissions: without(before.permissions, "contract:issue"),
    });
    expect(res.status).toBe(200);
    const after: RoleDto = await res.json();
    expect(after.version).toBe(before.version + 1);
    expect(after.permissions).not.toContain("contract:issue");
    expect(sorted(after.permissions)).toEqual(sorted(without(SEED_GRANTS["quan_ly"]!, "contract:issue")));

    // same session, next call: revoked (cache purged for every holder — DEC-4)
    expect((await ql.session.fetch(`/contracts/${UNKNOWN_ID}/issue`, { method: "POST", body: "{}" })).status).toBe(403);
    expect(await permsOf(ql)).not.toContain("contract:issue");

    const rows = await auditMeta("role.permissions_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ added: [], removed: ["contract:issue"] });
  }, 60_000);

  it("AC-3: two PATCH with the same expected_version → one 200, one 409 stale; the winner's set is stored; one audit row; unknown id → 404", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const v = await role(gd, "quan_ly");

    const setA = without(v.permissions, "contract:issue"); // Giám đốc
    const setB = without(v.permissions, "audit:read"); // admin (removing is never escalation)
    const [ra, rb] = await Promise.all([
      patchRole(gd, v.id, { expected_version: v.version, permissions: setA }),
      patchRole(admin, v.id, { expected_version: v.version, permissions: setB }),
    ]);
    expect(sorted([ra.status, rb.status])).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    await problemOf(loser, 409, "stale");
    const winnerSet = ra.status === 200 ? setA : setB;

    const now = await role(gd, "quan_ly");
    expect(now.version).toBe(v.version + 1);
    expect(sorted(now.permissions)).toEqual(sorted(winnerSet));
    expect(await auditMeta("role.permissions_changed")).toHaveLength(1);

    // stale version on a later call, unknown id
    await problemOf(await patchRole(gd, v.id, { expected_version: v.version, label: "Quản lý cửa hàng" }), 409, "stale");
    await problemOf(await patchRole(gd, UNKNOWN_ID, { expected_version: 1, label: "X" }), 404, "not-found");
  }, 60_000);

  it("AC-4: create/clone — 201 with server-made name r_…; Idempotency-Key replays; label duplicate (case/space) → 409; unknown or repeated code, bad label, extra keys → 422", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);

    const key = crypto.randomUUID();
    const res = await createRoleRaw(gd, { label: "Kế toán", description: "Xem hợp đồng để đối soát", permissions: ["contract:read"] }, key);
    expect(res.status).toBe(201);
    const ke: RoleDto = await res.json();
    expect(ke.name).toMatch(/^r_[0-9a-z]{26}$/);
    expect(ke).toMatchObject({
      label: "Kế toán",
      description: "Xem hợp đồng để đối soát",
      is_system: false,
      version: 1,
      holders: 0,
      permissions: ["contract:read"],
      can: { edit: true, delete: true },
      locked_reason: null,
    });
    // double click (same key) → same role, not a second one
    const replay = await createRoleRaw(gd, { label: "Kế toán", description: "Xem hợp đồng để đối soát", permissions: ["contract:read"] }, key);
    expect(replay.status).toBe(201);
    expect((await replay.json<RoleDto>()).id).toBe(ke.id);
    expect(await auditMeta("role.created")).toHaveLength(1);

    // same label in another shape (label_key: NFC, trim, collapse spaces, lower-case vi) → 409 duplicate
    await problemOf(await createRoleRaw(gd, { label: " kế  toán ", permissions: ["contract:read"] }), 409, "duplicate");
    // closed catalog, no repeats, label bounds, strict body (name / is_system can never be set)
    await problemOf(await createRoleRaw(gd, { label: "Kế toán 2", permissions: ["contract:delete"] }), 422, "validation");
    await problemOf(await createRoleRaw(gd, { label: "Kế toán 2", permissions: ["contract:read", "contract:read"] }), 422, "validation");
    await problemOf(await createRoleRaw(gd, { label: "   ", permissions: [] }), 422, "validation");
    await problemOf(await createRoleRaw(gd, { label: "K".repeat(61), permissions: [] }), 422, "validation");
    await problemOf(await createRoleRaw(gd, { label: "Kế toán 2", permissions: [], name: "admin" }), 422, "validation");
    await problemOf(await createRoleRaw(gd, { label: "Kế toán 2", permissions: [], is_system: true }), 422, "validation");

    const list = await listRoles(gd);
    expect(list.items.filter((r) => !r.is_system).map((r) => r.label)).toEqual(["Kế toán"]);
    expect(list.items.filter((r) => r.name === "admin")).toHaveLength(1);
  }, 60_000);

  it("AC-4 / §3.1: at most 50 custom roles → 409 role-limit", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const now = Math.floor(Date.now() / 1000);
    const stmts = Array.from({ length: 50 }, (_, i) => {
      const n = String(i).padStart(2, "0");
      const id = generateUlid();
      return env.DB.prepare(
        "INSERT INTO roles (id, name, description, label, label_key, is_system, version, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 0, 1, ?, ?)",
      ).bind(id, `r_${id.toLowerCase()}`, `Vai trò ${n}`, `vai trò ${n}`, now, now);
    });
    await env.DB.batch(stmts);
    await problemOf(await createRoleRaw(gd, { label: "Vai trò 51", permissions: [] }), 409, "role-limit");
  }, 60_000);

  it("AC-5: guards — own_role · grant_not_held (+permissions) · admin_role · system_role · no roles:write; each 403 = one permission.denied; admin may drop users:write from giam_doc; 401 anonymous", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const nv = await nvOf(admin);
    const roles = await listRoles(admin);
    const id = (name: string) => roles.items.find((r) => r.name === name)!.id;
    const ver = (name: string) => roles.items.find((r) => r.name === name)!.version;

    // own role (Giám đốc edits giam_doc) — even a harmless label change
    await expectRule(await patchRole(gd, id("giam_doc"), { expected_version: ver("giam_doc"), label: "Giám đốc điều hành" }), "own_role");
    expect(await deniedCount(gd.userId)).toBe(1);

    // grant what you don't hold: Giám đốc adds settings:write to Quản lý
    const gdGrant = await expectRule(
      await patchRole(gd, id("quan_ly"), {
        expected_version: ver("quan_ly"),
        permissions: [...SEED_GRANTS["quan_ly"]!, "settings:write"],
      }),
      "grant_not_held",
    );
    expect(gdGrant.permissions).toEqual(["settings:write"]);
    expect(await deniedCount(gd.userId)).toBe(2);

    // admin has no contract:approve → cannot add it to "Kế toán" (contract:read is kept, not added)
    const ke = await createRole(gd, "Kế toán", ["contract:read"]);
    const adGrant = await expectRule(
      await patchRole(admin, ke.id, { expected_version: ke.version, permissions: ["contract:read", "contract:approve"] }),
      "grant_not_held",
    );
    expect(adGrant.permissions).toEqual(["contract:approve"]);
    expect(await deniedCount(admin.userId)).toBe(1);
    expect((await role(gd, ke.name)).permissions).toEqual(["contract:read"]);
    // dropping a code you don't hold is fine (not escalation)
    expect((await patchRole(admin, ke.id, { expected_version: ke.version, permissions: [] })).status).toBe(200);

    // admin (does not hold giam_doc) drops users:write from it → 200 (lockout: admin keeps roles:write + users:write)
    const gdRes = await patchRole(admin, id("giam_doc"), {
      expected_version: ver("giam_doc"),
      permissions: without(SEED_GRANTS["giam_doc"]!, "users:write"),
    });
    expect(gdRes.status).toBe(200);
    expect(await permsOf(gd)).not.toContain("users:write");

    // admin role is immutable through the API — for everyone, admin included
    await expectRule(await patchRole(gd, id("admin"), { expected_version: ver("admin"), label: "Admin" }), "admin_role");
    await expectRule(await patchRole(admin, id("admin"), { expected_version: ver("admin"), permissions: CATALOG }), "admin_role");
    await expectRule(await deleteRole(gd, id("admin"), ver("admin")), "admin_role");
    expect(await deniedCount(gd.userId)).toBe(4);
    expect(await deniedCount(admin.userId)).toBe(2);

    // system roles are never deleted
    await expectRule(await deleteRole(gd, id("nhan_vien"), ver("nhan_vien")), "system_role");
    expect(await deniedCount(gd.userId)).toBe(5);

    // no roles:write → 403 (middleware) + one denied row
    await problemOf(await createRoleRaw(nv, { label: "Tự tạo", permissions: ["contract:read"] }), 403, "forbidden");
    expect(await deniedCount(nv.userId)).toBe(1);
    await problemOf(await patchRole(nv, ke.id, { expected_version: 2, label: "X" }), 403, "forbidden");
    expect(await deniedCount(nv.userId)).toBe(2);

    // strict body on PATCH: name can never change
    await problemOf(await patchRole(gd, ke.id, { expected_version: 2, name: "admin" }), 422, "validation");

    // anonymous
    expect((await fetcher(`${ORIGIN}/roles`)).status).toBe(401);
    const anonPost = await fetcher(`${ORIGIN}/roles`, {
      method: "POST",
      headers: CSRF_HEADERS,
      body: JSON.stringify({ label: "Ẩn danh", permissions: [] }),
    });
    expect(anonPost.status).toBe(401);
    // nothing changed on admin
    expect(sorted((await role(admin, "admin")).permissions)).not.toContain("contract:approve");
  }, 60_000);

  it("AC-6: delete — role held by 2 → 409 role-in-use holders:2; after moving them → 204, gone from GET /roles, role.deleted keeps name + label; stale / 404", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const u1 = await invite(admin, "nhan_vien", "lan@nhatminh.vn", "Phạm Thu Lan");
    const u2 = await invite(admin, "nhan_vien", "hoa@nhatminh.vn", "Lê Hoa");
    const ke = await createRole(gd, "Kế toán", ["contract:read"]);
    // put the two people on "Kế toán" directly (assigning a custom role through the API is AC-7 / C-06-003)
    await env.DB.prepare("UPDATE user_roles SET role_id = ? WHERE user_id IN (?, ?)").bind(ke.id, u1.userId, u2.userId).run();

    expect((await role(gd, ke.name)).holders).toBe(2);
    const inUse = await problemOf(await deleteRole(gd, ke.id, ke.version), 409, "role-in-use");
    expect(inUse.holders).toBe(2);
    expect((await listRoles(gd)).items.some((r) => r.id === ke.id)).toBe(true);

    for (const u of [u1, u2]) {
      const res = await gd.session.fetch(`/admin/users/${u.userId}`, { method: "PATCH", body: JSON.stringify({ role: "nhan_vien" }) });
      expect(res.status).toBe(200);
    }
    await problemOf(await deleteRole(gd, ke.id, ke.version + 7), 409, "stale");
    expect((await deleteRole(gd, ke.id, ke.version)).status).toBe(204);
    expect((await listRoles(gd)).items.some((r) => r.id === ke.id)).toBe(false);
    expect(await sqlFirst("SELECT 1 AS x FROM role_permissions WHERE role_id = ?", ke.id)).toBeNull();
    await problemOf(await deleteRole(gd, ke.id, ke.version), 404, "not-found");

    const rows = await auditMeta("role.deleted");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: ke.name, label: "Kế toán" });
    expect(await roleless()).toBe(0);
  }, 60_000);

  it("AC-6 race: DELETE vs invite into the same custom role → never a user without a role (409 role-in-use + 201, or 204 + 422 unknown-role)", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const ke = await createRole(gd, "Kế toán", ["contract:read"]);

    const [del, inv] = await Promise.all([
      deleteRole(gd, ke.id, ke.version),
      inviteRaw(admin, ke.name, "lan@nhatminh.vn", "Phạm Thu Lan"),
    ]);
    const outcome = [del.status, inv.status];
    expect([
      [409, 201],
      [204, 422],
    ]).toContainEqual(outcome);
    if (inv.status === 422) await problemOf(inv, 422, "unknown-role");
    if (del.status === 409) await problemOf(del, 409, "role-in-use");
    expect(await roleless()).toBe(0);
  }, 60_000);

  it("AC-7 (custom-role part): invite / reassign with role r_… → 201 / 200; unknown role name or `member` → 422 unknown-role", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const nv = await nvOf(admin);
    const ke = await createRole(gd, "Kế toán", ["contract:read"]);

    const invited = await inviteRaw(gd, ke.name, "lan@nhatminh.vn", "Phạm Thu Lan");
    expect(invited.status).toBe(201);
    expect((await invited.json<{ user: { roles: string[] } }>()).user.roles).toEqual([ke.name]);
    await problemOf(await inviteRaw(gd, "khong_co", "hoa@nhatminh.vn", "Lê Hoa"), 422, "unknown-role");
    expect(await sqlFirst("SELECT 1 AS x FROM users WHERE email = 'hoa@nhatminh.vn'")).toBeNull();

    const moved = await gd.session.fetch(`/admin/users/${nv.userId}`, { method: "PATCH", body: JSON.stringify({ role: ke.name }) });
    expect(moved.status).toBe(200);
    expect((await moved.json<{ roles: string[] }>()).roles).toEqual([ke.name]);
    // the moved person's live session follows the new role (contract:read only)
    expect(sorted(await permsOf(nv))).toEqual(["contract:read"]);
    await problemOf(
      await gd.session.fetch(`/admin/users/${nv.userId}`, { method: "PATCH", body: JSON.stringify({ role: "khong_co" }) }),
      422,
      "unknown-role",
    );
    // `member` (base role, DEC-7) is never assignable — asked by admin, who is exempt from FR-12, so only unknown-role can answer
    await problemOf(await inviteRaw(admin, "member", "thanh@nhatminh.vn", "Ngô Thành"), 422, "unknown-role");
    await problemOf(
      await admin.session.fetch(`/admin/users/${nv.userId}`, { method: "PATCH", body: JSON.stringify({ role: "member" }) }),
      422,
      "unknown-role",
    );
    expect(await sqlFirst("SELECT 1 AS x FROM users WHERE email = 'thanh@nhatminh.vn'")).toBeNull();
    expect((await role(gd, ke.name)).holders).toBe(2);
    expect(await roleless()).toBe(0);
  }, 60_000);

  it("AC-9 / FR-12: Giám đốc cannot give OR take away a role holding a code they lack (grant_not_held + permissions + denied row); admin is exempt", async () => {
    const admin = await seedAdmin();
    const gd = await gdOf(admin);
    const nv = await nvOf(admin);
    const kt = await createRole(admin, "Kỹ thuật", ["settings:write"]); // admin holds settings:write, Giám đốc does not
    const assign = (by: Person, userId: string, roleName: string) =>
      by.session.fetch(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: roleName }) });
    const rolesOf = async (userId: string) =>
      (
        await env.DB.prepare("SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?")
          .bind(userId)
          .all<{ name: string }>()
      ).results.map((r) => r.name);

    // invite into it → refused, nobody created
    const inv = await expectRule(await inviteRaw(gd, kt.name, "lan@nhatminh.vn", "Phạm Thu Lan"), "grant_not_held");
    expect(inv.permissions).toEqual(["settings:write"]);
    expect(await sqlFirst("SELECT 1 AS x FROM users WHERE email = 'lan@nhatminh.vn'")).toBeNull();
    expect(await deniedCount(gd.userId)).toBe(1);

    // move someone into it → refused, role unchanged
    const mv = await expectRule(await assign(gd, nv.userId, kt.name), "grant_not_held");
    expect(mv.permissions).toEqual(["settings:write"]);
    expect(await rolesOf(nv.userId)).toEqual(["nhan_vien"]);
    expect(await deniedCount(gd.userId)).toBe(2);

    // admin may (exempt)
    expect((await assign(admin, nv.userId, kt.name)).status).toBe(200);
    expect(await rolesOf(nv.userId)).toEqual([kt.name]);

    // take it away again (the OLD role holds settings:write) → refused too ("thu hồi tương ứng")
    const back = await expectRule(await assign(gd, nv.userId, "nhan_vien"), "grant_not_held");
    expect(back.permissions).toEqual(["settings:write"]);
    expect(await rolesOf(nv.userId)).toEqual([kt.name]);
    expect(await deniedCount(gd.userId)).toBe(3);

    // admin invites into it → 201
    expect((await inviteRaw(admin, kt.name, "hoa@nhatminh.vn", "Lê Hoa")).status).toBe(201);
    expect(await roleless()).toBe(0);
  }, 60_000);

  it("AC-10 / FR-13: audit_events is append-only — UPDATE and DELETE through D1 fail, row count unchanged", async () => {
    await env.DB.prepare("INSERT INTO audit_events (id, ts, actor, action, target, metadata, ip) VALUES (?, ?, NULL, 'test.row', NULL, NULL, NULL)")
      .bind(generateUlid(), Math.floor(Date.now() / 1000))
      .run();
    const before = await auditCount();
    expect(before).toBeGreaterThan(0);
    await expect(env.DB.prepare("UPDATE audit_events SET action = 'tampered'").run()).rejects.toThrow();
    await expect(env.DB.prepare("DELETE FROM audit_events").run()).rejects.toThrow();
    await expect(env.DB.prepare("DELETE FROM audit_events WHERE action = 'test.row'").run()).rejects.toThrow();
    expect(await auditCount()).toBe(before);
    expect(await sqlFirst("SELECT 1 AS x FROM audit_events WHERE action = 'tampered'")).toBeNull();
    // the test-only helper still empties it (and leaves the triggers in place)
    await clearAuditEvents(env.DB);
    expect(await auditCount()).toBe(0);
    expect(
      (await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_events'"))?.n,
    ).toBeGreaterThanOrEqual(2);
  });
});
