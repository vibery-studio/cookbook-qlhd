/**
 * SPEC-03 acceptance (AC-1 … AC-29 + DEC-10 + the two TODO(PLAN) edge tests): contract lifecycle —
 * create from template, submit, approve/reject, issue with a gap-free number (Rung B), void + copy.
 * Written before the code (PLAN-03 §1). Calls the API exactly as SPEC-03 §3.5 says; tables this row adds
 * (`contracts`, `approval_steps`) and row 02's tables are touched only through raw SQL so the file compiles
 * before the schema exists.
 *
 * Clock: the business dates of the Nhật Minh fixture (28/09/2026, 30/06/2026, 31/12/2026 17:30 UTC) are pinned
 * with `vi.setSystemTime` (Date only, still ticking). Tests and the Worker (`SELF`) share one isolate in vitest-pool-workers,
 * so the handler's `new Date()` sees the pinned instant. After a jump, access JWTs are stale → `relogin()`.
 * Storage is isolated per test (vitest-pool-workers `isolatedStorage` default true); `resetDb` is a belt.
 */
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
  can: Record<"edit" | "submit" | "approve" | "reject" | "issue" | "void" | "copy", boolean>;
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

async function sqlRun(query: string, ...binds: unknown[]): Promise<void> {
  await env.DB.prepare(query)
    .bind(...binds)
    .run();
}

async function countContracts(): Promise<number> {
  return (await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM contracts"))?.n ?? -1;
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

/** After a clock jump the 120 s access JWT no longer verifies: log everyone in again. */
async function relogin(...staff: Staff[]): Promise<void> {
  for (const s of staff) {
    const cookies = await loginAs(fetcher, { email: s.email, password: PASSWORD, origin: ORIGIN });
    s.session = createSession({ userId: s.userId, email: s.email, ...cookies, fetcher, origin: ORIGIN });
  }
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

/** Nhân viên creates (−5% by default) → submits → Quản lý approves (→ + Giám đốc when > 10%). */
async function approvedContract(
  t: Team,
  tplId: string,
  values: Record<string, unknown> = BASE_VALUES,
): Promise<Contract> {
  const c = await customer(t.nv);
  const draft = await create(t.nv, tplId, c.id, values);
  const pending = await act(t.nv, draft.id, "submit");
  let cur = await act(t.ql, draft.id, "approve");
  if (pending.steps.length > 1) cur = await act(t.gd, draft.id, "approve");
  expect(cur.status).toBe("approved");
  return cur;
}

async function contractAudit(by: Staff, id: string): Promise<AuditItem[]> {
  const res = await by.session.fetch(`/contracts/${id}/audit?limit=50`);
  expect(res.status).toBe(200);
  const body: { items: AuditItem[] } = await res.json();
  return body.items;
}

async function deniedRows(target: string): Promise<AuditItem[]> {
  const rows = await env.DB.prepare(
    "SELECT actor, action, target, metadata FROM audit_events WHERE action = 'permission.denied' AND target = ? ORDER BY ts",
  )
    .bind(target)
    .all<{ actor: string; action: string; target: string; metadata: string | null }>();
  return rows.results.map((r) => ({ ...r, metadata: r.metadata === null ? null : (JSON.parse(r.metadata) as Record<string, unknown>) }));
}

const KEY_A = "01J9Z3NDEKTSV4RRFFQ69G5FAV";
const KEY_B = "01J9Z3NDEKTSV4RRFFQ69G5FBW";

// ================================================================ tests

describe("SPEC-03 contract lifecycle (acceptance)", () => {
  beforeEach(async () => {
    // Date only, and it keeps ticking: frozen time would stall loops that wait on Date.now (idempotency poll).
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    pin(FIXTURE_DAY);
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-1: draft_has_no_number — a new contract is a draft with no number and no seq", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const draft = await create(t.nv, tpl, c.id);
    expect(draft).toMatchObject({ status: "draft", number: null, seq: null, series_year: null });
    const list: { items: Array<{ id: string; number: string | null; status: string }> } = await (
      await t.nv.session.fetch("/contracts")
    ).json();
    expect(list.items.find((x) => x.id === draft.id)).toMatchObject({ number: null, status: "draft" });
    const row = await sqlFirst<{ seq: number | null; number: string | null }>(
      "SELECT seq, number FROM contracts WHERE id = ?",
      draft.id,
    );
    expect(row).toEqual({ seq: null, number: null });
  });

  it("AC-2: issue_assigns_next_number — HD-2026-001, 002; a rejected contract in between consumes nothing", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const a = await approvedContract(t, tpl);
    expect((await act(t.ql, a.id, "issue")).number).toBe("HD-2026-001");

    const c = await customer(t.nv);
    const r = await create(t.nv, tpl, c.id);
    await act(t.nv, r.id, "submit");
    const rejected = await act(t.ql, r.id, "reject", { note: "Sai tên cửa hàng" });
    expect(rejected).toMatchObject({ status: "rejected", number: null });

    const b = await approvedContract(t, tpl);
    const issued = await act(t.gd, b.id, "issue");
    expect(issued).toMatchObject({ status: "issued", number: "HD-2026-002", seq: 2, series_year: 2026 });
  });

  it("AC-3: series_is_per_type_and_year — 00:30 on 01/01/2027 VN (17:30 UTC 31/12) starts HD-2027-001", async () => {
    pin("2026-12-31T10:00:00Z"); // 17:00 VN, still 2026
    const t = await team();
    const tpl = await templateId(t.nv);
    const a = await approvedContract(t, tpl);
    expect((await act(t.ql, a.id, "issue")).number).toBe("HD-2026-001");
    const b = await approvedContract(t, tpl);

    pin("2026-12-31T17:30:00Z"); // 00:30 VN on 01/01/2027
    await relogin(t.ql);
    const issued = await act(t.ql, b.id, "issue");
    expect(issued).toMatchObject({ number: "HD-2027-001", series_year: 2027, seq: 1 });
  });

  it("AC-4: missing_required_field_refuses — no chuc_vu_nguoi_ky → 422 missing-fields, no row", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const before = await countContracts();
    const values = WITHOUT_TITLE;
    const res = await createRaw(t.nv, tpl, c.id, values);
    expect(res.status).toBe(422);
    const body: ProblemBody = await res.json();
    expect(body.type).toContain("missing-fields");
    expect(body.missing_fields).toEqual([{ key: "chuc_vu_nguoi_ky", label: "Chức vụ người ký" }]);
    // whitespace only = empty
    const blank = await createRaw(t.nv, tpl, c.id, { ...BASE_VALUES, chuc_vu_nguoi_ky: "   " });
    expect(blank.status).toBe(422);
    expect(await countContracts()).toBe(before);

    // a customer without contact_person / phone / email (DEC-8 of SPEC-02) is refused by field name
    const bare = await customer(t.nv, { contact_person: undefined, phone: undefined, email: undefined, name: "Quán Bà Tư" });
    const res2 = await createRaw(t.nv, tpl, bare.id);
    expect(res2.status).toBe(422);
    const body2: ProblemBody = await res2.json();
    expect(body2.missing_fields?.map((f) => f.key).sort()).toEqual(["email", "sdt", "ten_khach"]);
    expect(await countContracts()).toBe(before);
  });

  it("AC-5: optional_missing_field_allowed — no so_bao_gia/ngay_bao_gia → created, no 'Căn cứ' line, no '{{'", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const draft = await create(t.nv, tpl, c.id);
    const { res, html } = await render(t.nv, draft.id);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).not.toContain("Căn cứ");
    expect(html).not.toContain("{{");
    expect(html).toContain("NHÁP");
    expect(html).toContain("(chưa có số)");

    const withQuote = await create(t.nv, tpl, c.id, { ...BASE_VALUES, so_bao_gia: "BG-2026-001", ngay_bao_gia: "2026-09-20" });
    expect((await render(t.nv, withQuote.id)).html).toContain("Căn cứ báo giá số BG-2026-001 ngày 20/09/2026.");

    // DEC-8: the pair goes together
    const half = await createRaw(t.nv, tpl, c.id, { ...BASE_VALUES, so_bao_gia: "BG-2026-001" });
    expect(half.status).toBe(422);
  });

  it("AC-6: server_prices_from_price_list_on_doc_date — client prices refused; G6 = 2.400.000 on 30/06, 2.700.000 on 28/09", async () => {
    pin("2026-06-30T03:00:00Z");
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const june = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 0 });
    expect(june.snapshot.package.unit_price).toBe(2_400_000);
    expect(june.snapshot.lines[0]?.unit_price).toBe(2_400_000);
    expect(june.total).toBe(2_400_000);
    expect(june.doc_date).toBe("2026-06-30");

    // DEC-4: editing the draft on 01/07 re-prices at the new doc date; the default start date follows it
    pin("2026-07-01T03:00:00Z");
    await relogin(t.nv);
    const patched = await t.nv.session.fetch(`/contracts/${june.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_version: june.version, values: { ...BASE_VALUES, giam_gia: 0 } }),
    });
    expect(patched.status).toBe(200);
    const july: Contract = await patched.json();
    expect(july.doc_date).toBe("2026-07-01");
    expect(july.total).toBe(2_700_000);
    expect(july.snapshot.dates.start).toBe("2026-07-01");

    pin(FIXTURE_DAY);
    await relogin(t.nv);
    const sept = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 0 });
    expect(sept.snapshot.package.unit_price).toBe(2_700_000);

    for (const forged of [{ total: 1 }, { unit_price: 1 }]) {
      const res = await createRaw(t.nv, tpl, c.id, BASE_VALUES, forged);
      expect(res.status, JSON.stringify(forged)).toBe(422);
    }
    const inValues = await createRaw(t.nv, tpl, c.id, { ...BASE_VALUES, unit_price: 1 });
    expect(inValues.status).toBe(422);
  });

  it("AC-7: amount_math_is_integer — 2.565.000 / 8.160.000, words, end dates, DT14 refused, start defaults to doc date", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);

    const a = await create(t.nv, tpl, c.id);
    expect(a.snapshot).toMatchObject({
      gross: 2_700_000,
      discount_amount: 135_000,
      total: 2_565_000,
      total_words: "Hai triệu năm trăm sáu mươi lăm nghìn đồng",
      dates: { doc_date: "2026-09-28", start: "2026-09-28", end: "2027-03-27" },
    });
    expect(a.snapshot.lines).toEqual([
      { description: "Gói 6 tháng", qty: 1, unit_price: 2_700_000, discount_bps: 500, amount: 2_565_000 },
    ]);
    const paper = (await render(t.nv, a.id)).html;
    expect(paper).toContain("2.565.000");
    expect(paper).toContain("28/09/2026");
    expect(paper).toContain("27/03/2027");
    expect(paper).toContain("đã trừ giảm giá 5%");

    const b = await create(t.nv, tpl, c.id, { ...BASE_VALUES, ma_goi: "G12", so_cua_hang: 2, giam_gia: 1500 });
    expect(b.total).toBe(8_160_000);
    expect(b.snapshot.dates.end).toBe("2027-09-27");

    const monthEnd = await create(t.nv, tpl, c.id, { ...BASE_VALUES, ngay_bat_dau: "2026-08-31" });
    expect(monthEnd.snapshot.dates.end).toBe("2027-02-28");

    const trial = await createRaw(t.nv, tpl, c.id, { ...BASE_VALUES, ma_goi: "DT14" });
    expect(trial.status).toBe(422);
    expect(JSON.stringify(await trial.json())).toContain("ma_goi");

    for (const bad of [{ so_cua_hang: 0 }, { so_cua_hang: 1000 }, { giam_gia: 10_001 }, { giam_gia: -1 }, { ngay_bat_dau: "2026-02-30" }]) {
      const res = await createRaw(t.nv, tpl, c.id, { ...BASE_VALUES, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    // Q-C: 100% discount is allowed (total 0đ)
    const free = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 10_000 });
    expect(free.total).toBe(0);
  });

  it("AC-8: snapshot_isolated_from_live_data — renaming the customer and a template v2 leave the draft's paper unchanged", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const draft = await create(t.nv, tpl, c.id);
    const before = (await render(t.nv, draft.id)).html;

    const edit = await t.nv.session.fetch(`/customers/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Siêu thị Mini Ba", phone: "0987 654 321", expected_version: c.version }),
    });
    expect(edit.status).toBe(200);
    await newTemplateVersion(t.gd, tpl);

    const after = (await render(t.nv, draft.id)).html;
    expect(after).toBe(before);
    expect(after).toContain("Tạp hóa Cô Ba");
    expect(after).not.toContain("Siêu thị Mini Ba");
  });

  it("AC-9: creator_cannot_approve — Quản lý approving their own contract → 403, still pending, one permission.denied", async () => {
    const t = await team();
    const tpl = await templateId(t.ql);
    const c = await customer(t.ql);
    const own = await create(t.ql, tpl, c.id);
    await act(t.ql, own.id, "submit");

    const res = await post(t.ql, `/contracts/${own.id}/approve`, {});
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body: ProblemBody = await res.json();
    expect(body.type).toContain("forbidden");
    expect(body.rule).toBe("creator_cannot_approve");
    expect((await get(t.ql, own.id)).status).toBe("pending");

    const denied = await deniedRows(`contract:${own.id}`);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actor: t.ql.userId, metadata: { rule: "creator_cannot_approve" } });
  });

  it("AC-10: approval_is_per_document — a copy of a rejected contract starts its approval from zero", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const first = await create(t.nv, tpl, c.id);
    await act(t.nv, first.id, "submit");
    const rejected = await act(t.ql, first.id, "reject", { note: "Thiếu chức vụ chính xác" });
    expect(rejected.steps[0]).toMatchObject({ status: "rejected", decided_by: t.ql.userId, note: "Thiếu chức vụ chính xác" });

    const res = await post(t.nv, `/contracts/${first.id}/copy`, {});
    expect(res.status).toBe(201);
    const copy: Contract = await res.json();
    expect(copy).toMatchObject({ status: "draft", source_contract_id: first.id, number: null, created_by: t.nv.userId });
    expect(copy.steps).toEqual([]);

    const pending = await act(t.nv, copy.id, "submit");
    expect(pending.steps.map((s) => s.status)).toEqual(["waiting"]);
    expect(pending.steps[0]?.id).not.toBe(rejected.steps[0]?.id);
    expect((await get(t.nv, first.id)).steps[0]?.status).toBe("rejected");
  });

  it("AC-11: threshold_rule_selects_approval — 5% and 10,00% → 1 step; 10,01% and 15% → 2 steps", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const labels = async (bps: number) => {
      const d = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: bps });
      return (await act(t.nv, d.id, "submit")).steps.map((s) => [s.step_no, s.label, s.required_role]);
    };
    expect(await labels(500)).toEqual([[1, "Quản lý duyệt", null]]);
    expect(await labels(1000)).toEqual([[1, "Quản lý duyệt", null]]);
    expect(await labels(1001)).toEqual([
      [1, "Quản lý duyệt", null],
      [2, "Giám đốc duyệt", "giam_doc"],
    ]);
    expect(await labels(1500)).toEqual([
      [1, "Quản lý duyệt", null],
      [2, "Giám đốc duyệt", "giam_doc"],
    ]);
  });

  it("AC-12: multi_step_in_order — −15%: director first → 409; manager → still pending; director rejects → rejected, no number", async () => {
    const t = await team(); // exactly 1 Giám đốc + 1 Quản lý
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id, { ...BASE_VALUES, ma_goi: "G12", so_cua_hang: 2, giam_gia: 1500 });
    await act(t.nv, d.id, "submit");

    // the approve action always targets the lowest waiting step; the director taking step 1 would leave step 2
    // (Giám đốc only) with nobody → DEC-10 409
    const early = await post(t.gd, `/contracts/${d.id}/approve`, {});
    expect(early.status).toBe(409);
    expect(((await get(t.nv, d.id)).steps[0])?.status).toBe("waiting");

    const afterManager = await act(t.ql, d.id, "approve");
    expect(afterManager.status).toBe("pending");
    expect(afterManager.steps.map((s) => s.status)).toEqual(["approved", "waiting"]);

    // Quản lý cannot take the director step
    expect((await post(t.ql, `/contracts/${d.id}/approve`, {})).status).toBe(403);

    const rejected = await act(t.gd, d.id, "reject", { note: "Giảm 15% quá cao" });
    expect(rejected).toMatchObject({ status: "rejected", number: null });
    expect((await post(t.gd, `/contracts/${d.id}/reject`, {})).status).toBe(422); // note required (checked before state)
  });

  it("AC-13: submit_refused_when_no_eligible_approver — only director creates −15% → 409 naming 'Giám đốc duyệt'; a second director fixes it", async () => {
    const t = await team();
    const tpl = await templateId(t.gd);
    const c = await customer(t.gd);
    const d = await create(t.gd, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });

    const res = await post(t.gd, `/contracts/${d.id}/submit`, {});
    expect(res.status).toBe(409);
    const body: ProblemBody = await res.json();
    expect(body.type).toContain("no-eligible-approver");
    expect(body).toMatchObject({ step_no: 2, label: "Giám đốc duyệt" });
    expect(body.detail).toContain("Giám đốc duyệt");
    const still = await get(t.gd, d.id);
    expect(still.status).toBe("draft");
    expect(still.steps).toEqual([]);
    expect((await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM approval_steps WHERE contract_id = ?", d.id))?.n).toBe(0);

    const gd2 = await invite(t.admin, "giam_doc", "lan@nhatminh.vn", "Phạm Thu Lan");
    expect((await act(t.gd, d.id, "submit")).status).toBe("pending");
    await act(t.ql, d.id, "approve");
    const done = await act(gd2, d.id, "approve");
    expect(done.status).toBe("approved");
    expect(done.steps[1]?.decided_by).toBe(gd2.userId);
  });

  it("AC-13b: submit_needs_distinct_approvers — 1 GĐ + 1 QL: Quản lý's −15% is refused; Nhân viên's is accepted", async () => {
    const t = await team();
    const tpl = await templateId(t.ql);
    const c = await customer(t.ql);
    const byManager = await create(t.ql, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });
    const res = await post(t.ql, `/contracts/${byManager.id}/submit`, {});
    expect(res.status).toBe(409);
    const body: ProblemBody = await res.json();
    expect(body).toMatchObject({ label: "Giám đốc duyệt" });
    const still = await get(t.ql, byManager.id);
    expect(still).toMatchObject({ status: "draft", steps: [] });

    const byStaff = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });
    expect((await act(t.nv, byStaff.id, "submit")).status).toBe("pending");
  });

  it("AC-13c: one_person_one_step — director A takes step 1, cannot take step 2; director B can", async () => {
    const t = await team({ secondDirector: true });
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });
    await act(t.nv, d.id, "submit");
    await act(t.gd, d.id, "approve"); // step 1 (another director remains for step 2)

    const res = await post(t.gd, `/contracts/${d.id}/approve`, {});
    expect(res.status).toBe(403);
    expect((await res.json<ProblemBody>()).rule).toBe("one_person_one_step");
    expect((await get(t.nv, d.id)).status).toBe("pending");
    const denied = await deniedRows(`contract:${d.id}`);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actor: t.gd.userId, metadata: { rule: "one_person_one_step" } });

    const done = await act(t.gd2!, d.id, "approve");
    expect(done.status).toBe("approved");
  });

  it("DEC-10: would_block_later_step — 1 GĐ + 1 QL, Nhân viên −15%: director on step 1 → 409, manager on step 1 → ok", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });
    await act(t.nv, d.id, "submit");

    const res = await post(t.gd, `/contracts/${d.id}/approve`, {});
    expect(res.status).toBe(409);
    const body: ProblemBody = await res.json();
    expect(body.type).toContain("would-block-later-step");
    expect(body).toMatchObject({ step_no: 2, label: "Giám đốc duyệt" });
    const still = await get(t.nv, d.id);
    expect(still.status).toBe("pending");
    expect(still.steps.map((s) => s.status)).toEqual(["waiting", "waiting"]);

    await act(t.ql, d.id, "approve");
    expect((await act(t.gd, d.id, "approve")).status).toBe("approved");
  });

  it("AC-14: pending_is_locked — PATCH pending → 409 state-conflict; each decided step carries the snapshot hash", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    const pending = await act(t.nv, d.id, "submit");
    const res = await t.nv.session.fetch(`/contracts/${d.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_version: pending.version, values: { ...BASE_VALUES, giam_gia: 0 } }),
    });
    expect(res.status).toBe(409);
    const body: ProblemBody = await res.json();
    expect(body.type).toContain("state-conflict");
    expect(body.current_status).toBe("pending");

    const approved = await act(t.ql, d.id, "approve");
    expect(approved.steps[0]?.snapshot_hash_at_decision).toBe(approved.snapshot_hash);
    expect(approved.snapshot_hash).toBe(d.snapshot_hash);
    expect(approved.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("§4 two tabs: the second PATCH with the same expected_version → 409 stale", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    const patch = (bps: number) =>
      t.nv.session.fetch(`/contracts/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ expected_version: d.version, values: { ...BASE_VALUES, giam_gia: bps } }),
      });
    expect((await patch(0)).status).toBe(200);
    const second = await patch(300);
    expect(second.status).toBe(409);
    expect((await second.json<ProblemBody>()).type).toContain("stale");
    expect((await get(t.nv, d.id)).total).toBe(2_700_000);
  });

  it("AC-15: issued_is_immutable_void_keeps_number — void keeps HD-2026-001; the copy is issued as HD-2026-002", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const a = await approvedContract(t, tpl);
    const issued = await act(t.ql, a.id, "issue");
    expect(issued.number).toBe("HD-2026-001");

    const patch = await t.nv.session.fetch(`/contracts/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_version: issued.version, values: BASE_VALUES }),
    });
    expect(patch.status).toBe(409);

    expect((await post(t.gd, `/contracts/${a.id}/void`, { reason: "  " })).status).toBe(422);
    const voided = await act(t.gd, a.id, "void", { reason: "Khách đổi sang gói G12" });
    expect(voided).toMatchObject({ status: "voided", number: "HD-2026-001", void_reason: "Khách đổi sang gói G12" });

    // DEC-9: the paper of a voided contract carries the band; the stored bytes + hash are untouched
    const { res, html } = await render(t.nv, a.id);
    expect(html).toContain("ĐÃ HỦY");
    expect(res.headers.get("etag")).toContain(issued.rendered_hash!);
    const stored = await sqlFirst<{ rendered_hash: string }>("SELECT rendered_hash FROM contracts WHERE id = ?", a.id);
    expect(stored?.rendered_hash).toBe(issued.rendered_hash);

    const copyRes = await post(t.nv, `/contracts/${a.id}/copy`, {});
    expect(copyRes.status).toBe(201);
    const copy: Contract = await copyRes.json();
    expect(copy.source_contract_id).toBe(a.id);
    expect((await get(t.nv, a.id)).replaced_by_id).toBe(copy.id);
    expect((await post(t.nv, `/contracts/${a.id}/copy`, {})).status).toBe(409); // already replaced

    await act(t.nv, copy.id, "submit");
    await act(t.ql, copy.id, "approve");
    expect((await act(t.ql, copy.id, "issue")).number).toBe("HD-2026-002");
    expect((await get(t.nv, a.id)).number).toBe("HD-2026-001");
  });

  it("AC-16: every_move_writes_one_audit_row — create/submit/approve/issue = 4 rows with from/to (+1 per extra step, +1 void)", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    await act(t.nv, d.id, "submit");
    await act(t.ql, d.id, "approve");
    await act(t.ql, d.id, "issue");
    const rows = (await contractAudit(t.gd, d.id)).filter((r) => r.action.startsWith("contract."));
    // same-second rows: compare as a set (ts has 1 s resolution)
    expect(rows.map((r) => r.action).sort()).toEqual([
      "contract.approved",
      "contract.created",
      "contract.issued",
      "contract.submitted",
    ]);
    expect(rows.every((r) => r.target === `contract:${d.id}` && typeof r.metadata?.["to"] === "string")).toBe(true);
    expect(rows.filter((r) => r.action !== "contract.created").every((r) => typeof r.metadata?.["from"] === "string")).toBe(true);
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain("0901"); // no customer PII in audit metadata
    expect(raw).not.toContain("2565000");

    await act(t.gd, d.id, "void", { reason: "Khách hủy" });
    expect((await contractAudit(t.gd, d.id)).filter((r) => r.action.startsWith("contract."))).toHaveLength(5);

    const two = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });
    await act(t.nv, two.id, "submit");
    await act(t.ql, two.id, "approve");
    await act(t.gd, two.id, "approve");
    await act(t.gd, two.id, "issue");
    expect((await contractAudit(t.gd, two.id)).filter((r) => r.action.startsWith("contract."))).toHaveLength(5);
  });

  it("AC-17: idempotent_create_and_issue — same key → one contract, one number; same key + other body → 409", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const r1 = await createRaw(t.nv, tpl, c.id, BASE_VALUES, {}, KEY_A);
    const r2 = await createRaw(t.nv, tpl, c.id, BASE_VALUES, {}, KEY_A);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const a: Contract = await r1.json();
    const b: Contract = await r2.json();
    expect(b.id).toBe(a.id);
    expect(await countContracts()).toBe(1);

    await act(t.nv, a.id, "submit");
    await act(t.ql, a.id, "approve");
    const i1 = await post(t.ql, `/contracts/${a.id}/issue`, {}, KEY_B);
    const i2 = await post(t.ql, `/contracts/${a.id}/issue`, {}, KEY_B);
    expect(i1.status).toBe(200);
    expect(i2.status).toBe(200);
    expect((await i2.json<Contract>()).number).toBe((await i1.json<Contract>()).number);
    expect((await sqlFirst<{ n: number }>("SELECT COUNT(seq) AS n FROM contracts"))?.n).toBe(1);

    const other = await createRaw(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 0 }, {}, KEY_A);
    expect(other.status).toBe(409);
  });

  it("AC-18: numbering race — 10 concurrent issues → 001…010 (10|10|1|10); 5 concurrent on one → MAX + 1", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const approved: Contract[] = [];
    for (let i = 0; i < 10; i++) approved.push(await approvedContract(t, tpl));

    const results = await Promise.all(approved.map((c, i) => post(i % 2 === 0 ? t.ql : t.gd, `/contracts/${c.id}/issue`, {})));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const numbers = (await Promise.all(results.map(async (r) => (await r.json<Contract>()).number))).sort();
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => `HD-2026-${String(i + 1).padStart(3, "0")}`));

    const tally = await sqlFirst<{ n: number; d: number; lo: number; hi: number }>(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT seq) AS d, MIN(seq) AS lo, MAX(seq) AS hi FROM contracts WHERE type = 'contract' AND series_year = 2026",
    );
    console.log(`AC-18 tally 10 issues: ${tally?.n}|${tally?.d}|${tally?.lo}|${tally?.hi}`);
    expect(tally).toEqual({ n: 10, d: 10, lo: 1, hi: 10 });

    const one = await approvedContract(t, tpl);
    const five = await Promise.all(Array.from({ length: 5 }, (_, i) => post(i % 2 === 0 ? t.ql : t.gd, `/contracts/${one.id}/issue`, {})));
    const statuses = five.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    const after = await sqlFirst<{ n: number; d: number; lo: number; hi: number }>(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT seq) AS d, MIN(seq) AS lo, MAX(seq) AS hi FROM contracts WHERE type = 'contract' AND series_year = 2026",
    );
    console.log(`AC-18 tally after 5 on one: ${after?.n}|${after?.d}|${after?.lo}|${after?.hi}`);
    expect(after).toEqual({ n: 11, d: 11, lo: 1, hi: 11 });
    expect((await get(t.nv, one.id)).number).toBe("HD-2026-011");
  }, 60_000); // heavy setup (4 users, 11 contracts, 15 concurrent issues) — timing only

  it("§4 two people: approve and reject at the same moment → one wins, the other 409; one audit row", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    await act(t.nv, d.id, "submit");
    const [ap, rj] = await Promise.all([
      post(t.ql, `/contracts/${d.id}/approve`, {}),
      post(t.gd, `/contracts/${d.id}/reject`, { note: "Không đồng ý" }),
    ]);
    expect([ap.status, rj.status].sort()).toEqual([200, 409]);
    const final = await get(t.nv, d.id);
    expect(final.status).toBe(ap.status === 200 ? "approved" : "rejected");
    const decided = (await contractAudit(t.gd, d.id)).filter((r) => r.action === "contract.approved" || r.action === "contract.rejected");
    expect(decided).toHaveLength(1);
  });

  it("AC-19: missing-field probe — refused without the title, then created and printed exactly as entered", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const values = WITHOUT_TITLE;
    const refused = await createRaw(t.nv, tpl, c.id, values);
    expect(refused.status).toBe(422);
    expect(await countContracts()).toBe(0);
    const ok = await create(t.nv, tpl, c.id, { ...values, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" });
    expect((await render(t.nv, ok.id)).html).toContain("Đại diện: Trần Thị Ba — Chức vụ: Chủ hộ kinh doanh");
  });

  it("AC-20: self-approval probe — director self-approving step 2 → 403; admin → 403; Nhân viên → 403 + contract:approve", async () => {
    const t = await team({ secondDirector: true });
    const tpl = await templateId(t.gd);
    const c = await customer(t.gd);
    const d = await create(t.gd, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });
    await act(t.gd, d.id, "submit");
    await act(t.ql, d.id, "approve");
    const self = await post(t.gd, `/contracts/${d.id}/approve`, {});
    expect(self.status).toBe(403);
    expect((await self.json<ProblemBody>()).rule).toBe("creator_cannot_approve");

    const adminTry = await t.admin.fetch(`/contracts/${d.id}/approve`, { method: "POST", body: "{}" });
    expect(adminTry.status).toBe(403);

    const c2 = await customer(t.ql);
    const byManager = await create(t.ql, tpl, c2.id);
    await act(t.ql, byManager.id, "submit");
    const staffTry = await post(t.nv, `/contracts/${byManager.id}/approve`, {});
    expect(staffTry.status).toBe(403);
    const denied = await env.DB.prepare(
      "SELECT metadata FROM audit_events WHERE action = 'permission.denied' AND actor = ? ORDER BY ts DESC LIMIT 1",
    )
      .bind(t.nv.userId)
      .first<{ metadata: string }>();
    expect(JSON.parse(denied!.metadata)).toMatchObject({ permission: "contract:approve" });
    expect((await get(t.gd, d.id)).status).toBe("pending");
  });

  it("AC-21: live-data probe — after issue, customer rename + phone + a new G6 price leave the paper byte-identical", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv, { phone: "0908 111 222" });
    const d = await create(t.nv, tpl, c.id);
    await act(t.nv, d.id, "submit");
    await act(t.ql, d.id, "approve");
    const issued = await act(t.ql, d.id, "issue");
    const first = await render(t.nv, d.id);
    expect(first.res.headers.get("etag")).toContain(issued.rendered_hash!);

    const edit = await t.nv.session.fetch(`/customers/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Siêu thị Mini Ba", phone: "0987 654 321", expected_version: c.version }),
    });
    expect(edit.status).toBe(200);
    await sqlRun("UPDATE price_list SET effective_to = '2026-09-27' WHERE code = 'G6' AND effective_to IS NULL");
    await sqlRun(
      "INSERT INTO price_list (id, code, name, duration_value, duration_unit, unit_price, effective_from, effective_to, note) VALUES ('01J9ZTESTG6PRICE0000000000', 'G6', 'Gói 6 tháng', 6, 'month', 2900000, '2026-09-28', NULL, 'test')",
    );

    const second = await render(t.nv, d.id);
    expect(second.html).toBe(first.html);
    expect(second.res.headers.get("etag")).toBe(first.res.headers.get("etag"));
    expect(second.html).toContain("Tạp hóa Cô Ba");
    expect(second.html).toContain("0908 111 222");
    expect(second.html).toContain("2.565.000");
    expect(second.html).not.toContain("Siêu thị Mini Ba");
  });

  it("AC-22: template-edit probe — issued on v1 stays identical after v2; new contracts use v2; old draft keeps v1 until use_latest_template", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const a = await approvedContract(t, tpl);
    const issued = await act(t.ql, a.id, "issue");
    const c = await customer(t.nv);
    const oldDraft = await create(t.nv, tpl, c.id);
    const before = (await render(t.nv, a.id)).html;

    const v2 = await newTemplateVersion(t.gd, tpl);
    expect((await render(t.nv, a.id)).html).toBe(before);
    expect((await sqlFirst<{ h: string }>("SELECT rendered_hash AS h FROM contracts WHERE id = ?", a.id))?.h).toBe(issued.rendered_hash);

    const fresh = await create(t.nv, tpl, c.id);
    expect(fresh.template_version_id).toBe(v2);
    expect((await render(t.nv, fresh.id)).html).toContain(CLAUSE_V2);
    expect((await get(t.nv, oldDraft.id)).template_version_id).toBe(oldDraft.template_version_id);
    expect((await render(t.nv, oldDraft.id)).html).not.toContain(CLAUSE_V2);

    const res = await t.nv.session.fetch(`/contracts/${oldDraft.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_version: oldDraft.version, use_latest_template: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json<Contract>()).template_version_id).toBe(v2);
  });

  it("AC-23: replay probe — same key + body → same id, marked replay, COUNT +1; other body → 409", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const before = await countContracts();
    const r1 = await createRaw(t.nv, tpl, c.id, BASE_VALUES, {}, KEY_A);
    const r2 = await createRaw(t.nv, tpl, c.id, BASE_VALUES, {}, KEY_A);
    expect((await r2.json<Contract>()).id).toBe((await r1.json<Contract>()).id);
    expect(r2.headers.get("idempotency-replay")).toBe("true");
    expect(await countContracts()).toBe(before + 1);
    expect((await createRaw(t.nv, tpl, c.id, { ...BASE_VALUES, so_cua_hang: 2 }, {}, KEY_A)).status).toBe(409);
  });

  it("AC-24: tamper probe — total 1.000.000 + unit_price 1 → 422, no row; the honest request stores 2.565.000", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    for (const forged of [{ total: 1_000_000, unit_price: 1 }, { number: "HD-2026-999" }, { status: "issued" }]) {
      expect((await createRaw(t.nv, tpl, c.id, BASE_VALUES, forged)).status, JSON.stringify(forged)).toBe(422);
    }
    for (const forged of [{ tong_tien: 1_000_000 }, { ngay_ket_thuc: "2030-01-01" }, { so_hop_dong: "HD-2026-999" }]) {
      expect((await createRaw(t.nv, tpl, c.id, { ...BASE_VALUES, ...forged })).status, JSON.stringify(forged)).toBe(422);
    }
    expect(await countContracts()).toBe(0);
    expect((await create(t.nv, tpl, c.id)).total).toBe(2_565_000);
  });

  it("AC-25: approve-then-edit probe — snapshot changed after approval → issue 409 changed-after-approval, no number used", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const a = await approvedContract(t, tpl);
    await sqlRun(
      "UPDATE contracts SET snapshot = json_set(snapshot, '$.total', 1), snapshot_hash = 'deadbeef' WHERE id = ?",
      a.id,
    );
    const res = await post(t.ql, `/contracts/${a.id}/issue`, {});
    expect(res.status).toBe(409);
    expect((await res.json<ProblemBody>()).type).toContain("changed-after-approval");
    const row = await sqlFirst<{ status: string; seq: number | null }>("SELECT status, seq FROM contracts WHERE id = ?", a.id);
    expect(row).toEqual({ status: "approved", seq: null });
    expect((await sqlFirst<{ n: number }>("SELECT COUNT(seq) AS n FROM contracts"))?.n).toBe(0);
  });

  it("AC-26: not logged in → 401 everywhere; Nhân viên on queue/audit → 403 + permission.denied; non-creator PATCH/submit → 403", async () => {
    const id = "01J9ZZZZZZZZZZZZZZZZZZZZZZ";
    const calls: Array<[string, string]> = [
      ["GET", "/contracts"],
      ["POST", "/contracts"],
      ["GET", `/contracts/${id}`],
      ["PATCH", `/contracts/${id}`],
      ["GET", `/contracts/${id}/render`],
      ["GET", `/contracts/${id}/audit`],
      ["GET", "/approvals/mine"],
      ...(["submit", "approve", "reject", "issue", "void", "copy"] as const).map((a): [string, string] => ["POST", `/contracts/${id}/${a}`]),
    ];
    for (const [method, path] of calls) {
      const res = await fetcher(`${ORIGIN}${path}`, {
        method,
        headers: method === "GET" ? undefined : CSRF_HEADERS,
        body: method === "GET" ? undefined : "{}",
      });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.text()).not.toContain("snapshot");
    }

    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const d = await create(t.nv, tpl, c.id);
    expect((await t.nv.session.fetch("/approvals/mine")).status).toBe(403);
    expect((await t.nv.session.fetch(`/contracts/${d.id}/audit`)).status).toBe(403);
    const denied = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'permission.denied' AND actor = ?")
      .bind(t.nv.userId)
      .first<{ n: number }>();
    expect(denied?.n).toBe(2);

    const patch = await t.ql.session.fetch(`/contracts/${d.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_version: d.version, values: BASE_VALUES }),
    });
    expect(patch.status).toBe(403);
    expect((await post(t.ql, `/contracts/${d.id}/submit`, {})).status).toBe(403);
    // SPEC-03 §3.5: a non-creator PATCH and submit each leave a permission.denied row on the contract
    const creatorOnly = await env.DB.prepare(
      "SELECT json_extract(metadata, '$.permission') AS p FROM audit_events WHERE action = 'permission.denied' AND actor = ? AND target = ? ORDER BY p",
    )
      .bind(t.ql.userId, `contract:${d.id}`)
      .all<{ p: string }>();
    expect(creatorOnly.results.map((r) => r.p)).toEqual(["contract:submit", "contract:write"]);
    expect((await get(t.nv, d.id)).status).toBe("draft");
    // the technical admin has no contract:* at all
    expect((await t.admin.fetch("/contracts")).status).toBe(403);
    expect((await t.admin.fetch(`/contracts/${d.id}/issue`, { method: "POST", body: "{}" })).status).toBe(403);
  });

  it("AC-27: XSS — a customer named <script> prints as text; /render has a no-script CSP", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv, { name: "<script>alert(1)</script>" });
    const d = await create(t.nv, tpl, c.id);
    const { res, html } = await render(t.nv, d.id);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("AC-28: /approvals/mine — only steps the caller may decide right now", async () => {
    const t = await team({ secondDirector: true });
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    const byStaff = await create(t.nv, tpl, c.id, { ...BASE_VALUES, giam_gia: 1500 });
    await act(t.nv, byStaff.id, "submit");
    const byManager = await create(t.ql, tpl, c.id);
    await act(t.ql, byManager.id, "submit");

    type Queue = { items: Array<{ contract_id: string; step_no: number; label: string }> };
    const queue = async (s: Staff): Promise<Queue["items"]> => {
      const res = await s.session.fetch("/approvals/mine");
      expect(res.status).toBe(200);
      return (await res.json<Queue>()).items;
    };
    const qlQueue = await queue(t.ql);
    expect(qlQueue.map((i) => [i.contract_id, i.step_no])).toEqual([[byStaff.id, 1]]); // not their own, not step 2

    await act(t.gd, byStaff.id, "approve"); // Giám đốc A takes step 1
    expect((await queue(t.gd)).find((i) => i.contract_id === byStaff.id)).toBeUndefined(); // one person, one step
    const gd2Queue = await queue(t.gd2!);
    expect(gd2Queue.find((i) => i.contract_id === byStaff.id)).toMatchObject({ step_no: 2, label: "Giám đốc duyệt" });
    expect((await queue(t.ql)).find((i) => i.contract_id === byStaff.id)).toBeUndefined();
  });

  it("AC-29: GET /contracts filters by status, counts per tab, limit > 50 → 422", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const c = await customer(t.nv);
    await create(t.nv, tpl, c.id);
    const p = await create(t.nv, tpl, c.id);
    await act(t.nv, p.id, "submit");
    await approvedContract(t, tpl);

    const res = await t.ql.session.fetch("/contracts?status=pending");
    expect(res.status).toBe(200);
    const body: {
      items: Array<{ id: string; status: string; customer_name: string; total: number; created_by_name: string }>;
      next_cursor: string | null;
      counts: Record<string, number>;
    } = await res.json();
    expect(body.items.map((i) => i.id)).toEqual([p.id]);
    expect(body.items[0]).toMatchObject({ customer_name: "Tạp hóa Cô Ba", total: 2_565_000, created_by_name: "Minh Khánh" });
    expect(body.counts).toEqual({ draft: 1, pending: 1, approved: 1, issued: 0, rejected: 0, voided: 0 });
    expect((await t.ql.session.fetch("/contracts?limit=51")).status).toBe(422);
    expect((await t.ql.session.fetch("/contracts?status=lost")).status).toBe(422);
  });

  it("§4 failure: dying between issue and saving the paper → /render rebuilds the same bytes and stores them once", async () => {
    const t = await team();
    const tpl = await templateId(t.nv);
    const a = await approvedContract(t, tpl);
    const issued = await act(t.ql, a.id, "issue");
    const original = (await render(t.nv, a.id)).html;
    await sqlRun("UPDATE contracts SET rendered_html = NULL, rendered_hash = NULL WHERE id = ?", a.id);

    const rebuilt = await render(t.nv, a.id);
    expect(rebuilt.html).toBe(original);
    const row = await sqlFirst<{ h: string | null }>("SELECT rendered_hash AS h FROM contracts WHERE id = ?", a.id);
    expect(row?.h).toBe(issued.rendered_hash);
    expect(rebuilt.html).toContain("HD-2026-001");
  });
});

// ---------------------------------------------------------------- template v2 (row 02 API, SPEC-02 §3.8)

const CLAUSE_V2 = "Hợp đồng lập thành 03 bản";

/** Giám đốc publishes v2 with one clause changed; returns the new version id. */
async function newTemplateVersion(gd: Staff, tplId: string): Promise<string> {
  const cur = await gd.session.fetch(`/templates/${tplId}`);
  expect(cur.status).toBe(200);
  const t: {
    version: {
      version_no: number;
      body: string;
      fields: unknown;
      field_rules: unknown;
      default_line_items: unknown;
      default_clauses: unknown;
      approval_policy: unknown;
    };
  } = await cur.json();
  const body = t.version.body.replace("Hợp đồng lập thành 02 bản", CLAUSE_V2);
  expect(body).not.toBe(t.version.body);
  const res = await post(gd, `/templates/${tplId}/versions`, {
    expected_version_no: t.version.version_no,
    body,
    fields: t.version.fields,
    field_rules: t.version.field_rules,
    default_line_items: t.version.default_line_items,
    default_clauses: t.version.default_clauses,
    approval_policy: t.version.approval_policy,
    note: "Điều 5: 03 bản",
  });
  expect(res.status).toBe(201);
  // the new version is now current (SPEC-02 AC-3): read its id back rather than depend on the 201 body shape
  const now: { version: { id: string; version_no: number } } = await (await gd.session.fetch(`/templates/${tplId}`)).json();
  expect(now.version.version_no).toBe(t.version.version_no + 1);
  return now.version.id;
}
