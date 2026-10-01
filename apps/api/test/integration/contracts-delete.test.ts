/** C-04b-001c: delete-draft side effects — id-only audit metadata, no dangling replaced_by_id, second DELETE 404. Helpers copied from contracts-4b-acceptance. */
import { SELF, env } from "cloudflare:test";
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
import { getDb } from "../../src/db/client";
import { jwtRevocations, refreshTokens, userRoles, users, verificationTokens } from "../../src/db/schema";
import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import { assignRoleByName } from "../../src/services/admin-service";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);

/** 28/09/2026 10:00 giờ VN — the Nhật Minh fixture day. */
const FIXTURE_DAY = "2026-09-28T03:00:00Z";

type Role = "giam_doc" | "quan_ly" | "nhan_vien";
interface Staff {
  userId: string;
  email: string;
  session: RunwaySession;
}

interface Step {
  id: string;
  step_no: number;
  label: string;
  status: "waiting" | "approved" | "rejected";
  required_permission: string;
  required_role: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  note: string | null;
  snapshot_hash_at_decision: string | null;
}

interface Snapshot {
  template: { id: string; version_id: string; version_no: number };
  customer: { id: string; name: string; phone: string | null };
  package: { code: string; unit_price: number };
  fields: Record<string, string>;
  lines: Array<{ description: string; qty: number; unit_price: number; discount_bps: number; amount: number }>;
  gross: number;
  discount_amount: number;
  total: number;
  total_words: string;
  dates: { doc_date: string; start: string; end: string };
}

interface Contract {
  id: string;
  type: string;
  status: "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";
  number: string | null;
  seq: number | null;
  series_year: number | null;
  template_id: string;
  template_version_id: string;
  customer_id: string;
  customer_name: string;
  total: number;
  created_by: string;
  doc_date: string;
  version: number;
  snapshot: Snapshot;
  snapshot_hash: string;
  source_contract_id: string | null;
  replaced_by_id: string | null;
  rendered_hash: string | null;
  void_reason: string | null;
  steps: Step[];
  timeline: Array<{ action: string; at: number }>;
  can: Record<"edit" | "submit" | "approve" | "reject" | "issue" | "void" | "copy" | "withdraw" | "delete", boolean>;
}



// ---------------------------------------------------------------- clock + db

function pin(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

async function resetDb(): Promise<void> {
  await clearAuditEvents(env.DB);
  for (const table of ["approval_steps", "contracts", "customers", "idempotency_keys"]) {
    try {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // table not created yet (red run) — the assertions below report the real failure
    }
  }
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
}

async function sqlFirst<T>(query: string, ...binds: unknown[]): Promise<T | null> {
  return env.DB.prepare(query)
    .bind(...binds)
    .first<T>();
}

// ---------------------------------------------------------------- people

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

async function invite(by: RunwaySession, role: Role, email: string, displayName: string): Promise<Staff> {
  const res = await by.fetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, display_name: displayName, role }),
  });
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
  const session = createSession({ userId: body.user.id, email, ...cookies, fetcher, origin: ORIGIN });
  return { userId: body.user.id, email, session };
}

interface Team {
  admin: RunwaySession;
  gd: Staff;
  ql: Staff;
  nv: Staff;
  gd2?: Staff;
}

/** Nhật Minh: Giám đốc Nguyễn Nhật Minh, Quản lý Tường Vi, Nhân viên Minh Khánh (+ optional second Giám đốc). */
async function team(opts: { secondDirector?: boolean } = {}): Promise<Team> {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
  const t: Team = { admin, gd, ql, nv };
  if (opts.secondDirector === true) t.gd2 = await invite(admin, "giam_doc", "lan@nhatminh.vn", "Phạm Thu Lan");
  return t;
}

// ---------------------------------------------------------------- data

let phoneSeq = 0;
async function customer(by: Staff, over: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  phoneSeq += 1;
  const res = await by.session.fetch("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: "Tạp hóa Cô Ba",
      contact_person: "Trần Thị Ba",
      phone: `0901 234 ${String(100 + phoneSeq).padStart(3, "0")}`,
      email: `coba${phoneSeq}@example.com`,
      address: "12 Lê Lợi, Q.1, TP.HCM",
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function templateId(by: Staff): Promise<string> {
  const res = await by.session.fetch("/templates");
  expect(res.status).toBe(200);
  const body: { items: Array<{ id: string; name: string }> } = await res.json();
  const t = body.items.find((x) => x.name === "Hợp đồng cung cấp dịch vụ phần mềm");
  expect(t).toBeDefined();
  return t!.id;
}

const WITHOUT_TITLE = { ma_goi: "G6", so_cua_hang: 1, giam_gia: 500 };
const BASE_VALUES = { ...WITHOUT_TITLE, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" };

function post(by: Staff, path: string, body: unknown, key?: string): Promise<Response> {
  return by.session.fetch(path, {
    method: "POST",
    headers: key !== undefined ? { "Idempotency-Key": key } : undefined,
    body: JSON.stringify(body),
  });
}

function createRaw(
  by: Staff,
  tplId: string,
  customerId: string,
  values: Record<string, unknown> = BASE_VALUES,
  extra: Record<string, unknown> = {},
  key?: string,
): Promise<Response> {
  return post(by, "/contracts", { template_id: tplId, customer_id: customerId, values, ...extra }, key);
}

async function create(
  by: Staff,
  tplId: string,
  customerId: string,
  values: Record<string, unknown> = BASE_VALUES,
): Promise<Contract> {
  const res = await createRaw(by, tplId, customerId, values);
  expect(res.status).toBe(201);
  return res.json();
}

async function act(
  by: Staff,
  id: string,
  action: "submit" | "approve" | "reject" | "issue" | "void" | "copy",
  body: Record<string, unknown> = {},
  expected = 200,
): Promise<Contract> {
  const res = await post(by, `/contracts/${id}/${action}`, body);
  expect(res.status, `${action} ${id}`).toBe(expected);
  return res.json();
}








async function approvedFor(t: Team, tpl: string, customerId: string, values: Record<string, unknown> = BASE_VALUES): Promise<Contract> {
  const draft = await create(t.nv, tpl, customerId, values);
  const pending = await act(t.nv, draft.id, "submit");
  let cur = await act(t.ql, draft.id, "approve");
  if (pending.steps.length > 1) cur = await act(t.gd, draft.id, "approve");
  expect(cur.status).toBe("approved");
  return cur;
}

async function issuedFor(t: Team, tpl: string, customerId: string): Promise<Contract> {
  const a = await approvedFor(t, tpl, customerId);
  return act(t.ql, a.id, "issue");
}




async function orphanSteps(): Promise<number> {
  return (
    (await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM approval_steps WHERE contract_id NOT IN (SELECT id FROM contracts)"))?.n ?? -1
  );
}

async function auditRows(action: string, target: string): Promise<Array<{ actor: string | null; metadata: string | null }>> {
  const rows = await env.DB.prepare("SELECT actor, metadata FROM audit_events WHERE action = ? AND target = ?")
    .bind(action, target)
    .all<{ actor: string | null; metadata: string | null }>();
  return rows.results;
}

// ================================================================ tests

function del(by: Staff, id: string): Promise<Response> {
  return by.session.fetch(`/contracts/${id}`, { method: "DELETE" });
}

describe("delete draft (integration)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    pin(FIXTURE_DAY);
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deleting a replacement draft leaves no dangling replaced_by_id; audit metadata is exactly {id}; second DELETE 404", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv, { name: "Khách Xóa", phone: "0912 345 678" });
    const issued = await issuedFor(t, tpl, c.id);
    await act(t.gd, issued.id, "void", { reason: "Khách đổi gói" });
    const copy = await act(t.nv, issued.id, "copy", {}, 201);
    expect((await del(t.nv, copy.id)).status).toBe(204);
    const src = await sqlFirst<{ replaced_by_id: string | null }>("SELECT replaced_by_id FROM contracts WHERE id = ?", issued.id);
    expect(src?.replaced_by_id).toBeNull();
    const rows = await auditRows("contract.deleted", `contract:${copy.id}`);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ id: copy.id });
    expect((await del(t.nv, copy.id)).status).toBe(404);
    expect(await orphanSteps()).toBe(0);
  }, 60_000);
});
