/**
 * SPEC-07 API acceptance (PLAN-07 §1) — AC-1 · AC-2 · AC-3 · AC-4 (+ reject/withdraw, requester lost a code) · AC-5 · AC-6 ·
 * AC-7 · AC-8 · AC-9 · AC-10 · AC-11 · AC-13 + the "every new endpoint: 401 anonymous / 403 + permission.denied" sweep.
 * AC-12 is the browser spec `apps/web/e2e/rbac-advanced.spec.ts`.
 *
 * Written before the code. Calls the API exactly as SPEC-07 §3.2 + PLAN-07 §2b "API contract" say. Tables this row adds
 * (`sod_pairs`, `role_change_requests`, `jit_grants`, `access_reviews`, `access_review_items`) are touched only through raw
 * SQL inside try/catch (reset) or in single assertions, so this file compiles today and each test reports its own failure.
 *
 * PLAN-07 resolutions this file pins (see PLAN-07 §4):
 *   - SoD pairs used here: (contract:issue, settings:write) — no seed role holds both. SPEC AC-1/AC-2's
 *     (contract:issue, users:read) is held by giam_doc, so it can never be declared (R-8).
 *   - SoD is checked BEFORE grant_not_held on POST /roles and on change-request create (R-9): any pair the caller holds
 *     both codes of sits in the caller's own (single) role, which the pair declaration already refuses.
 *   - GET /roles: `can.request` + `request_locked_reason: null|"request_pending"|"no_approver"` (additive; 2a's
 *     `locked_reason` keeps its meaning) (R-10).
 *   - Access review: a caller with permanent roles:write but no reviews:write may decide ONLY the rows of people who hold
 *     reviews:write (DEC-11 A); any other row → 403 `forbidden` + one permission.denied (R-11).
 *   - Lazy expiry: whoever flips an overdue `pending` request to `expired` (cron or create-request) writes the one
 *     `role.change_expired` row (R-12).
 *
 * Clock: `vi.setSystemTime` (Date only, still ticking). Tests and the Worker (`SELF`) share one isolate in
 * vitest-pool-workers, so handlers' `Date.now()` see the pinned instant. Access JWTs live 120 s → `relogin()` after a jump.
 * Cron code is called directly with an injected `now` (unix seconds): `runJitExpiry(env, now)` / `runRbacDaily(env, now)`
 * from `src/crons/{jit-expiry,rbac-daily}.ts` (dynamic import: the modules do not exist before C-07-002). The wiring of
 * `scheduled()` is proven once per cron string through `worker.scheduled(createScheduledController(...))`.
 * Audit cleanup: `clearAuditEvents()` (audit_events is append-only, SPEC-06 FR-13).
 */
import { SELF, createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import worker from "../../src/index";
import { getDb } from "../../src/db/client";
import { jwtRevocations, refreshTokens, userRoles, users, verificationTokens } from "../../src/db/schema";
import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import { assignRoleByName } from "../../src/services/admin-service";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);
const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 2026-10-01 03:00 UTC = 10:00 giờ VN, the nightly `0 3 * * *` tick on the first day of Q4. */
const DAY_ONE_Q4 = "2026-10-01T03:00:00.000Z";

/** SPEC-07 FR-10: catalog 16 → 18. */
const NEW_CODES = ["jit:grant", "reviews:write"];

/** Seed grants of the system roles (0010 + 0017 + SPEC-07 0020: jit:grant, reviews:write → giam_doc; SPEC-08 0022:
 * price:write, product:write → giam_doc + quan_ly; SPEC-09 0025: quote/payment_request/delivery_note:write → giam_doc +
 * quan_ly + nhan_vien). */
const SEED_GRANTS: Record<string, string[]> = {
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
  nhan_vien: ["contract:read", "contract:submit", "contract:write", "delivery_note:write", "payment_request:write", "quote:write"],
};

/** The pair no seed role holds both codes of (PLAN-07 R-8). */
const PAIR: [string, string] = ["contract:issue", "settings:write"];

interface Person {
  userId: string;
  email: string;
  session: RunwaySession;
}

interface PendingRequestDto {
  id: string;
  added: string[];
  removed: string[];
  requested_by_name: string | null;
  expires_at: number;
}

interface RoleDto {
  id: string;
  name: string;
  label: string;
  version: number;
  permissions: string[];
  can: { edit: boolean; delete: boolean; request: boolean };
  locked_reason: null | "system" | "own_role" | "admin";
  request_locked_reason: null | "request_pending" | "no_approver";
  pending_request: PendingRequestDto | null;
}

interface RolesBody {
  items: RoleDto[];
  catalog: string[];
}

interface ChangeRequestDto {
  id: string;
  role_id: string;
  role_name: string;
  role_label: string;
  base_version: number;
  added: string[];
  removed: string[];
  note: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "expired" | "cancelled";
  requested_by: string;
  requested_by_name: string | null;
  requested_at: number;
  expires_at: number;
  decided_by: string | null;
  decided_at: number | null;
  decision_note: string | null;
  can: { approve: boolean; reject: boolean; withdraw: boolean };
  locked_reason: null | "self_approve" | "jit_actor" | "own_role";
}

interface SodPairDto {
  id: string;
  perm_a: string;
  perm_b: string;
  reason: string | null;
  created_by_name: string | null;
  created_at: number;
}

interface JitGrantDto {
  id: string;
  user_id: string;
  user_name: string | null;
  reason: string;
  granted_by: string;
  granted_by_name: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  state: "active" | "revoked" | "expired";
}

interface ReviewDto {
  id: string;
  period: string;
  status: "open" | "closed";
  opened_by: string;
  opened_at: number;
  due_at: number;
  closed_at: number | null;
}

interface ReviewItemDto {
  user: { id: string; display_name: string | null };
  role: { name: string; label: string };
  decision: null | "keep" | "remove";
  state: "open" | "decided" | "changed";
}

interface CurrentReviewBody {
  review: ReviewDto | null;
  items: ReviewItemDto[];
  progress: { decided: number; total: number };
  overdue: boolean;
}

interface MeBody {
  roles: string[];
  permissions: string[];
  jit: { expires_at: number } | null;
}

interface ProblemBody {
  type: string;
  status: number;
  rule?: string;
  permissions?: string[];
  pairs?: string[][];
  roles?: Array<{ id: string; name: string; label: string }>;
}

interface JitExpiryModule {
  runJitExpiry(e: typeof env, nowSeconds: number): Promise<unknown>;
}
interface RbacDailyModule {
  runRbacDaily(e: typeof env, nowSeconds: number): Promise<unknown>;
}

// ---------------------------------------------------------------- clock + db

const nowS = () => Math.floor(Date.now() / 1000);

function pin(at: string | number): void {
  vi.setSystemTime(typeof at === "number" ? new Date(at * 1000) : new Date(at));
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
  // SPEC-07 tables, children first — absent before C-07-001 (red run): ignore
  for (const table of ["access_review_items", "access_reviews", "role_change_requests", "sod_pairs", "jit_grants", "idempotency_keys"]) {
    try {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // not created yet
    }
  }
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
  await restoreSeedRoles();
}

async function sqlFirst<T>(query: string, ...binds: unknown[]): Promise<T | null> {
  return env.DB.prepare(query)
    .bind(...binds)
    .first<T>();
}

async function count(query: string, ...binds: unknown[]): Promise<number> {
  return (await sqlFirst<{ n: number }>(query, ...binds))?.n ?? -1;
}

const deniedCount = (actorId: string) =>
  count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'permission.denied' AND actor = ?", actorId);

async function auditMeta(action: string): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DB.prepare("SELECT metadata FROM audit_events WHERE action = ? ORDER BY ts")
    .bind(action)
    .all<{ metadata: string | null }>();
  return rows.results.map((r) => (r.metadata === null ? {} : (JSON.parse(r.metadata) as Record<string, unknown>)));
}

/** Roles that hold both codes of a declared pair — must always be 0 (FR-2). */
const sodViolations = () =>
  count(
    `SELECT COUNT(*) AS n FROM sod_pairs s JOIN roles r
       WHERE EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.key = s.perm_a)
         AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.key = s.perm_b)`,
  );

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

// ---------------------------------------------------------------- cron

async function cronModule<T>(path: string): Promise<T> {
  return (await import(/* @vite-ignore */ path)) as T;
}

async function runJitExpiry(at: number): Promise<void> {
  const mod = await cronModule<JitExpiryModule>("../../src/crons/jit-expiry");
  await mod.runJitExpiry(env, at);
}

async function runRbacDaily(at: number): Promise<void> {
  const mod = await cronModule<RbacDailyModule>("../../src/crons/rbac-daily");
  await mod.runRbacDaily(env, at);
}

/** The real `scheduled()` entry, with the cron string wrangler.toml declares. Uses the pinned clock. */
async function runScheduled(cron: "*/5 * * * *" | "0 3 * * *"): Promise<void> {
  const ctx = createExecutionContext();
  const controller = createScheduledController({ cron, scheduledTime: new Date(Date.now()) });
  worker.scheduled(controller as unknown as ScheduledEvent, env, ctx);
  await waitOnExecutionContext(ctx);
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
  return { userId: admin.userId, email: admin.session.email, session: admin.session };
}

function inviteRaw(by: Person, role: string, email: string, displayName: string): Promise<Response> {
  return by.session.fetch("/admin/users", { method: "POST", body: JSON.stringify({ email, display_name: displayName, role }) });
}

async function invite(by: Person, role: string, email: string, displayName: string): Promise<Person> {
  const res = await inviteRaw(by, role, email, displayName);
  expect(res.status, `invite ${email}`).toBe(201);
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

async function relogin(...people: Person[]): Promise<void> {
  for (const p of people) {
    const cookies = await loginAs(fetcher, { email: p.email, password: PASSWORD, origin: ORIGIN });
    p.session = createSession({ userId: p.userId, email: p.email, ...cookies, fetcher, origin: ORIGIN });
  }
}

interface Team {
  admin: Person;
  gd: Person;
  ql: Person;
  nv: Person;
}

async function team(): Promise<Team> {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
  return { admin, gd, ql, nv };
}

// ---------------------------------------------------------------- API helpers

const post = (by: Person, path: string, body: unknown = {}, headers?: Record<string, string>) =>
  by.session.fetch(path, { method: "POST", body: JSON.stringify(body), headers });

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

const patchRole = (by: Person, id: string, body: Record<string, unknown>) =>
  by.session.fetch(`/roles/${id}`, { method: "PATCH", body: JSON.stringify(body) });
const deleteRole = (by: Person, id: string, version: number) =>
  by.session.fetch(`/roles/${id}?expected_version=${version}`, { method: "DELETE" });
const createRoleRaw = (by: Person, body: Record<string, unknown>) => post(by, "/roles", body);

async function createRole(by: Person, label: string, permissions: string[]): Promise<RoleDto> {
  const res = await createRoleRaw(by, { label, permissions });
  expect(res.status, `POST /roles ${label}`).toBe(201);
  return res.json();
}

/** Full new permission set, pinned to the role's version (SPEC-07 §3.2). */
const requestChangeRaw = (by: Person, r: RoleDto, permissions: string[], note?: string) =>
  post(by, `/roles/${r.id}/change-requests`, { expected_version: r.version, permissions, ...(note !== undefined && { note }) });

async function requestChange(by: Person, r: RoleDto, permissions: string[], note?: string): Promise<ChangeRequestDto> {
  const res = await requestChangeRaw(by, r, permissions, note);
  expect(res.status, `change request on ${r.name}`).toBe(201);
  return res.json();
}

async function listRequests(by: Person, status?: string): Promise<ChangeRequestDto[]> {
  const res = await by.session.fetch(`/role-change-requests${status === undefined ? "" : `?status=${status}`}`);
  expect(res.status).toBe(200);
  return (await res.json<{ items: ChangeRequestDto[] }>()).items;
}

const approve = (by: Person, id: string, note?: string) =>
  post(by, `/role-change-requests/${id}/approve`, note === undefined ? {} : { note });
const reject = (by: Person, id: string, note?: string) =>
  post(by, `/role-change-requests/${id}/reject`, note === undefined ? {} : { note });
const withdraw = (by: Person, id: string) => post(by, `/role-change-requests/${id}/withdraw`);

const addPair = (by: Person, a: string, b: string, reason?: string) =>
  post(by, "/sod-pairs", { perm_a: a, perm_b: b, ...(reason !== undefined && { reason }) });
const deletePair = (by: Person, id: string) => by.session.fetch(`/sod-pairs/${id}`, { method: "DELETE" });

async function listPairs(by: Person): Promise<SodPairDto[]> {
  const res = await by.session.fetch("/sod-pairs");
  expect(res.status).toBe(200);
  return (await res.json<{ items: SodPairDto[] }>()).items;
}

const grantJitRaw = (by: Person, body: Record<string, unknown>, key?: string) =>
  post(by, "/admin/jit-grants", body, key === undefined ? undefined : { "Idempotency-Key": key });

async function grantJit(by: Person, to: Person, minutes: number, reason = "Sửa cấu hình email khi quản trị nghỉ phép"): Promise<JitGrantDto> {
  const res = await grantJitRaw(by, { user_id: to.userId, reason, minutes });
  expect(res.status, "grant JIT").toBe(201);
  return res.json();
}

async function listJit(by: Person, active?: boolean): Promise<JitGrantDto[]> {
  const res = await by.session.fetch(`/admin/jit-grants${active === undefined ? "" : `?active=${String(active)}`}`);
  expect(res.status).toBe(200);
  return (await res.json<{ items: JitGrantDto[] }>()).items;
}

const revokeJit = (by: Person, id: string) => post(by, `/admin/jit-grants/${id}/revoke`);

async function currentReview(by: Person): Promise<CurrentReviewBody> {
  const res = await by.session.fetch("/access-reviews/current");
  expect(res.status).toBe(200);
  return res.json();
}

const openReview = (by: Person) => post(by, "/access-reviews");
const decide = (by: Person, reviewId: string, userId: string, decision: "keep" | "remove") =>
  post(by, `/access-reviews/${reviewId}/items/${userId}`, { decision });
const closeReview = (by: Person, reviewId: string) => post(by, `/access-reviews/${reviewId}/close`);

async function me(p: Person): Promise<MeBody> {
  const res = await p.session.fetch("/me");
  expect(res.status).toBe(200);
  return res.json();
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

const without = (xs: string[], ...drop: string[]) => xs.filter((x) => !drop.includes(x));
const sorted = <T extends string | number>(xs: readonly T[]): T[] => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// ================================================================ tests

describe("SPEC-07 advanced RBAC (acceptance)", () => {
  beforeEach(async () => {
    // Date only, and it keeps ticking (frozen time would stall idempotency polling).
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    pin(DAY_ONE_Q4);
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await restoreSeedRoles();
  });

  // ------------------------------------------------------------ SoD

  it("AC-1 / FR-1, FR-10: catalog has jit:grant + reviews:write (Giám đốc only); a pair a role already violates → 409 sod-conflict + roles; clean pair → 201 + sod.pair_added; reversed → 409 duplicate; bad codes → 422; delete → 204", async () => {
    const { admin, gd, ql, nv } = await team();

    // FR-10 / DEC-13
    const catalog = (await listRoles(gd)).catalog;
    for (const code of NEW_CODES) expect(catalog).toContain(code);
    expect(catalog).toHaveLength(23); // + SPEC-08 FR-7 price:write, product:write; + SPEC-09 DEC-10 B quote/payment_request/delivery_note:write
    expect(sorted((await me(gd)).permissions)).toEqual(SEED_GRANTS["giam_doc"]);
    for (const p of [admin, ql, nv]) {
      const perms = (await me(p)).permissions;
      for (const code of NEW_CODES) expect(perms).not.toContain(code);
    }

    // giam_doc holds both (quan_ly holds only contract:issue) → refused, lists exactly the violating roles
    const conflict = await problemOf(await addPair(gd, "contract:issue", "template:write"), 409, "sod-conflict");
    expect(conflict.roles?.map((r) => r.name)).toEqual(["giam_doc"]);
    expect(conflict.roles?.[0]?.label).toBe("Giám đốc");
    // a pair the locked admin role violates (users:write + settings:write) → refused too (R-7)
    const adminConflict = await problemOf(await addPair(gd, "users:write", "settings:write"), 409, "sod-conflict");
    expect(adminConflict.roles?.map((r) => r.name)).toEqual(["admin"]);
    expect(await count("SELECT COUNT(*) AS n FROM sod_pairs")).toBe(0);

    // no role holds both → 201, stored ordered (perm_a < perm_b)
    const res = await addPair(gd, "settings:write", "contract:issue", "Người phát hành không đổi cấu hình hệ thống");
    expect(res.status).toBe(201);
    const pair: SodPairDto = await res.json();
    expect(pair).toMatchObject({ perm_a: "contract:issue", perm_b: "settings:write", reason: "Người phát hành không đổi cấu hình hệ thống" });
    const added = await auditMeta("sod.pair_added");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ perm_a: "contract:issue", perm_b: "settings:write" });

    // (B, A) is the same pair
    await problemOf(await addPair(gd, ...PAIR), 409, "duplicate");
    // closed catalog, two different codes
    await problemOf(await addPair(gd, "contract:delete", "settings:write"), 422, "validation");
    await problemOf(await addPair(gd, "contract:issue", "contract:issue"), 422, "validation");

    // everyone logged in may read the pairs (the matrix explains them)
    const seen = await listPairs(nv);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: pair.id, perm_a: "contract:issue", perm_b: "settings:write", created_by_name: "Nguyễn Nhật Minh" });

    // only roles:write declares / deletes
    await problemOf(await addPair(nv, "contract:read", "settings:read"), 403, "forbidden");
    expect(await deniedCount(nv.userId)).toBe(1);

    expect((await deletePair(gd, pair.id)).status).toBe(204);
    expect(await auditMeta("sod.pair_removed")).toHaveLength(1);
    expect(await listPairs(gd)).toHaveLength(0);
    await problemOf(await deletePair(gd, pair.id), 404, "not-found");
  }, 60_000);

  it("AC-2 / FR-2: with a declared pair — POST /roles holding both → 409 sod-conflict + pairs; a request adding the second code → 409 at create; pair declared after the request → approve 409, nothing changes; pair ∥ approve → never a role holding both", async () => {
    const { admin, gd } = await team();
    const pairRes = await addPair(gd, ...PAIR);
    expect(pairRes.status).toBe(201);
    const pair: SodPairDto = await pairRes.json();

    // create (and clone) is checked — SoD before grant_not_held (R-9)
    const created = await problemOf(await createRoleRaw(gd, { label: "Phát hành kiêm cấu hình", permissions: [...PAIR] }), 409, "sod-conflict");
    expect(created.pairs).toEqual([["contract:issue", "settings:write"]]);
    expect(await count("SELECT COUNT(*) AS n FROM roles WHERE is_system = 0")).toBe(0);
    // a role without the second code still goes straight through (DEC-2 A)
    await createRole(gd, "Kế toán", ["contract:read"]);

    // request create: quan_ly holds contract:issue; admin (holds settings:write) asks to add settings:write
    const ql = await role(admin, "quan_ly");
    const atCreate = await problemOf(await requestChangeRaw(admin, ql, [...ql.permissions, "settings:write"]), 409, "sod-conflict");
    expect(atCreate.pairs).toEqual([["contract:issue", "settings:write"]]);
    expect(await count("SELECT COUNT(*) AS n FROM role_change_requests")).toBe(0);

    // the pair is removed, the request goes in, the pair comes back → approving re-checks SoD at apply time
    expect((await deletePair(gd, pair.id)).status).toBe(204);
    const req = await requestChange(admin, ql, [...ql.permissions, "settings:write"]);
    expect((await addPair(gd, ...PAIR)).status).toBe(201); // quan_ly does not hold settings:write YET
    const late = await problemOf(await approve(gd, req.id), 409, "sod-conflict");
    expect(late.pairs).toEqual([["contract:issue", "settings:write"]]);
    expect(await rolePermsInDb("quan_ly")).toEqual(SEED_GRANTS["quan_ly"]);
    expect((await role(gd, "quan_ly")).version).toBe(ql.version);
    expect(await auditMeta("role.change_approved")).toHaveLength(0);
    expect(await sodViolations()).toBe(0);

    // race: Giám đốc approves while admin declares the pair again → one side wins, never a violating role
    const again = (await listPairs(gd))[0]!;
    expect((await deletePair(gd, again.id)).status).toBe(204);
    const [ap, decl] = await Promise.all([approve(gd, req.id), addPair(admin, ...PAIR)]);
    expect([
      [200, 409],
      [409, 201],
    ]).toContainEqual([ap.status, decl.status]);
    if (ap.status === 409) await problemOf(ap, 409, "sod-conflict");
    if (decl.status === 409) await problemOf(decl, 409, "sod-conflict");
    expect(await sodViolations()).toBe(0);
  }, 60_000);

  // ------------------------------------------------------------ four-eyes

  it("AC-3 / FR-3, DEC-1, DEC-4: PATCH with permissions → 422; change request → 201, nothing changes yet, role.change_requested, pending_request on GET /roles; 2nd request / PATCH / DELETE → 409 request-pending; guards own_role · admin_role · grant_not_held · stale · 404 · 422", async () => {
    const { admin, gd, ql: qlUser } = await team();
    const ql = await role(gd, "quan_ly");

    // DEC-1 A: PATCH /roles takes label/description only
    await problemOf(
      await patchRole(gd, ql.id, { expected_version: ql.version, permissions: without(ql.permissions, "contract:issue") }),
      422,
      "validation",
    );

    const req = await requestChange(gd, ql, without(ql.permissions, "contract:issue"), "Quản lý thôi phát hành từ quý này");
    expect(req).toMatchObject({
      role_id: ql.id,
      role_name: "quan_ly",
      role_label: "Quản lý",
      base_version: ql.version,
      added: [],
      removed: ["contract:issue"],
      note: "Quản lý thôi phát hành từ quý này",
      status: "pending",
      requested_by: gd.userId,
      requested_by_name: "Nguyễn Nhật Minh",
      decided_by: null,
    });
    expect(req.expires_at - req.requested_at).toBe(7 * DAY);

    // nothing changed yet: role, version, the holder's live permissions
    const after = await role(gd, "quan_ly");
    expect(after.version).toBe(ql.version);
    expect(sorted(after.permissions)).toEqual(SEED_GRANTS["quan_ly"]);
    expect((await me(qlUser)).permissions).toContain("contract:issue");
    expect(after.pending_request).toMatchObject({ id: req.id, added: [], removed: ["contract:issue"], requested_by_name: "Nguyễn Nhật Minh" });
    expect(after.can.request).toBe(false);
    expect(after.request_locked_reason).toBe("request_pending");
    const logged = await auditMeta("role.change_requested");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ name: "quan_ly", added: [], removed: ["contract:issue"] });

    // DEC-4 A: one pending request per role; the role is locked while it waits
    await problemOf(await requestChangeRaw(admin, ql, without(ql.permissions, "audit:read")), 409, "request-pending");
    await problemOf(await patchRole(gd, ql.id, { expected_version: ql.version, label: "Quản lý cửa hàng" }), 409, "request-pending");
    const ke = await createRole(gd, "Kế toán", ["contract:read"]);
    await requestChange(gd, ke, []);
    await problemOf(await deleteRole(gd, ke.id, ke.version), 409, "request-pending");

    // 2a guards on the request
    const roles = await listRoles(gd);
    const byName = (n: string) => roles.items.find((r) => r.name === n)!;
    await expectRule(await requestChangeRaw(gd, byName("giam_doc"), without(byName("giam_doc").permissions, "audit:read")), "own_role");
    // FIX-05 R2 (was 403 admin_role): admin changes by request; its approver must be ANOTHER Giám đốc → none here
    await problemOf(await requestChangeRaw(gd, byName("admin"), [...byName("admin").permissions, "contract:read"]), 409, "no-eligible-approver");
    const notHeld = await expectRule(
      await requestChangeRaw(gd, byName("nhan_vien"), [...byName("nhan_vien").permissions, "settings:write"]),
      "grant_not_held",
    );
    expect(notHeld.permissions).toEqual(["settings:write"]);
    expect(await deniedCount(gd.userId)).toBe(2);

    // stale version, unknown role, nothing to change, unknown code
    const nv = byName("nhan_vien");
    await problemOf(await requestChangeRaw(gd, { ...nv, version: nv.version + 7 }, without(nv.permissions, "contract:submit")), 409, "stale");
    await problemOf(await requestChangeRaw(gd, { ...nv, id: UNKNOWN_ID }, without(nv.permissions, "contract:submit")), 404, "not-found");
    await problemOf(await requestChangeRaw(gd, nv, nv.permissions), 422, "validation");
    await problemOf(await requestChangeRaw(gd, nv, [...nv.permissions, "contract:delete"]), 422, "validation");
    expect(await count("SELECT COUNT(*) AS n FROM role_change_requests")).toBe(2);
  }, 60_000);

  it("AC-4 / FR-4, DEC-3: self approve → 403 self_approve; two admins approve at once → one 200 (version+1), one 409 not-pending; the holder loses the code on the next call; role.change_approved + role.permissions_changed", async () => {
    const { admin, gd, ql: qlUser, nv } = await team();
    const admin2 = await invite(gd, "admin", "kythuat@nhatminh.vn", "Quản trị 2"); // FIX-05: only Giám đốc assigns admin

    // warm the Quản lý principal cache while the permission is live
    expect((await me(qlUser)).permissions).toContain("contract:issue");

    const ql = await role(gd, "quan_ly");
    const req = await requestChange(gd, ql, without(ql.permissions, "contract:issue"));

    await expectRule(await approve(gd, req.id), "self_approve");
    expect(await deniedCount(gd.userId)).toBe(1);
    await problemOf(await approve(nv, req.id), 403, "forbidden"); // no roles:write
    // the list tells each caller what they may do (hint; the API decides)
    const asGd = (await listRequests(gd, "pending")).find((r) => r.id === req.id)!;
    expect(asGd).toMatchObject({ can: { approve: false, reject: false, withdraw: true }, locked_reason: "self_approve" });
    const asAdmin = (await listRequests(admin, "pending")).find((r) => r.id === req.id)!;
    expect(asAdmin).toMatchObject({ can: { approve: true, reject: true, withdraw: false }, locked_reason: null });

    const [a, b] = await Promise.all([approve(admin, req.id), approve(admin2, req.id)]);
    expect(sorted([a.status, b.status])).toEqual([200, 409]);
    await problemOf(a.status === 409 ? a : b, 409, "not-pending");
    const won: { request: ChangeRequestDto; role: RoleDto } = await (a.status === 200 ? a : b).json();
    expect(won.request.status).toBe("approved");
    expect([admin.userId, admin2.userId]).toContain(won.request.decided_by);
    expect(won.role.version).toBe(ql.version + 1);
    expect(sorted(won.role.permissions)).toEqual(without(SEED_GRANTS["quan_ly"]!, "contract:issue"));

    // same Quản lý session, next call: revoked (cache purged for every holder)
    expect((await qlUser.session.fetch(`/contracts/${UNKNOWN_ID}/issue`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await me(qlUser)).permissions).not.toContain("contract:issue");

    expect(await auditMeta("role.change_approved")).toHaveLength(1);
    const changed = await auditMeta("role.permissions_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ added: [], removed: ["contract:issue"] });

    await problemOf(await approve(admin, req.id), 409, "not-pending");
    const unlocked = await role(gd, "quan_ly");
    expect(unlocked.pending_request).toBeNull();
    expect(unlocked.request_locked_reason).toBeNull();
  }, 60_000);

  it("AC-4 / FR-4: reject needs a note; withdraw is the requester's only; a holder may approve a REMOVAL from their own role (DEC-3); the requester lost the added code → 403 grant_not_held, request stays pending", async () => {
    const { admin, gd } = await team();
    const ql = await role(gd, "quan_ly");

    // reject
    const r1 = await requestChange(gd, ql, without(ql.permissions, "audit:read"));
    await expectRule(await reject(gd, r1.id, "tự từ chối"), "self_approve");
    await problemOf(await reject(admin, r1.id), 422, "validation");
    const rej = await reject(admin, r1.id, "Quản lý vẫn cần xem nhật ký");
    expect(rej.status).toBe(200);
    expect((await listRequests(gd)).find((r) => r.id === r1.id)).toMatchObject({ status: "rejected", decision_note: "Quản lý vẫn cần xem nhật ký" });
    expect(await auditMeta("role.change_rejected")).toHaveLength(1);
    await problemOf(await reject(admin, r1.id, "lần hai"), 409, "not-pending");

    // withdraw
    const r2 = await requestChange(gd, ql, without(ql.permissions, "audit:read"));
    await problemOf(await withdraw(admin, r2.id), 403, "forbidden");
    expect(await deniedCount(admin.userId)).toBe(1);
    expect((await withdraw(gd, r2.id)).status).toBe(200);
    expect(await auditMeta("role.change_withdrawn")).toHaveLength(1);
    await problemOf(await withdraw(gd, r2.id), 409, "not-pending");
    expect(sorted(await rolePermsInDb("quan_ly"))).toEqual(SEED_GRANTS["quan_ly"]);

    // DEC-3: Giám đốc carries giam_doc but may approve taking a code AWAY from it
    const gdRole = await role(admin, "giam_doc");
    const r3 = await requestChange(admin, gdRole, without(gdRole.permissions, "users:write"));
    expect((await approve(gd, r3.id)).status).toBe(200);
    expect((await me(gd)).permissions).not.toContain("users:write");
    await restoreSeedRoles();

    // FR-12 repeated at apply time: the requester no longer holds the added code
    const nv = await role(gd, "nhan_vien");
    const r4 = await requestChange(gd, nv, [...nv.permissions, "template:write"]);
    await env.DB.prepare(
      "DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'giam_doc') AND permission_id = (SELECT id FROM permissions WHERE key = 'template:write')",
    ).run();
    const lost = await expectRule(await approve(admin, r4.id), "grant_not_held");
    expect(lost.permissions).toEqual(["template:write"]);
    expect(await rolePermsInDb("nhan_vien")).toEqual(SEED_GRANTS["nhan_vien"]);
    expect((await listRequests(admin, "pending")).map((r) => r.id)).toContain(r4.id);
  }, 60_000);

  it("AC-5 / FR-4, §4 Time: at requested_at + 7 days approve → 409 expired; GET shows expired; nightly cron writes role.change_expired once; the role is unlocked", async () => {
    const t0 = nowS();
    const { admin, gd } = await team();
    const ql = await role(gd, "quan_ly");
    const req = await requestChange(gd, ql, without(ql.permissions, "contract:issue"));
    expect(req.expires_at).toBeGreaterThanOrEqual(t0 + 7 * DAY);

    pin(req.expires_at); // exactly at the deadline: expired (pending AND expires_at <= now)
    await relogin(admin, gd);
    await problemOf(await approve(admin, req.id), 409, "expired");
    expect((await listRequests(admin, "expired")).find((r) => r.id === req.id)?.status).toBe("expired");
    expect((await listRequests(admin, "pending")).some((r) => r.id === req.id)).toBe(false);
    expect((await role(gd, "quan_ly")).pending_request).toBeNull();
    expect(sorted(await rolePermsInDb("quan_ly"))).toEqual(SEED_GRANTS["quan_ly"]);

    await runRbacDaily(nowS());
    await runRbacDaily(nowS() + 60); // missed / repeated ticks never log twice
    expect(await auditMeta("role.change_expired")).toHaveLength(1);
    expect(await sqlFirst<{ status: string }>("SELECT status FROM role_change_requests WHERE id = ?", req.id)).toEqual({ status: "expired" });

    // unlocked: label edit and a fresh request both go through
    expect((await patchRole(gd, ql.id, { expected_version: ql.version, label: "Quản lý cửa hàng" })).status).toBe(200);
    const fresh = await role(gd, "quan_ly");
    await requestChange(gd, fresh, without(fresh.permissions, "audit:read"));
  }, 60_000);

  it("AC-13 / FR-11, DEC-14: nobody else can approve → 409 no-eligible-approver at create (and GET /roles says so before the click)", async () => {
    const { admin, gd } = await team();

    // FIX-05 R1 replaced the old case here (admin adding to giam_doc → 409; Giám đốc now approves it, fix-05-owner.test.ts).
    // Still locked: a change to the admin role needs ANOTHER Giám đốc (R2) — Giám đốc is the only one.
    const adminRole = await role(gd, "admin");
    expect(adminRole.can.request).toBe(false);
    expect(adminRole.request_locked_reason).toBe("no_approver");
    await problemOf(await requestChangeRaw(gd, adminRole, without(adminRole.permissions, "notes:write")), 409, "no-eligible-approver");

    // the admin account is disabled → Giám đốc is the only permanent roles:write left
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(admin.userId).run();
    const ql = await role(gd, "quan_ly");
    expect(ql.can.request).toBe(false);
    expect(ql.request_locked_reason).toBe("no_approver");
    await problemOf(await requestChangeRaw(gd, ql, without(ql.permissions, "contract:issue")), 409, "no-eligible-approver");
    expect(await count("SELECT COUNT(*) AS n FROM role_change_requests")).toBe(0);
    expect(await auditMeta("role.change_requested")).toHaveLength(0);
  }, 60_000);

  // ------------------------------------------------------------ JIT

  it("AC-6 / FR-5, DEC-6, DEC-8: Giám đốc grants 60 min → the recipient carries ONLY admin; expiry cuts at the next request even with a warm cache; */5 cron logs jit.expired once", async () => {
    const { gd, nv } = await team();
    const key = crypto.randomUUID();
    const body = { user_id: nv.userId, reason: "Sửa cấu hình email khi quản trị nghỉ phép", minutes: 60 };
    const res = await grantJitRaw(gd, body, key);
    expect(res.status).toBe(201);
    const grant: JitGrantDto = await res.json();
    expect(grant).toMatchObject({ user_id: nv.userId, user_name: "Minh Khánh", granted_by: gd.userId, state: "active", revoked_at: null });
    expect(grant.expires_at - grant.created_at).toBe(60 * MINUTE);
    // double click → same grant
    const replay = await grantJitRaw(gd, body, key);
    expect(replay.status).toBe(201);
    expect((await replay.json<JitGrantDto>()).id).toBe(grant.id);
    const granted = await auditMeta("jit.granted");
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({ reason: body.reason, expires_at: grant.expires_at });

    // DEC-6 A: replace, not add — admin's permissions, none of nhan_vien's
    const during = await me(nv);
    expect(during.roles).toEqual(["admin"]);
    expect(during.permissions).toContain("settings:write");
    expect(during.permissions).not.toContain("contract:write");
    expect(during.permissions).not.toContain("contract:read");
    expect(during.jit).toEqual({ expires_at: grant.expires_at });
    expect((await nv.session.fetch("/admin/settings")).status).toBe(200);
    expect((await nv.session.fetch("/contracts")).status).toBe(403);
    // DEC-6: never written to user_roles
    expect(await rolesOfUser(nv.userId)).toEqual(["nhan_vien"]);
    expect((await listJit(gd, true)).map((g) => g.id)).toEqual([grant.id]);

    // DEC-8: warm the cache 30 s before the end, step 5 s past it — the KV entry is still there, the request is cut
    pin(grant.expires_at - 30);
    await relogin(nv);
    expect((await me(nv)).roles).toEqual(["admin"]);
    pin(grant.expires_at + 5);
    expect(await env.SESSIONS.get(`session:${nv.userId}`)).not.toBeNull();
    expect((await nv.session.fetch("/admin/settings")).status).toBe(403);
    const after = await me(nv);
    expect(after.roles).toEqual(["nhan_vien"]);
    expect(after.permissions).not.toContain("settings:write");
    expect(after.jit).toBeNull();

    // */5 cron through scheduled(), then a repeated tick → one jit.expired
    pin(grant.expires_at + 5 * MINUTE);
    await runScheduled("*/5 * * * *");
    await runJitExpiry(nowS() + 5 * MINUTE);
    const expired = await auditMeta("jit.expired");
    expect(expired).toHaveLength(1);
    await relogin(gd);
    expect((await listJit(gd)).find((g) => g.id === grant.id)?.state).toBe("expired");
    expect(await listJit(gd, true)).toHaveLength(0);
  }, 60_000);

  it("AC-7 / FR-6, DEC-5, DEC-7: self grant → 403 self_grant; bad minutes/reason → 422; admin / already active → 409; a JIT holder cannot pass admin_only, approve, grant JIT; JIT never counts as an admin for last-admin", async () => {
    const { admin, gd, ql, nv } = await team();

    await expectRule(await grantJitRaw(gd, { user_id: gd.userId, reason: "Tự cấp để sửa nhanh", minutes: 30 }), "self_grant");
    expect(await deniedCount(gd.userId)).toBe(1);
    await problemOf(await grantJitRaw(gd, { user_id: nv.userId, reason: "Sửa cấu hình email", minutes: 540 }), 422, "validation");
    await problemOf(await grantJitRaw(gd, { user_id: nv.userId, reason: "Sửa cấu hình email", minutes: 10 }), 422, "validation");
    await problemOf(await grantJitRaw(gd, { user_id: nv.userId, reason: "ngắn", minutes: 30 }), 422, "validation");
    await problemOf(await grantJitRaw(gd, { user_id: admin.userId, reason: "Sửa cấu hình email", minutes: 30 }), 409, "already-admin");
    await problemOf(await grantJitRaw(gd, { user_id: UNKNOWN_ID, reason: "Sửa cấu hình email", minutes: 30 }), 404, "not-found");
    const pending = await inviteRaw(admin, "nhan_vien", "lan@nhatminh.vn", "Phạm Thu Lan"); // never activated
    const pendingId = (await pending.json<{ user: { id: string } }>()).user.id;
    expect((await grantJitRaw(gd, { user_id: pendingId, reason: "Sửa cấu hình email", minutes: 30 })).status).toBe(422);
    await problemOf(await grantJitRaw(admin, { user_id: nv.userId, reason: "Sửa cấu hình email", minutes: 30 }), 403, "forbidden"); // admin has no jit:grant

    await grantJit(gd, nv, 60);
    await problemOf(await grantJitRaw(gd, { user_id: nv.userId, reason: "Cấp thêm lần hai", minutes: 30 }), 409, "jit-active");

    // the JIT holder passes requirePerm with admin's codes, but every D1 guard ignores JIT (DEC-7)
    await expectRule(
      await nv.session.fetch(`/admin/users/${ql.userId}`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
      "owner_only", // FIX-05 (was admin_only): assigning a role with roles:write is for Giám đốc only
    );
    expect(await rolesOfUser(ql.userId)).toEqual(["quan_ly"]);
    const qlRole = await role(gd, "quan_ly");
    const req = await requestChange(gd, qlRole, without(qlRole.permissions, "audit:read"));
    await expectRule(await approve(nv, req.id), "jit_actor");
    await problemOf(await grantJitRaw(nv, { user_id: ql.userId, reason: "Cấp tiếp cho người khác", minutes: 30 }), 403, "forbidden");
    expect(await deniedCount(nv.userId)).toBe(3);

    // the only PERMANENT admin cannot be disabled, JIT holder or not
    await problemOf(
      await admin.session.fetch(`/admin/users/${admin.userId}`, { method: "PATCH", body: JSON.stringify({ status: "disabled" }) }),
      409,
      "last-admin",
    );
  }, 60_000);

  it("AC-8 / FR-5: Giám đốc revokes early → next request loses admin, jit.revoked; the recipient ends their own grant; nobody else revokes; revoked grants never log jit.expired", async () => {
    const { gd, ql, nv } = await team();

    const g1 = await grantJit(gd, nv, 60);
    expect((await me(nv)).roles).toEqual(["admin"]); // warm cache
    const rv = await revokeJit(gd, g1.id);
    expect(rv.status).toBe(200);
    expect((await rv.json<JitGrantDto>()).state).toBe("revoked");
    expect((await nv.session.fetch("/admin/settings")).status).toBe(403);
    expect((await me(nv)).jit).toBeNull();
    expect(await auditMeta("jit.revoked")).toHaveLength(1);
    await problemOf(await revokeJit(gd, g1.id), 409, "not-active");
    await problemOf(await revokeJit(gd, UNKNOWN_ID), 404, "not-found");

    // "Kết thúc sớm": the recipient ends it; a third person cannot
    const g2 = await grantJit(gd, ql, 30);
    const deniedBefore = await deniedCount(nv.userId); // the 403 on /admin/settings above already wrote one
    await problemOf(await revokeJit(nv, g2.id), 403, "forbidden");
    expect(await deniedCount(nv.userId)).toBe(deniedBefore + 1);
    expect((await revokeJit(ql, g2.id)).status).toBe(200);
    expect((await me(ql)).roles).toEqual(["quan_ly"]);
    expect(await auditMeta("jit.revoked")).toHaveLength(2);

    await runJitExpiry(nowS() + 2 * HOUR);
    expect(await auditMeta("jit.expired")).toHaveLength(0);
  }, 60_000);

  // ------------------------------------------------------------ access review

  it("AC-9 / FR-7, DEC-12: the 0 3 cron on 01/10 opens ONE review 2026-Q4 with one row per active user; again / by hand → no second; the quarter follows Vietnam time", async () => {
    const { admin, gd } = await team();
    await inviteRaw(admin, "nhan_vien", "lan@nhatminh.vn", "Phạm Thu Lan"); // pending → not in the snapshot
    const off = await invite(admin, "nhan_vien", "hoa@nhatminh.vn", "Lê Hoa");
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(off.userId).run(); // disabled → not in it

    await runScheduled("0 3 * * *");
    await runRbacDaily(nowS() + 60);
    expect(await count("SELECT COUNT(*) AS n FROM access_reviews")).toBe(1);
    expect(await auditMeta("review.opened")).toHaveLength(1);
    await problemOf(await openReview(gd), 409, "duplicate");

    const cur = await currentReview(gd);
    expect(cur.review).toMatchObject({ period: "2026-Q4", status: "open", opened_by: "system:cron" });
    expect(cur.review!.due_at - cur.review!.opened_at).toBe(15 * DAY);
    expect(cur.progress).toEqual({ decided: 0, total: 4 });
    expect(cur.overdue).toBe(false);
    expect(sorted(cur.items.map((i) => i.role.name))).toEqual(["admin", "giam_doc", "nhan_vien", "quan_ly"]);
    expect(cur.items.find((i) => i.role.name === "quan_ly")).toMatchObject({ role: { label: "Quản lý" }, decision: null, state: "open" });
    expect(cur.items.some((i) => i.user.id === off.userId)).toBe(false);

    // 31/12 17:30 UTC is already 01/01/2027 in Vietnam → the hand-opened review is 2027-Q1
    pin("2026-12-31T17:30:00.000Z");
    await relogin(gd);
    const q1 = await openReview(gd);
    expect(q1.status).toBe(201);
    expect((await q1.json<ReviewDto>()).period).toBe("2027-Q1");
  }, 60_000);

  it("AC-10 / FR-7, FR-8, DEC-10, DEC-11: Giữ / Gỡ (= disable, session 401); own row 403 self_review, admin decides it; admin row Gỡ 403 admin_only; a changed row is closed (409 item-changed); close only when complete", async () => {
    const { admin, gd, ql, nv } = await team();
    const c = await invite(admin, "nhan_vien", "lan@nhatminh.vn", "Phạm Thu Lan");
    const opened = await openReview(gd);
    expect(opened.status).toBe(201);
    const review: ReviewDto = await opened.json();
    expect(review.period).toBe("2026-Q4");
    expect(review.opened_by).toBe(gd.userId);

    await problemOf(await closeReview(gd, review.id), 409, "review-incomplete");

    // Giữ
    expect((await decide(gd, review.id, ql.userId, "keep")).status).toBe(200);
    const kept = await auditMeta("review.item_decided");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ user: ql.userId, decision: "keep", role: "quan_ly" });

    // Gỡ = disable the account (FIX-03 guards, refresh revoked, cache purged)
    expect((await decide(gd, review.id, nv.userId, "remove")).status).toBe(200);
    expect(await sqlFirst<{ status: string }>("SELECT status FROM users WHERE id = ?", nv.userId)).toEqual({ status: "disabled" });
    expect((await nv.session.fetch("/me")).status).toBe(401);
    expect(await auditMeta("user.disabled")).toHaveLength(1);

    // DEC-11: never your own row; the permanent roles:write holder (admin) decides the reviewer's row — and only that one (R-11)
    await expectRule(await decide(gd, review.id, gd.userId, "keep"), "self_review");
    expect((await decide(admin, review.id, gd.userId, "keep")).status).toBe(200);
    await problemOf(await decide(admin, review.id, c.userId, "keep"), 403, "forbidden");
    expect(await deniedCount(admin.userId)).toBe(1);

    // admin row: Gỡ is admin-only (FIX-03), Giữ is fine
    await expectRule(await decide(gd, review.id, admin.userId, "remove"), "admin_only");
    expect(await sqlFirst<{ status: string }>("SELECT status FROM users WHERE id = ?", admin.userId)).toEqual({ status: "active" });
    expect((await decide(gd, review.id, admin.userId, "keep")).status).toBe(200);

    // C changes role mid-review → the row closes itself
    expect((await gd.session.fetch(`/admin/users/${c.userId}`, { method: "PATCH", body: JSON.stringify({ role: "quan_ly" }) })).status).toBe(200);
    const mid = await currentReview(gd);
    expect(mid.items.find((i) => i.user.id === c.userId)?.state).toBe("changed");
    await problemOf(await decide(gd, review.id, c.userId, "keep"), 409, "item-changed");
    expect(mid.progress).toEqual({ decided: 4, total: 5 });

    // every row decided or changed → close
    const closed = await closeReview(gd, review.id);
    expect(closed.status).toBe(200);
    expect(await auditMeta("review.closed")).toHaveLength(1);
    await problemOf(await decide(gd, review.id, ql.userId, "remove"), 409, "review-closed");
  }, 60_000);

  it("AC-11 / FR-8: an open review past 15 days is overdue", async () => {
    const { gd } = await team();
    const review: ReviewDto = await (await openReview(gd)).json();

    pin(review.opened_at + 14 * DAY);
    await relogin(gd);
    expect((await currentReview(gd)).overdue).toBe(false);

    pin(review.opened_at + 16 * DAY);
    await relogin(gd);
    const late = await currentReview(gd);
    expect(late.review?.id).toBe(review.id);
    expect(late.overdue).toBe(true);
  }, 60_000);

  // ------------------------------------------------------------ access sweep

  it("§7 / §5: every new endpoint — anonymous → 401; Nhân viên → 403 + one permission.denied each; GET /sod-pairs is open to any logged-in user", async () => {
    const { gd, ql, nv } = await team();
    const qlRole = await role(gd, "quan_ly");
    const req = await requestChange(gd, qlRole, without(qlRole.permissions, "audit:read"));
    const grant = await grantJit(gd, ql, 30);
    const review: ReviewDto = await (await openReview(gd)).json();

    const calls: Array<[string, string, unknown?]> = [
      ["GET", "/role-change-requests"],
      ["POST", `/roles/${qlRole.id}/change-requests`, { expected_version: qlRole.version, permissions: [] }],
      ["POST", `/role-change-requests/${req.id}/approve`, {}],
      ["POST", `/role-change-requests/${req.id}/reject`, { note: "không" }],
      ["POST", `/role-change-requests/${req.id}/withdraw`, {}],
      ["POST", "/sod-pairs", { perm_a: "contract:read", perm_b: "settings:read" }],
      ["DELETE", `/sod-pairs/${UNKNOWN_ID}`],
      ["GET", "/admin/jit-grants"],
      ["POST", "/admin/jit-grants", { user_id: gd.userId, reason: "Tự cấp cho giám đốc", minutes: 30 }],
      ["POST", `/admin/jit-grants/${grant.id}/revoke`, {}],
      ["GET", "/access-reviews/current"],
      ["POST", "/access-reviews", {}],
      ["POST", `/access-reviews/${review.id}/items/${ql.userId}`, { decision: "keep" }],
      ["POST", `/access-reviews/${review.id}/close`, {}],
    ];

    let denied = await deniedCount(nv.userId);
    for (const [method, path, body] of calls) {
      const init: RequestInit = { method, ...(body !== undefined && { body: JSON.stringify(body) }) };
      const res = await nv.session.fetch(path, init);
      expect(res.status, `${method} ${path} as Nhân viên`).toBe(403);
      denied += 1;
      expect(await deniedCount(nv.userId), `${method} ${path} denied row`).toBe(denied);

      const anon = await fetcher(`${ORIGIN}${path}`, { ...init, headers: method === "GET" ? undefined : CSRF_HEADERS });
      expect(anon.status, `${method} ${path} anonymous`).toBe(401);
    }

    expect((await nv.session.fetch("/sod-pairs")).status).toBe(200);
    expect((await fetcher(`${ORIGIN}/sod-pairs`)).status).toBe(401);
    expect((await me(nv)).jit).toBeNull();
  }, 90_000);
});
