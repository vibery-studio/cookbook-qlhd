/**
 * SPEC-09 API acceptance (PLAN-09 §1) — AC-1 … AC-11, AC-12 (API half), AC-13. AC-12's drawer/tab half is the browser spec
 * `apps/web/e2e/doc-types.spec.ts`. Written before the code; calls the API exactly as SPEC-09 §3.6 + PLAN-09 §2b say.
 * New columns (`parent_id`, `valid_until`) and the E1 shape are touched only through raw SQL in single assertions, so this file
 * compiles today and each test reports its own failure.
 *
 * PLAN-09 resolutions pinned here (PLAN-09 §4 P-1 … P-8):
 *   - P-1 "422 `lines`" = 422 `validation` with `errors[{path:"lines"}]` (PLAN-08 P-2 precedent) — BG → HĐ that breaks the HĐ rule
 *     (DEC-7), PXK with a service line.
 *   - P-2 `POST /contracts/{id}/children` body `type` = any of the 4 doc types (schema enum); a wrong pair (DNTT from BG, HĐ from PXK,
 *     BG from HĐ) → 422 `child-type` (not `validation`).
 *   - P-3 DEC-10 B also gates PATCH / DELETE / copy by the write code of the document's type; the route gate of `POST /contracts` +
 *     `/children` is `contract:read`, the service checks `<type>:write` and leaves `permission.denied {permission}` before the 403.
 *   - P-4 `nothing-to-pay` (SPEC §4 Money-0đ, approved "now"): DNTT from a HĐ whose total is 0 → 422 `nothing-to-pay`.
 *   - P-5 `template_id` omitted on `/children` → the seed template of the child type.
 *   - P-6 Quote expiry compares `valid_until` with today in VN computed from the Worker's JS clock (bound into the CAS), so
 *     `vi.setSystemTime` moves it; `valid_until` = today still passes ("đến hết ngày").
 *   - P-7 PXK `values` keys: `ly_do_xuat_kho` (required), `xuat_tai_kho`, `dia_diem`; no `giam_gia` (422 `validation` path
 *     `values.giam_gia`); no price needed; `total` 0.
 *   - P-8 The child's frozen snapshot carries `parent {id, type, number, doc_date, total}`; DNTT carries `amount_requested` and
 *     `dates.payment_due`; BG carries `dates.valid_until`.
 *
 * Clock: REAL by default (AC-4 inserts a G6 level "from today" through raw SQL — allowed by the 0022 trigger only for dates ≥ the
 * real VN today). AC-2 pins Date (`vi.setSystemTime`, still ticking) to the Nhật Minh fixture day, then jumps to 2027-01-01 00:05 VN
 * → relogin. Storage is isolated per test (vitest-pool-workers); `resetDb` is a belt.
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
const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const NEW_CODES = ["delivery_note:write", "payment_request:write", "quote:write"];

/** Seed product ids (migration 0022). */
const P = {
  G6: "01PROD000000000000000000G6",
  MIN: "01PROD00000000000DEMOMIN01",
  GIAY: "01PROD0000000000DEMOGIAY01",
} as const;

type DocType = "quote" | "contract" | "payment_request" | "delivery_note";
const PREFIX: Record<DocType, string> = { quote: "BG", contract: "HD", payment_request: "DNTT", delivery_note: "PXK" };

interface Person {
  userId: string;
  email: string;
  session: RunwaySession;
}

interface Ref {
  id: string;
  type: DocType;
  number: string | null;
  status: string;
  total: number;
  doc_date: string;
}

interface SnapLine {
  product_id: string;
  code: string;
  kind: string;
  qty: number;
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
  price_from: string;
}

interface Snapshot {
  type?: DocType;
  lines: SnapLine[];
  vat_groups: unknown[];
  subtotal_ex_vat: number;
  discount_bps: number;
  discount_amount: number;
  total_ex_vat: number;
  vat_total: number;
  total: number;
  parent?: { id: string; type: DocType; number: string; doc_date: string; total: number } | null;
  amount_requested?: number;
  dates: { doc_date: string; valid_until?: string; payment_due?: string } & Record<string, unknown>;
}

interface Step {
  step_no: number;
  label: string;
  status: string;
  required_role: string | null;
}

interface Doc {
  id: string;
  type: DocType;
  status: string;
  number: string | null;
  seq: number | null;
  series_year: number | null;
  total: number;
  version: number;
  doc_date: string;
  created_by: string;
  snapshot: Snapshot;
  valid_until: string | null;
  parent: Ref | null;
  children: Ref[];
  steps: Step[];
  can: Record<string, unknown> & {
    create_child?: Array<{ type: DocType; allowed: boolean; reason_code: string | null }>;
  };
}

interface ProblemBody {
  type: string;
  status: number;
  errors?: Array<{ path: string; message: string }>;
  existing_id?: string;
  children?: Ref[];
}

// ---------------------------------------------------------------- clock + db

const VN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });
/** Today in Vietnam by the (possibly pinned) JS clock — the API's `todayInVN(new Date())`. */
const today = (): string => VN_DAY.format(new Date());
const thisYear = (): number => Number(today().slice(0, 4));

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 28/09/2026 10:00 giờ VN — the Nhật Minh fixture day. */
const FIXTURE_DAY = "2026-09-28T03:00:00Z";
/** 01/01/2027 00:05 giờ VN. */
const NEW_YEAR_2027 = "2026-12-31T17:05:00Z";

const pin = (iso: string) => vi.setSystemTime(new Date(iso));

async function resetDb(): Promise<void> {
  await clearAuditEvents(env.DB);
  for (const table of ["approval_steps", "contracts", "customers", "idempotency_keys"]) {
    try {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // not created yet
    }
  }
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
}

async function sqlFirst<T>(query: string, ...binds: unknown[]): Promise<T | null> {
  return env.DB.prepare(query)
    .bind(...binds)
    .first<T>();
}

async function sqlAll<T>(query: string, ...binds: unknown[]): Promise<T[]> {
  return (
    await env.DB.prepare(query)
      .bind(...binds)
      .all<T>()
  ).results;
}

async function count(query: string, ...binds: unknown[]): Promise<number> {
  return (await sqlFirst<{ n: number }>(query, ...binds))?.n ?? -1;
}

/** Raw SQL the schema must refuse — returns the error text ("" when it went through). */
async function sqlRefusal(query: string, ...binds: unknown[]): Promise<string> {
  try {
    await env.DB.prepare(query)
      .bind(...binds)
      .run();
    return "";
  } catch (e) {
    return e instanceof Error ? `${e.message} ${e.cause instanceof Error ? e.cause.message : ""}` : String(e);
  }
}

const deniedRows = (actorId: string) =>
  sqlAll<{ metadata: string | null }>("SELECT metadata FROM audit_events WHERE action = 'permission.denied' AND actor = ? ORDER BY ts", actorId);

async function auditOf(id: string): Promise<Array<{ action: string; metadata: Record<string, unknown> }>> {
  const rows = await sqlAll<{ action: string; metadata: string | null }>(
    "SELECT action, metadata FROM audit_events WHERE target = ? ORDER BY ts, rowid",
    `contract:${id}`,
  );
  return rows.map((r) => ({ action: r.action, metadata: r.metadata === null ? {} : (JSON.parse(r.metadata) as Record<string, unknown>) }));
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

async function invite(by: Person, role: string, email: string, displayName: string): Promise<Person> {
  const res = await by.session.fetch("/admin/users", { method: "POST", body: JSON.stringify({ email, display_name: displayName, role }) });
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
  ql2: Person;
  nv: Person;
  nv2: Person;
}

/** Nhật Minh: Giám đốc Nguyễn Nhật Minh, Quản lý Tường Vi + Hoàng Lan, Nhân viên Minh Khánh + Thu Hà. */
async function team(): Promise<Team> {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const ql2 = await invite(admin, "quan_ly", "lan@nhatminh.vn", "Hoàng Lan");
  const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
  const nv2 = await invite(admin, "nhan_vien", "ha@nhatminh.vn", "Thu Hà");
  return { admin, gd, ql, ql2, nv, nv2 };
}

async function me(p: Person): Promise<{ permissions: string[] }> {
  const res = await p.session.fetch("/me");
  expect(res.status).toBe(200);
  return res.json();
}

// ---------------------------------------------------------------- API helpers

let keySeq = 0;
/** A fresh ULID-shaped Idempotency-Key. */
function newKey(): string {
  keySeq += 1;
  return `01J9Z4NDEKTSV4RRFFQ6${String(keySeq).padStart(6, "0")}`;
}

const post = (by: Person, path: string, body: unknown, headers?: Record<string, string>) =>
  by.session.fetch(path, { method: "POST", body: JSON.stringify(body), headers });
const patch = (by: Person, path: string, body: unknown) => by.session.fetch(path, { method: "PATCH", body: JSON.stringify(body) });

let phoneSeq = 0;
async function customer(by: Person): Promise<string> {
  phoneSeq += 1;
  const res = await post(by, "/customers", {
    name: "Tạp hóa Cô Ba",
    contact_person: "Trần Thị Ba",
    phone: `0902 345 ${String(100 + phoneSeq).padStart(3, "0")}`,
    email: `coba${phoneSeq}@example.com`,
    address: "12 Lê Lợi, Q.1, TP.HCM",
  });
  expect(res.status).toBe(201);
  return (await res.json<{ id: string }>()).id;
}

/** `GET /templates?type=` → the (seed) template of that type. */
async function templateOf(by: Person, type: DocType): Promise<string> {
  const res = await by.session.fetch(`/templates?type=${type}&limit=50`);
  expect(res.status, `GET /templates?type=${type}`).toBe(200);
  const body: { items: Array<{ id: string; type: string }> } = await res.json();
  const items = body.items.filter((t) => t.type === type);
  expect(items.length, `a template of type ${type}`).toBeGreaterThan(0);
  expect(body.items.every((t) => t.type === type), `?type=${type} lists only ${type}`).toBe(true);
  return items[0]!.id;
}

const VALUES: Record<DocType, Record<string, unknown>> = {
  quote: { giam_gia: 500 },
  contract: { giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" },
  payment_request: {},
  delivery_note: { ly_do_xuat_kho: "Giao máy in cho cửa hàng", xuat_tai_kho: "Kho Phú Nhuận (DEMO)", dia_diem: "25 Nguyễn Văn Trỗi" },
};

type LineIn = { product_id: string; qty: number };

function createRaw(by: Person, tpl: string, customerId: string, lines: LineIn[], values: Record<string, unknown>): Promise<Response> {
  return post(by, "/contracts", { template_id: tpl, customer_id: customerId, lines, values }, { "Idempotency-Key": newKey() });
}

async function createDoc(by: Person, type: DocType, lines: LineIn[], values: Record<string, unknown> = VALUES[type]): Promise<Doc> {
  const res = await createRaw(by, await templateOf(by, type), await customer(by), lines, values);
  expect(res.status, `POST /contracts (${type}) ${JSON.stringify(lines)}`).toBe(201);
  const doc: Doc = await res.json();
  expect(doc.type).toBe(type);
  return doc;
}

const childRaw = (by: Person, parentId: string, body: Record<string, unknown>, key: string = newKey()) =>
  post(by, `/contracts/${parentId}/children`, body, { "Idempotency-Key": key });

async function child(by: Person, parentId: string, type: DocType, values?: Record<string, unknown>): Promise<Doc> {
  const res = await childRaw(by, parentId, { type, ...(values !== undefined && { values }) });
  expect(res.status, `POST /contracts/${parentId}/children ${type}`).toBe(201);
  return res.json();
}

async function get(by: Person, id: string): Promise<Doc> {
  const res = await by.session.fetch(`/contracts/${id}`);
  expect(res.status).toBe(200);
  return res.json();
}

async function act(by: Person, id: string, action: "submit" | "approve" | "issue", expected = 200): Promise<Doc> {
  const res = await post(by, `/contracts/${id}/${action}`, {});
  expect(res.status, `${action} ${id}`).toBe(expected);
  return res.json();
}

/** Submit by the creator, approve every step (step 1: a Quản lý who is not the creator; "Giám đốc duyệt": the Giám đốc). */
async function approve(t: Team, doc: Doc, creator: Person): Promise<Doc> {
  let cur = await act(creator, doc.id, "submit");
  const stepOne = creator.userId === t.ql.userId ? t.ql2 : t.ql;
  for (const step of [...cur.steps].sort((a, b) => a.step_no - b.step_no)) {
    cur = await act(step.required_role === "giam_doc" ? t.gd : stepOne, doc.id, "approve");
  }
  expect(cur.status).toBe("approved");
  return cur;
}

/** approve + issue (issuer: a Quản lý who is not the creator). */
async function issued(t: Team, doc: Doc, creator: Person): Promise<Doc> {
  await approve(t, doc, creator);
  const out = await act(creator.userId === t.ql.userId ? t.ql2 : t.ql, doc.id, "issue");
  expect(out.status).toBe("issued");
  return out;
}

async function render(by: Person, id: string): Promise<string> {
  const res = await by.session.fetch(`/contracts/${id}/render`);
  expect(res.status).toBe(200);
  return res.text();
}

async function problemOf(res: Response, status: number, slug: string): Promise<ProblemBody> {
  expect(res.status, `expected ${status} ${slug}`).toBe(status);
  const body: ProblemBody = await res.json();
  expect(body.type).toContain(slug);
  return body;
}

const paths = (p: ProblemBody) => (p.errors ?? []).map((e) => e.path);
const num = (type: DocType, year: number, seq: number) => `${PREFIX[type]}-${year}-${String(seq).padStart(3, "0")}`;
const setValidUntil = (id: string, iso: string) => env.DB.prepare("UPDATE contracts SET valid_until = ? WHERE id = ?").bind(iso, id).run();

// ================================================================ tests

describe("SPEC-09 acceptance — document types (BG → HĐ → DNTT, PXK)", () => {
  beforeEach(async () => {
    _resetJtiCache();
    resetNoopEmailBuffer();
    await resetDb();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-1: E1 shape — CHECK accepts the 4 types only, parent_id/valid_until + live-child UNIQUE, every old index kept", async () => {
    const indexes = (await sqlAll<{ name: string }>("PRAGMA index_list(contracts)")).map((r) => r.name);
    for (const name of [
      "uq_contracts_series_seq",
      "uq_contracts_number",
      "idx_contracts_type_status_updated",
      "idx_contracts_customer",
      "idx_contracts_created_by",
      "uq_contracts_parent_child_live",
      "idx_contracts_parent",
    ]) {
      expect(indexes, `index ${name}`).toContain(name);
    }
    const cols = (await sqlAll<{ name: string }>("PRAGMA table_info(contracts)")).map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(["parent_id", "valid_until", "source_contract_id", "replaced_by_id", "pdf_key"]));

    const insert = (id: string, type: string, status: string, parent: string | null, validUntil: string | null) =>
      sqlRefusal(
        `INSERT INTO contracts (id, type, template_id, template_version_id, customer_id, status, created_by, doc_date, snapshot,
          snapshot_hash, customer_name, total, created_at, updated_at, parent_id, valid_until)
         VALUES (?, ?, 'T', 'TV', 'C', ?, 'U', '2026-10-01', '{}', 'h', 'Cô Ba', 0, 0, 0, ?, ?)`,
        id,
        type,
        status,
        parent,
        validUntil,
      );
    expect(await sqlRefusal("SELECT 1")).toBe("");
    expect(await insert("01E1INVOICE000000000000001", "invoice", "draft", null, null)).toMatch(/CHECK/i);
    expect(await insert("01E1QUOTE00000000000000001", "quote", "draft", null, "2026-10-16")).toBe("");
    expect(await insert("01E1CONTRACT00000000000001", "contract", "draft", null, "2026-10-16")).toMatch(/CHECK/i); // valid_until only on BG
    expect(await insert("01E1SELF000000000000000001", "contract", "draft", "01E1SELF000000000000000001", null)).toMatch(/CHECK/i);
    for (const t of ["payment_request", "delivery_note"]) {
      expect(await insert(`01E1${t.slice(0, 4).toUpperCase()}0000000000000000001`.slice(0, 26), t, "draft", null, null)).toBe("");
    }
    // one live child per (parent, type); a dead one (rejected) does not count
    expect(await insert("01E1CHILDA0000000000000001", "contract", "draft", "01E1QUOTE00000000000000001", null)).toBe("");
    expect(await insert("01E1CHILDB0000000000000001", "contract", "pending", "01E1QUOTE00000000000000001", null)).toMatch(/UNIQUE/i);
    expect(await insert("01E1CHILDC0000000000000001", "contract", "rejected", "01E1QUOTE00000000000000001", null)).toBe("");
    expect(await insert("01E1CHILDD0000000000000001", "payment_request", "draft", "01E1QUOTE00000000000000001", null)).toBe("");
  });

  it("AC-2: one series per type and year — BG, HĐ, BG, DNTT, PXK; a rejected BG takes no number; 01/01/2027 00:05 VN resets each type", async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    pin(FIXTURE_DAY);
    const t = await team();

    const bg1 = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const hd1 = await issued(t, await createDoc(t.nv, "contract", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const rejected = await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 2 }]);
    await act(t.nv, rejected.id, "submit");
    expect((await post(t.ql, `/contracts/${rejected.id}/reject`, { note: "Sai số lượng" })).status).toBe(200);
    const bg2 = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 3 }]), t.nv);
    const dntt1 = await issued(t, await child(t.nv, hd1.id, "payment_request"), t.nv);
    const pxk1 = await issued(t, await createDoc(t.nv, "delivery_note", [{ product_id: P.MIN, qty: 1 }]), t.nv);

    expect([bg1.number, hd1.number, bg2.number, dntt1.number, pxk1.number]).toEqual([
      "BG-2026-001",
      "HD-2026-001",
      "BG-2026-002",
      "DNTT-2026-001",
      "PXK-2026-001",
    ]);
    expect((await get(t.nv, rejected.id)).number).toBeNull();
    const series = await sqlAll<{ type: string; n: number; hi: number }>(
      "SELECT type, COUNT(*) AS n, MAX(seq) AS hi FROM contracts WHERE seq IS NOT NULL AND series_year = 2026 GROUP BY type ORDER BY type",
    );
    expect(series).toEqual([
      { type: "contract", n: 1, hi: 1 },
      { type: "delivery_note", n: 1, hi: 1 },
      { type: "payment_request", n: 1, hi: 1 },
      { type: "quote", n: 2, hi: 2 },
    ]);

    pin(NEW_YEAR_2027);
    await relogin(t.nv, t.ql, t.ql2, t.gd);
    const bg2027 = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const hd2027 = await issued(t, await child(t.nv, bg2027.id, "contract", { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" }), t.nv);
    expect(bg2027.number).toBe("BG-2027-001");
    expect(hd2027.number).toBe("HD-2027-001");
    expect(hd2027.series_year).toBe(2027);
  }, 90_000);

  it("AC-3: 20 parallel issues across BG + HĐ → each series 1..10 with no gap or duplicate; 5 parallel issues of one BG → exactly one number", async () => {
    const t = await team();
    const bgs: Doc[] = [];
    const hds: Doc[] = [];
    for (let i = 0; i < 10; i++) {
      bgs.push(await approve(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv));
      hds.push(await approve(t, await createDoc(t.nv, "contract", [{ product_id: P.G6, qty: 1 }]), t.nv));
    }
    const all = [...bgs, ...hds];
    const results = await Promise.all(all.map((d, i) => post(i % 2 === 0 ? t.ql : t.gd, `/contracts/${d.id}/issue`, {})));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    const year = thisYear();
    for (const type of ["quote", "contract"] as const) {
      const tally = await sqlFirst<{ n: number; d: number; lo: number; hi: number }>(
        "SELECT COUNT(*) AS n, COUNT(DISTINCT seq) AS d, MIN(seq) AS lo, MAX(seq) AS hi FROM contracts WHERE type = ? AND series_year = ?",
        type,
        year,
      );
      expect(tally, `series ${type}`).toEqual({ n: 10, d: 10, lo: 1, hi: 10 });
    }

    const one = await approve(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const five = await Promise.all(Array.from({ length: 5 }, (_, i) => post(i % 2 === 0 ? t.ql : t.gd, `/contracts/${one.id}/issue`, {})));
    expect(five.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect((await get(t.nv, one.id)).number).toBe(num("quote", year, 11));
    expect(await count("SELECT COUNT(*) AS n FROM contracts WHERE type = 'contract' AND seq IS NOT NULL")).toBe(10);
  }, 120_000);

  it("AC-4: HĐ from an issued BG copies the frozen lines + price + discount (G6 re-priced today does not leak); lines/discount locked on edit; DEC-7 rule checked", async () => {
    const t = await team();
    const bg = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }], { giam_gia: 500 }), t.nv);
    expect(bg.total).toBe(2_565_000);
    expect(bg.snapshot.dates.valid_until).toBe(addDays(bg.doc_date, 15));
    expect(bg.valid_until).toBe(addDays(bg.doc_date, 15));

    // G6 gets a new level from today (raw SQL: the 0022 trigger allows effective_from >= real VN today)
    await env.DB.prepare(
      "INSERT INTO product_prices (id, product_id, effective_from, unit_price_ex_vat, vat_rate_bps, created_by, created_at) VALUES (?, ?, ?, 3000000, NULL, NULL, 0)",
    )
      .bind("01PPRICE00000000000AC4G6T1", P.G6, today())
      .run();

    const hd = await child(t.nv2, bg.id, "contract", { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" });
    expect(hd.type).toBe("contract");
    expect(hd.status).toBe("draft");
    expect(hd.total).toBe(2_565_000);
    expect(hd.snapshot.total).toBe(bg.snapshot.total);
    expect(hd.snapshot.discount_bps).toBe(500);
    expect(hd.snapshot.lines.map((l) => [l.product_id, l.qty, l.unit_price_ex_vat, l.vat_rate_bps])).toEqual([[P.G6, 1, 2_700_000, null]]);
    expect(hd.snapshot.parent).toMatchObject({ id: bg.id, type: "quote", number: bg.number, total: 2_565_000 });
    expect(hd.parent).toMatchObject({ id: bg.id, type: "quote", number: bg.number, status: "issued" });
    expect(await count("SELECT COUNT(*) AS n FROM contracts WHERE id = ? AND parent_id = ?", hd.id, bg.id)).toBe(1);
    expect(await render(t.nv2, hd.id)).toContain(`Căn cứ báo giá số ${bg.number}`);

    // DEC-6: lines + discount locked on the child; manual fields still editable, still frozen money
    await problemOf(await patch(t.nv2, `/contracts/${hd.id}`, { expected_version: hd.version, lines: [{ product_id: P.G6, qty: 2 }] }), 422, "lines-locked");
    await problemOf(await patch(t.nv2, `/contracts/${hd.id}`, { expected_version: hd.version, values: { giam_gia: 0 } }), 422, "lines-locked");
    const edited = await patch(t.nv2, `/contracts/${hd.id}`, { expected_version: hd.version, values: { chuc_vu_nguoi_ky: "Chủ cửa hàng" } });
    expect(edited.status).toBe(200);
    expect((await edited.json<Doc>()).total).toBe(2_565_000);
    // the child cannot carry its own discount either
    await problemOf(await childRaw(t.nv2, bg.id, { type: "contract", values: { giam_gia: 0, chuc_vu_nguoi_ky: "x" } }), 422, "lines-locked");

    // DEC-7: a goods-only BG is a valid quote, but a HĐ needs exactly one monthly service line
    const goodsBg = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.MIN, qty: 1 }], { giam_gia: 0 }), t.nv);
    expect(paths(await problemOf(await childRaw(t.nv, goodsBg.id, { type: "contract", values: { chuc_vu_nguoi_ky: "x" } }), 422, "validation"))).toContain(
      "lines",
    );
  }, 90_000);

  it("AC-5: approval is per document — HĐ from a 15% BG needs the Giám đốc again; the BG's creator may approve the HĐ; the HĐ's creator may not", async () => {
    const t = await team();
    const bg = await createDoc(t.ql, "quote", [{ product_id: P.G6, qty: 1 }], { giam_gia: 1500 });
    const bgIssued = await issued(t, bg, t.ql);
    expect((await get(t.ql, bgIssued.id)).steps.map((s) => s.label)).toContain("Giám đốc duyệt");

    const hd = await child(t.nv, bg.id, "contract", { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" });
    const pending = await act(t.nv, hd.id, "submit");
    expect(pending.steps.map((s) => s.label)).toEqual(["Quản lý duyệt", "Giám đốc duyệt"]);
    expect(pending.steps.every((s) => s.status === "waiting")).toBe(true);
    await act(t.ql, hd.id, "approve"); // Tường Vi made the BG — still may approve the HĐ (I5 per document)
    expect((await act(t.gd, hd.id, "approve")).status).toBe("approved");

    // the HĐ's own creator may not approve it
    const bg2 = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }], { giam_gia: 0 }), t.nv);
    const hd2 = await child(t.ql2, bg2.id, "contract", { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" });
    await act(t.ql2, hd2.id, "submit");
    const before = (await deniedRows(t.ql2.userId)).length;
    expect((await post(t.ql2, `/contracts/${hd2.id}/approve`, {})).status).toBe(403);
    expect((await deniedRows(t.ql2.userId)).length).toBe(before + 1);
  }, 90_000);

  it("AC-6: DNTT from an issued HĐ — amount = HĐ total, due = doc date + 7, bank account + 'NM <số>'; DNTT never stands alone; 0đ HĐ → nothing-to-pay", async () => {
    const t = await team();
    const hd = await issued(t, await createDoc(t.nv, "contract", [{ product_id: P.G6, qty: 1 }, { product_id: P.MIN, qty: 1 }]), t.nv);
    const dn = await child(t.nv, hd.id, "payment_request");
    expect(dn.type).toBe("payment_request");
    expect(dn.total).toBe(hd.total);
    expect(dn.snapshot.amount_requested).toBe(hd.total);
    expect(dn.snapshot.dates.payment_due).toBe(addDays(dn.doc_date, 7));
    expect(dn.snapshot.lines).toEqual(hd.snapshot.lines);
    expect(dn.snapshot.vat_groups).toEqual(hd.snapshot.vat_groups);
    const draftHtml = await render(t.nv, dn.id);
    expect(draftHtml).toContain(`Căn cứ hợp đồng số ${hd.number}`);
    expect(draftHtml).toContain("0071 0004 58213");
    expect(draftHtml).toContain("Vietcombank");

    const out = await issued(t, dn, t.nv);
    expect(out.number).toBe(num("payment_request", thisYear(), 1));
    expect(await render(t.nv, dn.id)).toContain(`NM ${out.number}`);

    // a DNTT template cannot be used without a parent
    const res = await createRaw(t.nv, await templateOf(t.nv, "payment_request"), await customer(t.nv), [{ product_id: P.G6, qty: 1 }], {});
    await problemOf(res, 422, "parent-required");

    // 100% discount → total 0 → nothing to request (P-4)
    const free = await issued(t, await createDoc(t.nv, "contract", [{ product_id: P.G6, qty: 1 }], { giam_gia: 10000, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" }), t.nv);
    expect(free.total).toBe(0);
    await problemOf(await childRaw(t.nv, free.id, { type: "payment_request" }), 422, "nothing-to-pay");
  }, 90_000);

  it("AC-7: at most one live child per (parent, type) — two people race → 201 + 409 child-exists; same key replays; a second DNTT → 409; after a rejection a new HĐ may be made", async () => {
    const t = await team();
    const bg = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const body = { type: "contract", values: { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" } };
    const [a, b] = await Promise.all([childRaw(t.nv, bg.id, body), childRaw(t.nv2, bg.id, body)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const winner: Doc = await (a.status === 201 ? a : b).json();
    const loser = await problemOf(a.status === 201 ? b : a, 409, "child-exists");
    expect(loser.existing_id).toBe(winner.id);
    expect(await count("SELECT COUNT(*) AS n FROM contracts WHERE parent_id = ?", bg.id)).toBe(1);

    const key = newKey();
    const bg2 = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const first = await childRaw(t.nv, bg2.id, body, key);
    const replay = await childRaw(t.nv, bg2.id, body, key);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect((await replay.json<Doc>()).id).toBe((await first.json<Doc>()).id);
    expect(await count("SELECT COUNT(*) AS n FROM contracts WHERE parent_id = ?", bg2.id)).toBe(1);

    // DNTT twice for one HĐ
    const hd = await issued(t, await get(t.nv, winner.id), winner.created_by === t.nv.userId ? t.nv : t.nv2);
    await child(t.nv, hd.id, "payment_request");
    await problemOf(await childRaw(t.nv2, hd.id, { type: "payment_request" }), 409, "child-exists");

    // rejected child → the parent is free again
    const hdOf2 = (await sqlFirst<{ id: string }>("SELECT id FROM contracts WHERE parent_id = ?", bg2.id))!.id;
    await act(t.nv, hdOf2, "submit");
    expect((await post(t.ql, `/contracts/${hdOf2}/reject`, { note: "Khách đổi người ký" })).status).toBe(200);
    const again = await child(t.nv, bg2.id, "contract", { chuc_vu_nguoi_ky: "Chủ cửa hàng" });
    expect(again.parent?.id).toBe(bg2.id);

    // FR-7: copying the rejected child keeps its parent + frozen money — blocked while another live HĐ exists
    await problemOf(await post(t.nv, `/contracts/${hdOf2}/copy`, {}, { "Idempotency-Key": newKey() }), 409, "child-exists");
    expect((await t.nv.session.fetch(`/contracts/${again.id}`, { method: "DELETE" })).status).toBe(204);
    const copied = await post(t.nv, `/contracts/${hdOf2}/copy`, {}, { "Idempotency-Key": newKey() });
    expect(copied.status).toBe(201);
    const copy: Doc = await copied.json();
    expect(copy.type).toBe("contract");
    expect(copy.parent?.id).toBe(bg2.id);
    expect(copy.total).toBe(bg2.total);
    expect(await count("SELECT COUNT(*) AS n FROM contracts WHERE id = ? AND parent_id = ? AND source_contract_id = ?", copy.id, bg2.id, hdOf2)).toBe(1);
  }, 90_000);

  it("AC-8: only issued, in-date parents of the right type — 409 parent-not-issued, 422 child-type, 409 quote-expired (create + issue), valid_until = today passes", async () => {
    const t = await team();
    const draft = await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]);
    await problemOf(await childRaw(t.nv, draft.id, { type: "contract", values: { chuc_vu_nguoi_ky: "x" } }), 409, "parent-not-issued");
    await approve(t, draft, t.nv);
    await problemOf(await childRaw(t.nv, draft.id, { type: "contract", values: { chuc_vu_nguoi_ky: "x" } }), 409, "parent-not-issued");
    expect((await childRaw(t.nv, UNKNOWN_ID, { type: "contract" })).status).toBe(404);

    const bg = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    await problemOf(await childRaw(t.nv, bg.id, { type: "payment_request" }), 422, "child-type");
    await problemOf(await childRaw(t.nv, bg.id, { type: "quote" }), 422, "child-type");
    const pxk = await issued(t, await createDoc(t.nv, "delivery_note", [{ product_id: P.MIN, qty: 1 }]), t.nv);
    await problemOf(await childRaw(t.nv, pxk.id, { type: "contract", values: { chuc_vu_nguoi_ky: "x" } }), 422, "child-type");
    expect((await childRaw(t.nv, bg.id, { type: "invoice" })).status).toBe(422);

    // expiry ("đến hết ngày valid_until", VN)
    await setValidUntil(bg.id, addDays(today(), -1));
    await problemOf(await childRaw(t.nv, bg.id, { type: "contract", values: { chuc_vu_nguoi_ky: "x" } }), 409, "quote-expired");
    await setValidUntil(bg.id, today());
    const inDate = await childRaw(t.nv, bg.id, { type: "contract", values: { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" } });
    expect(inDate.status).toBe(201);
    // DEC-5 A: copying a rejected HĐ of an expired BG is blocked too
    const hdT: Doc = await inDate.json();
    await act(t.nv, hdT.id, "submit");
    expect((await post(t.ql, `/contracts/${hdT.id}/reject`, { note: "Sai chức vụ" })).status).toBe(200);
    await setValidUntil(bg.id, addDays(today(), -1));
    await problemOf(await post(t.nv, `/contracts/${hdT.id}/copy`, {}, { "Idempotency-Key": newKey() }), 409, "quote-expired");

    const late = await approve(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    await setValidUntil(late.id, addDays(today(), -1));
    await problemOf(await post(t.ql, `/contracts/${late.id}/issue`, {}), 409, "quote-expired");
    expect((await get(t.nv, late.id)).status).toBe("approved");
  }, 90_000);

  it("AC-9: void of a parent with a live child → 409 has-children naming it; after the child is gone the void passes; create-child ‖ void → exactly one wins", async () => {
    const t = await team();
    const bg = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const hd = await child(t.nv, bg.id, "contract", { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" });
    await act(t.nv, hd.id, "submit");
    const blocked = await problemOf(await post(t.ql, `/contracts/${bg.id}/void`, { reason: "Khách hủy" }), 409, "has-children");
    expect(blocked.children?.map((c) => [c.id, c.type, c.status])).toEqual([[hd.id, "contract", "pending"]]);
    expect((await get(t.nv, bg.id)).status).toBe("issued");

    expect((await post(t.nv, `/contracts/${hd.id}/withdraw`, {})).status).toBe(200);
    expect((await t.nv.session.fetch(`/contracts/${hd.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await post(t.ql, `/contracts/${bg.id}/void`, { reason: "Khách hủy" })).status).toBe(200);
    await problemOf(await childRaw(t.nv, bg.id, { type: "contract", values: { chuc_vu_nguoi_ky: "x" } }), 409, "parent-not-issued");

    const bg2 = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const [mk, vd] = await Promise.all([
      childRaw(t.nv, bg2.id, { type: "contract", values: { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" } }),
      post(t.ql, `/contracts/${bg2.id}/void`, { reason: "Khách hủy" }),
    ]);
    const parent = await get(t.nv, bg2.id);
    const live = await count(
      "SELECT COUNT(*) AS n FROM contracts WHERE parent_id = ? AND status IN ('draft','pending','approved','issued')",
      bg2.id,
    );
    if (mk.status === 201) {
      expect(vd.status).toBe(409);
      expect(parent.status).toBe("issued");
      expect(live).toBe(1);
    } else {
      expect([mk.status, vd.status]).toEqual([409, 200]);
      expect(parent.status).toBe("voided");
      expect(live).toBe(0);
    }
  }, 90_000);

  it("AC-10: PXK (DEMO 02-VT) — goods only, no discount, no price; prints the 02-VT layout, escapes product names; issues PXK-YYYY-001", async () => {
    const t = await team();
    const pxk = await createDoc(t.nv, "delivery_note", [
      { product_id: P.MIN, qty: 2 },
      { product_id: P.GIAY, qty: 5 },
    ]);
    expect(pxk.total).toBe(0);
    expect(pxk.snapshot.discount_bps).toBe(0);
    expect(pxk.snapshot.lines.map((l) => [l.code, l.qty])).toEqual([
      ["DEMO-MIN-01", 2],
      ["DEMO-GIAY-01", 5],
    ]);
    const steps = (await act(t.nv, pxk.id, "submit")).steps;
    expect(steps.map((s) => s.label)).toEqual(["Quản lý duyệt"]);
    await act(t.ql, pxk.id, "approve");
    const out = await act(t.ql, pxk.id, "issue");
    expect(out.number).toBe(num("delivery_note", thisYear(), 1));
    const html = await render(t.nv, pxk.id);
    for (const text of [
      "PHIẾU XUẤT KHO",
      "Mẫu số 02 - VT",
      "Thông tư 99/2025/TT-BTC",
      "DEMO",
      out.number!,
      "Lý do xuất kho",
      "Xuất tại kho",
      "Đơn vị tính",
      "Yêu cầu",
      "Thực xuất",
      "Người lập phiếu",
      "Người nhận hàng",
      "Thủ kho",
      "Kế toán trưởng",
      "Giám đốc",
    ]) {
      expect(html, text).toContain(text);
    }

    const tpl = await templateOf(t.nv, "delivery_note");
    const c = await customer(t.nv);
    expect(paths(await problemOf(await createRaw(t.nv, tpl, c, [{ product_id: P.G6, qty: 1 }], VALUES.delivery_note), 422, "validation"))).toContain("lines");
    expect(
      paths(await problemOf(await createRaw(t.nv, tpl, c, [{ product_id: P.MIN, qty: 1 }], { ...VALUES.delivery_note, giam_gia: 500 }), 422, "validation")),
    ).toContain("values.giam_gia");

    // product names are printed as text
    const made = await post(t.ql, "/products", {
      kind: "goods",
      code: "XSS-01",
      name: "<b>x</b>",
      unit: "cái",
      first_price: { unit_price_ex_vat: 1000, vat_rate_bps: 1000, effective_from: today() },
    }, { "Idempotency-Key": newKey() });
    expect(made.status).toBe(201);
    const xss = await createDoc(t.nv, "delivery_note", [{ product_id: (await made.json<{ id: string }>()).id, qty: 1 }]);
    const xhtml = await render(t.nv, xss.id);
    expect(xhtml).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(xhtml).not.toContain("<b>x</b>");
  }, 90_000);

  it("AC-11: DEC-10 B — write per type: an accountant with only payment_request:write makes a DNTT but not a BG/HĐ (403 + denied); anonymous 401; 3 new codes", async () => {
    const t = await team();
    for (const p of [t.nv, t.ql, t.gd]) expect((await me(p)).permissions).toEqual(expect.arrayContaining(NEW_CODES));
    expect((await me(t.admin)).permissions.filter((c) => NEW_CODES.includes(c))).toEqual([]);
    const roles = await t.gd.session.fetch("/roles");
    expect(roles.status).toBe(200);
    expect((await roles.json<{ catalog: string[] }>()).catalog).toEqual(expect.arrayContaining(NEW_CODES));

    // Kế toán (DEMO role): read + submit + payment_request:write only
    const kt = await invite(t.admin, "nhan_vien", "ketoan@nhatminh.vn", "Kế toán Lan");
    await env.DB.prepare("INSERT INTO roles (id, name, label, is_system, version, created_at, updated_at) VALUES (?, 'ke_toan_demo', 'Kế toán (DEMO)', 0, 1, 0, 0)")
      .bind("01ROLE00000000KETOANDEMO00")
      .run();
    await env.DB.prepare(
      "INSERT INTO role_permissions (role_id, permission_id) SELECT '01ROLE00000000KETOANDEMO00', id FROM permissions WHERE key IN ('contract:read','contract:submit','payment_request:write')",
    ).run();
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(kt.userId).run();
    await assignRoleByName({ db: getDb(env), kv: env.SESSIONS, env }, { userId: kt.userId, roleName: "ke_toan_demo" });
    await relogin(kt);
    expect((await me(kt)).permissions.sort()).toEqual(["contract:read", "contract:submit", "payment_request:write"]);

    const hd = await issued(t, await createDoc(t.nv, "contract", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const dn = await child(kt, hd.id, "payment_request");
    expect(dn.created_by).toBe(kt.userId);

    const before = (await deniedRows(kt.userId)).length;
    const c = await customer(t.nv);
    expect((await createRaw(kt, await templateOf(t.nv, "quote"), c, [{ product_id: P.G6, qty: 1 }], VALUES.quote)).status).toBe(403);
    expect((await createRaw(kt, await templateOf(t.nv, "contract"), c, [{ product_id: P.G6, qty: 1 }], VALUES.contract)).status).toBe(403);
    const denied = (await deniedRows(kt.userId)).slice(before).map((r) => (JSON.parse(r.metadata ?? "{}") as { permission?: string }).permission);
    expect(denied).toEqual(["quote:write", "contract:write"]);

    // a Nhân viên lacking payment_request:write cannot make a DNTT (P-3: per-type write on /children too)
    // (a user invited AFTER the grant is removed, so no principal cache carries the old set)
    const hd2 = await issued(t, await createDoc(t.nv, "contract", [{ product_id: P.G6, qty: 1 }]), t.nv);
    await env.DB.prepare(
      "DELETE FROM role_permissions WHERE role_id = '01ROLE0000000000NHANVIEN00' AND permission_id = (SELECT id FROM permissions WHERE key = 'payment_request:write')",
    ).run();
    const nv3 = await invite(t.admin, "nhan_vien", "binh@nhatminh.vn", "Thanh Bình");
    expect((await me(nv3)).permissions).not.toContain("payment_request:write");
    expect((await childRaw(nv3, hd2.id, { type: "payment_request" })).status).toBe(403);

    const anon = await fetcher(`${ORIGIN}/contracts/${hd.id}/children`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, "content-type": "application/json", "Idempotency-Key": newKey() },
      body: JSON.stringify({ type: "payment_request" }),
    });
    expect(anon.status).toBe(401);
  }, 90_000);

  it("AC-12 (API): detail shows parent + children + can.create_child with reason codes; list + templates + approvals filter/carry `type`", async () => {
    const t = await team();
    const bg = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const fresh = await get(t.nv, bg.id);
    expect(fresh.can.create_child).toEqual([{ type: "contract", allowed: true, reason_code: null }]);
    const hd = await issued(t, await child(t.nv, bg.id, "contract", { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" }), t.nv);
    const dn = await child(t.nv, hd.id, "payment_request");

    const hdView = await get(t.nv, hd.id);
    expect(hdView.parent).toMatchObject({ id: bg.id, type: "quote", number: bg.number, status: "issued", total: bg.total });
    expect(hdView.children.map((c) => [c.id, c.type, c.number, c.status])).toEqual([[dn.id, "payment_request", null, "draft"]]);
    expect(hdView.can.create_child).toEqual([{ type: "payment_request", allowed: false, reason_code: "child-exists" }]);
    expect((await get(t.nv, bg.id)).children.map((c) => c.id)).toEqual([hd.id]);
    expect((await get(t.nv, dn.id)).can.create_child).toEqual([]);

    const bgOld = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    await setValidUntil(bgOld.id, addDays(today(), -1));
    expect((await get(t.nv, bgOld.id)).can.create_child).toEqual([{ type: "contract", allowed: false, reason_code: "quote-expired" }]);
    const bgDraft = await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]);
    expect((await get(t.nv, bgDraft.id)).can.create_child).toEqual([{ type: "contract", allowed: false, reason_code: "parent-not-issued" }]);

    const list = await t.nv.session.fetch("/contracts?type=quote&limit=50");
    expect(list.status).toBe(200);
    const items = (await list.json<{ items: Array<{ id: string; type: string; parent_id: string | null; valid_until: string | null }> }>()).items;
    expect(items.map((i) => i.id).sort()).toEqual([bg.id, bgOld.id, bgDraft.id].sort());
    expect(items.every((i) => i.type === "quote" && i.valid_until !== null && i.parent_id === null)).toBe(true);
    const pr = await t.nv.session.fetch("/contracts?type=payment_request&limit=50");
    expect((await pr.json<{ items: Array<{ id: string; parent_id: string | null }> }>()).items).toEqual([
      expect.objectContaining({ id: dn.id, parent_id: hd.id }),
    ]);
    expect((await t.nv.session.fetch("/contracts?type=invoice")).status).toBe(422);
    expect((await t.nv.session.fetch("/templates?type=invoice")).status).toBe(422);

    await act(t.nv, dn.id, "submit");
    const queue = await t.ql.session.fetch("/approvals/mine");
    expect(queue.status).toBe(200);
    const mine = (await queue.json<{ items: Array<{ contract_id: string; type: string }> }>()).items.find((i) => i.contract_id === dn.id);
    expect(mine?.type).toBe("payment_request");
  }, 90_000);

  it("AC-13: audit — a child's creation is one contract.created {to, type, parent_id, parent_number}; every move of every type carries type (+ number once issued)", async () => {
    const t = await team();
    const bg = await issued(t, await createDoc(t.nv, "quote", [{ product_id: P.G6, qty: 1 }]), t.nv);
    const hd = await issued(t, await child(t.nv, bg.id, "contract", { chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" }), t.nv);

    const hdAudit = await auditOf(hd.id);
    const created = hdAudit.filter((r) => r.action === "contract.created");
    expect(created).toHaveLength(1);
    expect(created[0]!.metadata).toMatchObject({ to: "draft", type: "contract", parent_id: bg.id, parent_number: bg.number });
    expect(hdAudit.map((r) => r.action)).toEqual(["contract.created", "contract.submitted", "contract.approved", "contract.issued"]);
    for (const row of hdAudit) expect(row.metadata["type"], row.action).toBe("contract");
    expect(hdAudit.find((r) => r.action === "contract.issued")!.metadata["number"]).toBe(hd.number);

    const bgAudit = await auditOf(bg.id);
    expect(bgAudit.map((r) => r.action)).toEqual(["contract.created", "contract.submitted", "contract.approved", "contract.issued"]);
    for (const row of bgAudit) expect(row.metadata["type"], row.action).toBe("quote");
    expect(bgAudit.find((r) => r.action === "contract.issued")!.metadata["number"]).toBe(bg.number);
    expect(JSON.stringify([...hdAudit, ...bgAudit])).not.toMatch(/Cô Ba|0902|@example\.com/); // no PII in audit
  }, 90_000);
});
