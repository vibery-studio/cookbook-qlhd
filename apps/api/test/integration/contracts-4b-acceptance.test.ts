/**
 * SPEC-04b API acceptance — AC-13 (API half) · AC-20 (API half) · AC-21 · AC-22 · AC-23 · AC-24 · AC-25 (PLAN-04b §1).
 * Written before the code: Customer.issued_count/issued_total, ContractListItem.template_name, GET /contracts?template_id,
 * ContractCan.withdraw/delete, POST /contracts/{id}/withdraw, DELETE /contracts/{id}, X-Frame-Options SAMEORIGIN on /render.
 * Calls the API exactly as SPEC-04b §3.2 says. Helper pattern copied from contracts-acceptance.test.ts (that file is not edited);
 * new tables are touched through raw SQL so the file compiles before the code exists. Same clock pin (28/09/2026).
 */
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

interface ProblemBody {
  type: string;
  status: number;
  detail?: string;
  rule?: string;
  current_status?: string;
  missing_fields?: Array<{ key: string; label: string }>;
  placeholders?: string[];
  step_no?: number;
  label?: string;
  errors?: Array<{ path: string; message: string }>;
}

interface AuditItem {
  actor: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------- clock + db

function pin(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

async function resetDb(): Promise<void> {
  for (const table of ["approval_steps", "contracts", "audit_events", "customers", "idempotency_keys"]) {
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

async function get(by: Staff, id: string): Promise<Contract> {
  const res = await by.session.fetch(`/contracts/${id}`);
  expect(res.status).toBe(200);
  return res.json();
}

async function render(by: Staff, id: string): Promise<{ res: Response; html: string }> {
  const res = await by.session.fetch(`/contracts/${id}/render`);
  expect(res.status).toBe(200);
  return { res, html: await res.text() };
}

async function deniedRows(target: string): Promise<AuditItem[]> {
  const rows = await env.DB.prepare(
    "SELECT actor, action, target, metadata FROM audit_events WHERE action = 'permission.denied' AND target = ? ORDER BY ts",
  )
    .bind(target)
    .all<{ actor: string; action: string; target: string; metadata: string | null }>();
  return rows.results.map((r) => ({ ...r, metadata: r.metadata === null ? null : (JSON.parse(r.metadata) as Record<string, unknown>) }));
}



const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const MISSING_ULID = UNKNOWN_ID;

interface CustomerDto {
  id: string;
  name: string;
  issued_count: number;
  issued_total: number;
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

function withdraw(by: Staff, id: string): Promise<Response> {
  return post(by, `/contracts/${id}/withdraw`, {});
}

function del(by: Staff, id: string): Promise<Response> {
  return by.session.fetch(`/contracts/${id}`, { method: "DELETE" });
}

async function stepCount(contractId: string): Promise<number> {
  return (await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM approval_steps WHERE contract_id = ?", contractId))?.n ?? -1;
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

describe("SPEC-04b API (acceptance)", () => {
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

  it("AC-13: Customer.issued_count/issued_total count ISSUED contracts only (voided, draft, pending excluded)", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const a = await customer(t.nv, { name: "Khách A" });
    const b = await customer(t.nv, { name: "Khách B" });
    const c = await customer(t.nv, { name: "Khách C" });
    expect(a).toMatchObject({ issued_count: 0, issued_total: 0 }); // POST /customers 201 carries the fields

    const i1 = await issuedFor(t, tpl, a.id);
    await issuedFor(t, tpl, a.id);
    const voided = await issuedFor(t, tpl, a.id);
    await act(t.gd, voided.id, "void", { reason: "Khách hủy" });
    await create(t.nv, tpl, a.id); // draft
    const pending = await create(t.nv, tpl, a.id);
    await act(t.nv, pending.id, "submit");
    await create(t.nv, tpl, b.id); // B: only a draft

    const list: { items: CustomerDto[] } = await (await t.nv.session.fetch("/customers?limit=50")).json();
    const by = (id: string): CustomerDto => list.items.find((x) => x.id === id)!;
    expect(by(a.id)).toMatchObject({ issued_count: 2, issued_total: 2 * 2_565_000 });
    expect(by(b.id)).toMatchObject({ issued_count: 0, issued_total: 0 });
    expect(by(c.id)).toMatchObject({ issued_count: 0, issued_total: 0 });

    const one: CustomerDto = await (await t.nv.session.fetch(`/customers/${a.id}`)).json();
    expect(one).toMatchObject({ issued_count: 2, issued_total: 5_130_000 });
    const patched = await t.nv.session.fetch(`/customers/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_version: a.version, name: "Khách A (đổi tên)" }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ issued_count: 2, issued_total: 5_130_000 });

    // void one more → the count drops on the next load
    await act(t.gd, i1.id, "void", { reason: "Khách đổi ý" });
    const after: CustomerDto = await (await t.nv.session.fetch(`/customers/${a.id}`)).json();
    expect(after).toMatchObject({ issued_count: 1, issued_total: 2_565_000 });
  }, 60_000);

  it("AC-20 / DEC-6: list item has template_name; ?template_id filters items AND counts; unknown → empty; non-ULID → 422", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c1 = await customer(t.nv, { name: "Khách 1" });
    const c2 = await customer(t.nv, { name: "Khách 2" });
    const d1 = await create(t.nv, tpl, c1.id);
    await create(t.nv, tpl, c2.id);
    const p = await create(t.nv, tpl, c1.id);
    await act(t.nv, p.id, "submit");

    type ListBody = { items: Array<{ id: string; template_name: string }>; counts: Record<string, number> };
    const all: ListBody = await (await t.ql.session.fetch("/contracts")).json();
    expect(all.items.every((i) => i.template_name === "Hợp đồng cung cấp dịch vụ phần mềm")).toBe(true);

    const byTpl: ListBody = await (await t.ql.session.fetch(`/contracts?template_id=${tpl}`)).json();
    expect(byTpl.items).toHaveLength(3);
    expect(byTpl.counts).toEqual({ draft: 2, pending: 1, approved: 0, issued: 0, rejected: 0, voided: 0 });

    // combined with customer_id + status: counts follow every filter except status
    const combo: ListBody = await (
      await t.ql.session.fetch(`/contracts?template_id=${tpl}&customer_id=${c1.id}&status=draft&created_by=${t.nv.userId}`)
    ).json();
    expect(combo.items.map((i) => i.id)).toEqual([d1.id]);
    expect(combo.counts).toEqual({ draft: 1, pending: 1, approved: 0, issued: 0, rejected: 0, voided: 0 });

    const unknown: ListBody = await (await t.ql.session.fetch(`/contracts?template_id=${UNKNOWN_ID}`)).json();
    expect(unknown.items).toEqual([]);
    expect(unknown.counts).toEqual({ draft: 0, pending: 0, approved: 0, issued: 0, rejected: 0, voided: 0 });
    const bad = await t.ql.session.fetch("/contracts?template_id=khong-phai-ulid");
    expect(bad.status).toBe(422);
    expect((await bad.json<ProblemBody>()).type).toContain("validation");
  });

  it("AC-21: can.withdraw / can.delete follow the creator + status (+ no step decided)", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 }); // -15% → 2 steps
    expect((await get(t.nv, d.id)).can).toMatchObject({ delete: true, withdraw: false });
    expect((await get(t.ql, d.id)).can).toMatchObject({ delete: false, withdraw: false });
    await act(t.nv, d.id, "submit");
    expect((await get(t.nv, d.id)).can).toMatchObject({ delete: false, withdraw: true });
    expect((await get(t.ql, d.id)).can).toMatchObject({ delete: false, withdraw: false }); // not the creator
    await act(t.ql, d.id, "approve");
    expect((await get(t.nv, d.id)).can).toMatchObject({ delete: false, withdraw: false }); // a step is decided
  });

  it("AC-21: withdraw — creator, pending, no decision → draft; waiting steps gone; version+1; submitted_at null; one audit row; resubmit works", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    const pending = await act(t.nv, d.id, "submit");
    expect(pending.steps).toHaveLength(1);
    expect(await stepCount(d.id)).toBe(1);

    const res = await withdraw(t.nv, d.id);
    expect(res.status).toBe(200);
    const back: Contract = await res.json();
    expect(back).toMatchObject({ status: "draft", number: null, seq: null, steps: [], version: pending.version + 1 });
    expect(await stepCount(d.id)).toBe(0);
    const row = await sqlFirst<{ status: string; submitted_at: number | null; decided_at: number | null }>(
      "SELECT status, submitted_at, decided_at FROM contracts WHERE id = ?",
      d.id,
    );
    expect(row).toEqual({ status: "draft", submitted_at: null, decided_at: null });
    expect(back.timeline.some((e) => e.action === "contract.submitted")).toBe(true); // audit history stays

    const withdrawn = await auditRows("contract.withdrawn", `contract:${d.id}`);
    expect(withdrawn).toHaveLength(1);
    expect(JSON.parse(withdrawn[0]!.metadata!)).toEqual({ from: "pending", to: "draft" });
    expect(withdrawn[0]!.actor).toBe(t.nv.userId);
    expect(await auditRows("contract.submitted", `contract:${d.id}`)).toHaveLength(1);

    // gone from the Quản lý queue; editable again; resubmit assigns fresh steps
    const queue: { items: Array<{ contract_id: string }> } = await (await t.ql.session.fetch("/approvals/mine")).json();
    expect(queue.items.find((i) => i.contract_id === d.id)).toBeUndefined();
    const again = await act(t.nv, d.id, "submit");
    expect(again.status).toBe("pending");
    expect(again.steps).toHaveLength(1);
    expect(again.steps[0]!.status).toBe("waiting");

    // withdraw again, then a repeat on the now-draft contract → 409 state-conflict (no idempotency key needed)
    const repeat = await withdraw(t.nv, d.id); // pending again → allowed once more
    expect(repeat.status).toBe(200);
    const second = await withdraw(t.nv, d.id);
    expect(second.status).toBe(409);
    const body: ProblemBody = await second.json();
    expect(body.type).toContain("state-conflict");
    expect(body.current_status).toBe("draft");
  });

  it("AC-21: withdraw refusals — decided step → 409 already-decided; non-creator → 403 creator_only + denied row; issued → 409; unknown → 404; anonymous → 401", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });
    await act(t.nv, d.id, "submit");

    // a non-creator (Quản lý) → 403 creator_only, one permission.denied on the contract, still pending
    const notMine = await withdraw(t.ql, d.id);
    expect(notMine.status).toBe(403);
    expect((await notMine.json<ProblemBody>()).rule).toBe("creator_only");
    expect((await deniedRows(`contract:${d.id}`)).filter((r) => r.actor === t.ql.userId)).toHaveLength(1);
    expect((await get(t.nv, d.id)).status).toBe("pending");

    // step 1 decided → the creator can no longer withdraw
    await act(t.ql, d.id, "approve");
    const decided = await withdraw(t.nv, d.id);
    expect(decided.status).toBe(409);
    const body: ProblemBody = await decided.json();
    expect(body.type).toContain("already-decided");
    expect(body.current_status).toBe("pending");
    const still = await get(t.nv, d.id);
    expect(still.status).toBe("pending");
    expect(still.steps).toHaveLength(2);
    expect(still.steps[0]!.status).toBe("approved");
    expect(await auditRows("contract.withdrawn", `contract:${d.id}`)).toHaveLength(0);

    // draft / issued → state-conflict
    const draft = await create(t.nv, tpl, c.id);
    const onDraft = await withdraw(t.nv, draft.id);
    expect(onDraft.status).toBe(409);
    expect((await onDraft.json<ProblemBody>()).type).toContain("state-conflict");
    const issued = await issuedFor(t, tpl, c.id);
    const onIssued = await withdraw(t.nv, issued.id);
    expect(onIssued.status).toBe(409);
    expect((await onIssued.json<ProblemBody>()).current_status).toBe("issued");

    expect((await withdraw(t.nv, MISSING_ULID)).status).toBe(404);
    const anon = await fetcher(`${ORIGIN}/contracts/${d.id}/withdraw`, { method: "POST", headers: CSRF_HEADERS, body: "{}" });
    expect(anon.status).toBe(401);
  }, 60_000);

  it("AC-23: DELETE — creator deletes a draft: 204, row + steps gone, one audit row {id} only (no PII), numbering untouched", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    expect((await issuedFor(t, tpl, c.id)).number).toBe("HD-2026-001");
    const d = await create(t.nv, tpl, c.id);
    const res = await del(t.nv, d.id);
    expect(res.status).toBe(204);
    expect(await sqlFirst("SELECT id FROM contracts WHERE id = ?", d.id)).toBeNull();
    expect(await stepCount(d.id)).toBe(0);
    expect((await t.nv.session.fetch(`/contracts/${d.id}`)).status).toBe(404);
    expect((await t.gd.session.fetch(`/contracts/${d.id}/audit`)).status).toBe(404);

    const rows = await auditRows("contract.deleted", `contract:${d.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(t.nv.userId);
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ id: d.id });
    for (const secret of ["Cô Ba", "0901", "coba", "2565000", "Lê Lợi"]) expect(rows[0]!.metadata).not.toContain(secret);

    // second DELETE → 404 (the UI treats it as done)
    expect((await del(t.nv, d.id)).status).toBe(404);
    // the gap-free series is unaffected
    expect((await issuedFor(t, tpl, c.id)).number).toBe("HD-2026-002");
    expect(await orphanSteps()).toBe(0);
  }, 60_000);

  it("AC-23: DELETE refusals — pending/approved/issued/rejected/voided → 409 state-conflict (nothing deleted); non-creator → 403 creator_only + denied row; anonymous → 401", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const pending = await create(t.nv, tpl, c.id);
    await act(t.nv, pending.id, "submit");
    const approved = await approvedFor(t, tpl, c.id);
    const issued = await issuedFor(t, tpl, c.id);
    const rejectedDraft = await create(t.nv, tpl, c.id);
    await act(t.nv, rejectedDraft.id, "submit");
    await act(t.ql, rejectedDraft.id, "reject", { note: "Sai tên" });
    const voided = await issuedFor(t, tpl, c.id);
    await act(t.gd, voided.id, "void", { reason: "Khách hủy" });

    const expected: Array<[Contract, string]> = [
      [pending, "pending"],
      [approved, "approved"],
      [issued, "issued"],
      [rejectedDraft, "rejected"],
      [voided, "voided"],
    ];
    for (const [ct, status] of expected) {
      const res = await del(t.nv, ct.id);
      expect(res.status, status).toBe(409);
      const body: ProblemBody = await res.json();
      expect(body.type).toContain("state-conflict");
      expect(body.current_status).toBe(status);
      expect(await sqlFirst("SELECT id FROM contracts WHERE id = ?", ct.id)).not.toBeNull();
    }
    expect(await stepCount(pending.id)).toBeGreaterThan(0);

    const draft = await create(t.nv, tpl, c.id);
    for (const other of [t.ql, t.gd]) {
      const res = await del(other, draft.id);
      expect(res.status).toBe(403);
      expect((await res.json<ProblemBody>()).rule).toBe("creator_only");
    }
    const denied = await deniedRows(`contract:${draft.id}`);
    expect(denied.map((r) => r.actor).sort()).toEqual([t.gd.userId, t.ql.userId].sort());
    expect(await sqlFirst("SELECT id FROM contracts WHERE id = ?", draft.id)).not.toBeNull();
    const anon = await fetcher(`${ORIGIN}/contracts/${draft.id}`, { method: "DELETE", headers: CSRF_HEADERS });
    expect(anon.status).toBe(401);
  }, 60_000);

  it("AC-23: deleting the replacement draft of a voided contract clears replaced_by_id so another replacement can be made", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const issued = await issuedFor(t, tpl, c.id);
    await act(t.gd, issued.id, "void", { reason: "Khách đổi gói" });
    const copy = await act(t.nv, issued.id, "copy", {}, 201);
    expect((await get(t.nv, issued.id)).replaced_by_id).toBe(copy.id);
    expect((await del(t.nv, copy.id)).status).toBe(204);
    expect((await get(t.nv, issued.id)).replaced_by_id).toBeNull();
    const second = await act(t.nv, issued.id, "copy", {}, 201);
    expect(second.source_contract_id).toBe(issued.id);
  }, 60_000);

  it("AC-22: withdraw vs approve at the same moment → exactly one wins, never draft-with-approved-step or pending-without-step", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    await act(t.nv, d.id, "submit");
    const [wd, ap] = await Promise.all([withdraw(t.nv, d.id), post(t.ql, `/contracts/${d.id}/approve`, {})]);
    expect([wd.status, ap.status].sort()).toEqual([200, 409]);
    const final = await get(t.nv, d.id);
    if (wd.status === 200) {
      expect(final.status).toBe("draft");
      expect(final.steps).toEqual([]);
      expect((await ap.json<ProblemBody>()).type).toContain("state-conflict");
    } else {
      expect(final.status).toBe("approved");
      expect(final.steps).toHaveLength(1);
      expect(final.steps[0]!.status).toBe("approved");
      expect((await wd.json<ProblemBody>()).type).toContain("already-decided");
    }
    expect(await orphanSteps()).toBe(0);
  }, 60_000);

  it("AC-24: delete vs submit at the same moment → exactly one wins, no orphan steps", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    const [dl, sb] = await Promise.all([del(t.nv, d.id), post(t.nv, `/contracts/${d.id}/submit`, {})]);
    const pair = [dl.status, sb.status].sort((a, b) => a - b);
    expect([JSON.stringify([200, 409]), JSON.stringify([204, 404])]).toContain(JSON.stringify(pair)); // submit wins + delete 409 · delete wins + submit 404
    if (dl.status === 204) {
      expect(sb.status).toBe(404);
      expect(await sqlFirst("SELECT id FROM contracts WHERE id = ?", d.id)).toBeNull();
      expect(await stepCount(d.id)).toBe(0);
    } else {
      expect(dl.status).toBe(409);
      expect(sb.status).toBe(200);
      expect((await dl.json<ProblemBody>()).type).toContain("state-conflict");
      expect((await get(t.nv, d.id)).status).toBe("pending");
    }
    expect(await orphanSteps()).toBe(0);
  }, 60_000);

  it("AC-25: /contracts/{id}/render is embeddable (X-Frame-Options SAMEORIGIN + CSP frame-ancestors 'self'); every other route keeps DENY", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    const { res } = await render(t.nv, d.id);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    for (const path of [`/contracts/${d.id}`, "/contracts", "/customers", "/healthz"]) {
      const other = await t.nv.session.fetch(path);
      expect(other.headers.get("x-frame-options"), path).toBe("DENY");
      expect(other.headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
    }
  });
});
