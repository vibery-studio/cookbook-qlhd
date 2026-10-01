/**
 * SPEC-08 API acceptance (PLAN-08 §1) — AC-1 · AC-2 · AC-3 · AC-4 · AC-5 · AC-6 · AC-7 · AC-8 + the "every new endpoint:
 * 401 anonymous / 403 + permission.denied" sweep (§5). AC-9 (seeder) is proven by C-08-006's done-check; AC-10 is the browser
 * spec `apps/web/e2e/products.spec.ts`. The money rules themselves are unit-tested in `test/domain/line-pricing.test.ts`.
 *
 * Written before the code. Calls the API exactly as SPEC-08 §3.5 + PLAN-08 §2b "API contract" say. The tables this row adds
 * (`products`, `product_prices`) are touched only through raw SQL in single assertions, so this file compiles today and each
 * test reports its own failure.
 *
 * PLAN-08 resolutions this file pins (see PLAN-08 §4):
 *   - P-1 DEC-10 (contract = exactly 1 monthly service line) makes SPEC AC-4's "DEMO-GIAY-01 × 3 −5% → 62.700" impossible as a
 *     contract → proven through `POST /pricing/preview` (generic rules only: 1–50 lines, no duplicate, active, priced); the
 *     contract case is G6 + DEMO-GIAY-01 × 3 −5% → 2.627.700.
 *   - P-2 Line problems name the line: `errors[{path: "lines.<i>.product_id"}]` for `product-inactive` / `no-price` / duplicate /
 *     unknown id (422 `validation`); the DEC-10 document rule → 422 `validation` with `errors[{path: "lines"}]`. Per-line checks run
 *     before the document rule (DT14 → `product-inactive`).
 *   - P-3 `GET /products` without `active` lists everything (the "Tất cả" tab); `active=true|false` filters.
 *   - P-4 Trigger RAISE texts contain "append-only" / "in effect" / "backdated" (asserted here to tell a trigger from a missing table).
 *
 * Clock: REAL. The `product_prices` triggers compare with SQLite's `date('now','+7 hours')`, which `vi.setSystemTime` cannot move;
 * pinning JS `Date` would make the API and the trigger disagree about "today". Assertions use `today()` / `addDays()` computed in
 * Asia/Ho_Chi_Minh, and only seed levels whose dates are already in the past (G6 2.700.000 since 2026-07-01, DEMO goods since
 * 2026-01-01). Storage is isolated per test (vitest-pool-workers); `resetDb` is a belt. Audit cleanup: `clearAuditEvents()`.
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
const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const NEW_CODES = ["price:write", "product:write"];
const SEED_TEMPLATE = "Hợp đồng cung cấp dịch vụ phần mềm";

interface Person {
  userId: string;
  email: string;
  session: RunwaySession;
}

interface Level {
  id: string;
  effective_from: string;
  effective_to: string | null;
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
  unit_price_inc_vat: number;
}

interface Product {
  id: string;
  kind: "service" | "goods";
  code: string;
  name: string;
  unit: string;
  duration_value: number | null;
  duration_unit: "day" | "month" | null;
  active: boolean;
  version: number;
  price: Level | null;
  next_price: Level | null;
  can: { edit: boolean; price: boolean };
}

interface ProductDetail extends Product {
  prices: Array<Level & { status: "past" | "current" | "scheduled" }>;
}

interface ProductList {
  date: string;
  items: Product[];
}

interface SnapLine {
  product_id: string;
  code: string;
  name: string;
  kind: "service" | "goods";
  unit: string;
  duration_value: number | null;
  duration_unit: "day" | "month" | null;
  qty: number;
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
  price_from: string;
  amount_ex_vat: number;
  discount_amount: number;
  net_ex_vat: number;
}

interface VatGroup {
  vat_rate_bps: number | null;
  base: number;
  vat: number;
}

interface Snapshot {
  lines: SnapLine[];
  vat_groups: VatGroup[];
  subtotal_ex_vat: number;
  discount_bps: number;
  discount_amount: number;
  total_ex_vat: number;
  vat_total: number;
  total: number;
  total_words: string;
  inputs: { lines: Array<{ product_id: string; qty: number }> } & Record<string, unknown>;
  dates: { doc_date: string; start: string; end: string };
}

interface Contract {
  id: string;
  status: string;
  total: number;
  version: number;
  doc_date: string;
  snapshot: Snapshot;
  snapshot_hash: string;
  rendered_hash: string | null;
}

interface Preview {
  doc_date: string;
  lines: SnapLine[];
  vat_groups: VatGroup[];
  subtotal_ex_vat: number;
  discount_amount: number;
  total_ex_vat: number;
  vat_total: number;
  total: number;
  total_words: string;
}

interface ProblemBody {
  type: string;
  status: number;
  errors?: Array<{ path: string; message: string }>;
}

interface TemplateField {
  key: string;
  type: string;
  source: string;
  required: boolean;
}

interface TemplateDetail {
  id: string;
  name: string;
  version: { version_no: number; body: string; fields: TemplateField[] };
  versions: Array<{ version_no: number }>;
}

// ---------------------------------------------------------------- clock + db

const VN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today in Vietnam (the same rule as `todayInVN` in the API and `date('now','+7 hours')` in the triggers). */
const today = (): string => VN_DAY.format(new Date());

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

async function count(query: string, ...binds: unknown[]): Promise<number> {
  return (await sqlFirst<{ n: number }>(query, ...binds))?.n ?? -1;
}

/** Raw SQL that a `product_prices` trigger must refuse — returns the error text ("" when it went through). */
async function sqlRefusal(query: string, ...binds: unknown[]): Promise<string> {
  try {
    await env.DB.prepare(query)
      .bind(...binds)
      .run();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const deniedCount = (actorId: string) =>
  count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'permission.denied' AND actor = ?", actorId);
const auditCount = (action: string) => count("SELECT COUNT(*) AS n FROM audit_events WHERE action = ?", action);
const countContracts = () => count("SELECT COUNT(*) AS n FROM contracts");

async function auditMeta(action: string): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DB.prepare("SELECT metadata FROM audit_events WHERE action = ? ORDER BY ts")
    .bind(action)
    .all<{ metadata: string | null }>();
  return rows.results.map((r) => (r.metadata === null ? {} : (JSON.parse(r.metadata) as Record<string, unknown>)));
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

interface Team {
  admin: Person;
  gd: Person;
  ql: Person;
  nv: Person;
}

/** Nhật Minh: Giám đốc Nguyễn Nhật Minh, Quản lý Tường Vi, Nhân viên Minh Khánh. */
async function team(): Promise<Team> {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
  return { admin, gd, ql, nv };
}

async function me(p: Person): Promise<{ roles: string[]; permissions: string[] }> {
  const res = await p.session.fetch("/me");
  expect(res.status).toBe(200);
  return res.json();
}

// ---------------------------------------------------------------- API helpers

let keySeq = 0;
/** A fresh ULID-shaped Idempotency-Key. */
function newKey(): string {
  keySeq += 1;
  return `01J9Z3NDEKTSV4RRFFQ6${String(keySeq).padStart(6, "0")}`;
}

const post = (by: Person, path: string, body: unknown, headers?: Record<string, string>) =>
  by.session.fetch(path, { method: "POST", body: JSON.stringify(body), headers });
const patch = (by: Person, path: string, body: unknown) => by.session.fetch(path, { method: "PATCH", body: JSON.stringify(body) });
const del = (by: Person, path: string) => by.session.fetch(path, { method: "DELETE" });

async function listProducts(by: Person, query = ""): Promise<ProductList> {
  const res = await by.session.fetch(`/products?limit=100${query === "" ? "" : `&${query}`}`);
  expect(res.status, `GET /products?${query}`).toBe(200);
  return res.json();
}

async function product(by: Person, code: string, query = ""): Promise<Product> {
  const p = (await listProducts(by, query)).items.find((x) => x.code === code);
  expect(p, `product ${code}`).toBeDefined();
  return p!;
}

async function detail(by: Person, id: string): Promise<ProductDetail> {
  const res = await by.session.fetch(`/products/${id}`);
  expect(res.status).toBe(200);
  return res.json();
}

/** code → id of every product (seed + made in the test). */
async function ids(by: Person): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of (await listProducts(by)).items) out[p.code] = p.id;
  return out;
}

const createProductRaw = (by: Person, body: Record<string, unknown>, key: string = newKey()) =>
  post(by, "/products", body, { "Idempotency-Key": key });

async function createProduct(by: Person, body: Record<string, unknown>): Promise<Product> {
  const res = await createProductRaw(by, body);
  expect(res.status, `POST /products ${String(body["code"])}`).toBe(201);
  return res.json();
}

const addPriceRaw = (by: Person, productId: string, body: Record<string, unknown>, key: string = newKey()) =>
  post(by, `/products/${productId}/prices`, body, { "Idempotency-Key": key });

/** A goods product priced from today (10%), made by the Giám đốc. */
function goods(by: Person, code: string, name: string, unitPriceExVat: number): Promise<Product> {
  return createProduct(by, {
    kind: "goods",
    code,
    name,
    unit: "cái",
    first_price: { unit_price_ex_vat: unitPriceExVat, vat_rate_bps: 1000, effective_from: today() },
  });
}

let phoneSeq = 0;
async function customer(by: Person): Promise<string> {
  phoneSeq += 1;
  const res = await by.session.fetch("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: "Tạp hóa Cô Ba",
      contact_person: "Trần Thị Ba",
      phone: `0901 234 ${String(100 + phoneSeq).padStart(3, "0")}`,
      email: `coba${phoneSeq}@example.com`,
      address: "12 Lê Lợi, Q.1, TP.HCM",
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json<{ id: string }>()).id;
}

async function templateId(by: Person): Promise<string> {
  const res = await by.session.fetch("/templates");
  expect(res.status).toBe(200);
  const body: { items: Array<{ id: string; name: string }> } = await res.json();
  const t = body.items.find((x) => x.name === SEED_TEMPLATE);
  expect(t).toBeDefined();
  return t!.id;
}

type LineIn = { product_id: string; qty: number } & Record<string, unknown>;
const VALUES = { giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" };

function createContractRaw(
  by: Person,
  tpl: string,
  customerId: string,
  lines: unknown[],
  values: Record<string, unknown> = VALUES,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return post(by, "/contracts", { template_id: tpl, customer_id: customerId, lines, values, ...extra });
}

async function createContract(
  by: Person,
  tpl: string,
  customerId: string,
  lines: LineIn[],
  values: Record<string, unknown> = VALUES,
): Promise<Contract> {
  const res = await createContractRaw(by, tpl, customerId, lines, values);
  expect(res.status, `POST /contracts ${JSON.stringify(lines)}`).toBe(201);
  return res.json();
}

async function act(by: Person, id: string, action: "submit" | "approve" | "issue", expected = 200): Promise<Contract> {
  const res = await post(by, `/contracts/${id}/${action}`, {});
  expect(res.status, `${action} ${id}`).toBe(expected);
  return res.json();
}

async function getContract(by: Person, id: string): Promise<Contract> {
  const res = await by.session.fetch(`/contracts/${id}`);
  expect(res.status).toBe(200);
  return res.json();
}

async function render(by: Person, id: string): Promise<{ res: Response; html: string }> {
  const res = await by.session.fetch(`/contracts/${id}/render`);
  expect(res.status).toBe(200);
  return { res, html: await res.text() };
}

async function problemOf(res: Response, status: number, slug: string): Promise<ProblemBody> {
  expect(res.status).toBe(status);
  const body: ProblemBody = await res.json();
  expect(body.type).toContain(slug);
  return body;
}

const paths = (p: ProblemBody) => (p.errors ?? []).map((e) => e.path);

// ================================================================ tests

describe("SPEC-08 products & prices (acceptance)", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("AC-1 / FR-3, FR-7, FR-10: product:write + price:write for QL and GĐ only; DEMO seed listed with ex-VAT prices by date", async () => {
    const { admin, gd, ql, nv } = await team();
    for (const p of [gd, ql]) for (const code of NEW_CODES) expect((await me(p)).permissions, code).toContain(code);
    for (const p of [nv, admin]) for (const code of NEW_CODES) expect((await me(p)).permissions, code).not.toContain(code);
    const roles: { catalog: string[] } = await (await gd.session.fetch("/roles")).json();
    for (const code of NEW_CODES) expect(roles.catalog).toContain(code);

    const list = await listProducts(nv);
    expect(list.date).toBe(today());
    const by = new Map(list.items.map((p) => [p.code, p]));
    for (const [code, months] of [["G3", 3], ["G6", 6], ["G12", 12]] as const) {
      expect(by.get(code), code).toMatchObject({ kind: "service", unit: "cửa hàng", duration_value: months, duration_unit: "month", active: true });
      expect(by.get(code)?.price?.vat_rate_bps, code).toBeNull(); // KCT
    }
    expect(by.get("G6")?.price).toMatchObject({ unit_price_ex_vat: 2_700_000, unit_price_inc_vat: 2_700_000, effective_from: "2026-07-01" });
    expect(by.get("DT14")).toMatchObject({ kind: "service", duration_value: 14, duration_unit: "day", active: false });
    expect(by.get("DEMO-MIN-01")).toMatchObject({ kind: "goods", unit: "cái", duration_value: null, duration_unit: null, active: true });
    expect(by.get("DEMO-MIN-01")?.price).toMatchObject({ unit_price_ex_vat: 1_000_000, vat_rate_bps: 1000, unit_price_inc_vat: 1_100_000 });
    expect(by.get("DEMO-GIAY-01")).toMatchObject({ kind: "goods", unit: "cuộn" });
    expect(by.get("DEMO-GIAY-01")?.price).toMatchObject({ unit_price_ex_vat: 20_000, vat_rate_bps: 1000 });
    for (const code of ["DEMO-MIN-01", "DEMO-GIAY-01"]) expect(by.get(code)?.name, code).toContain("DEMO");
    expect(by.get("G6")?.can).toEqual({ edit: false, price: false }); // Nhân viên reads only
    expect((await product(ql, "G6")).can).toEqual({ edit: true, price: true });

    // FR-3: the level with the greatest effective_from ≤ D; its end = the day before the next level
    const june = await product(nv, "G6", "date=2026-06-30");
    expect(june.price).toMatchObject({ unit_price_ex_vat: 2_400_000, effective_from: "2025-01-01", effective_to: "2026-06-30" });
    expect(june.next_price).toMatchObject({ unit_price_ex_vat: 2_700_000, effective_from: "2026-07-01" });
    const july = await product(nv, "G6", "date=2026-07-01");
    expect(july.price).toMatchObject({ unit_price_ex_vat: 2_700_000, effective_from: "2026-07-01", effective_to: null });
    expect((await product(nv, "G12", "date=2025-12-31")).price?.unit_price_ex_vat).toBe(4_500_000);
    expect((await product(nv, "DEMO-MIN-01", "date=2025-12-31")).price).toBeNull(); // no level before 2026-01-01
    expect((await nv.session.fetch("/products?date=2026-02-30")).status).toBe(422);

    // filters (PLAN P-3)
    expect((await listProducts(nv, "kind=goods")).items.every((p) => p.kind === "goods")).toBe(true);
    const inactive = (await listProducts(nv, "active=false")).items.map((p) => p.code);
    expect(inactive).toContain("DT14");
    expect(inactive).not.toContain("G6");
    expect((await listProducts(nv, "active=true")).items.map((p) => p.code)).not.toContain("DT14");
    expect((await listProducts(nv, "q=gi%E1%BA%A5y")).items.map((p) => p.code)).toEqual(["DEMO-GIAY-01"]); // "giấy"
  });

  it("AC-2 / FR-1, DEC-5: QL adds a goods product (code normalised, idempotent); duplicate 409; bad input 422; NV 403 + denied; anonymous 401", async () => {
    const { gd, ql, nv } = await team();
    const body = {
      kind: "goods",
      code: "may-in-01",
      name: "Máy in mã vạch",
      unit: "cái",
      first_price: { unit_price_ex_vat: 2_000_000, vat_rate_bps: 1000, effective_from: today() },
    };
    const key = newKey();
    const res = await createProductRaw(ql, body, key);
    expect(res.status).toBe(201);
    const made: Product = await res.json();
    expect(made).toMatchObject({ kind: "goods", code: "MAY-IN-01", unit: "cái", active: true, version: 1, duration_value: null });
    expect(made.price).toMatchObject({ unit_price_ex_vat: 2_000_000, vat_rate_bps: 1000, unit_price_inc_vat: 2_200_000, effective_from: today() });
    // double click: same key + same body → the same product, marked replay, no second row
    const replay = await createProductRaw(ql, body, key);
    expect([200, 201]).toContain(replay.status);
    expect((await replay.json<Product>()).id).toBe(made.id);
    expect(replay.headers.get("idempotency-replay")).toBe("true");
    expect(await count("SELECT COUNT(*) AS n FROM products WHERE code_norm = 'MAY-IN-01'")).toBe(1);
    expect(await auditCount("product.created")).toBe(1);
    expect(await auditCount("price.added")).toBe(1); // first_price, same batch (FR-8)
    expect((await auditMeta("product.created"))[0]).toMatchObject({ code: "MAY-IN-01" });

    // same code, other case / spaces → 409 duplicate
    await problemOf(await createProductRaw(gd, { ...body, code: " May-In-01 " }), 409, "duplicate");

    // a service needs a duration; goods must not have one; a monthly service is fine for the Giám đốc
    const service = await createProduct(gd, {
      kind: "service",
      code: "G24",
      name: "Gói 24 tháng",
      unit: "cửa hàng",
      duration_value: 24,
      duration_unit: "month",
      first_price: { unit_price_ex_vat: 8_000_000, vat_rate_bps: null, effective_from: today() },
    });
    expect(service.price?.vat_rate_bps).toBeNull();
    expect(service.price?.unit_price_inc_vat).toBe(8_000_000);

    const fp = (over: Record<string, unknown>) => ({ ...body.first_price, ...over });
    const bad: Array<Record<string, unknown>> = [
      { ...body, code: "MAY-IN-02", duration_value: 12, duration_unit: "month" }, // goods with a duration
      { kind: "service", code: "G99", name: "Gói", unit: "cửa hàng" }, // service without one
      { kind: "service", code: "G98", name: "Gói", unit: "cửa hàng", duration_value: 121, duration_unit: "month" },
      { ...body, code: "MÁY IN" }, // [A-Z0-9._-] only
      { ...body, code: "" },
      { ...body, code: "X".repeat(33) },
      { ...body, code: "N-121", name: "x".repeat(121) },
      { ...body, code: "U-21", unit: "x".repeat(21) },
      { ...body, code: "K-1", kind: "bundle" },
      { ...body, code: "P-1", first_price: fp({ unit_price_ex_vat: -1 }) },
      { ...body, code: "P-2", first_price: fp({ unit_price_ex_vat: 1.5 }) },
      { ...body, code: "P-3", first_price: fp({ unit_price_ex_vat: 1_000_000_000_001 }) },
      { ...body, code: "P-4", first_price: fp({ vat_rate_bps: 700 }) },
      { ...body, code: "P-5", first_price: fp({ effective_from: "2026-02-30" }) },
      { ...body, code: "P-6", unit_price: 1 }, // strict body
    ];
    for (const b of bad) expect((await createProductRaw(gd, b)).status, JSON.stringify(b)).toBe(422);
    // DEC-5 B: the first level of a new product may start today, never before
    await problemOf(await createProductRaw(gd, { ...body, code: "P-7", first_price: fp({ effective_from: addDays(today(), -1) }) }), 422, "price-backdated");

    // code and kind never change after creation
    for (const change of [{ code: "MAY-IN-99" }, { kind: "service" }]) {
      const r = await patch(ql, `/products/${made.id}`, { expected_version: 1, ...change });
      expect(r.status, JSON.stringify(change)).toBe(422);
    }

    // Nhân viên → 403 + one permission.denied naming product:write; anonymous → 401
    const before = await deniedCount(nv.userId);
    const denied = await createProductRaw(nv, { ...body, code: "NV-01" });
    expect(denied.status).toBe(403);
    expect(await deniedCount(nv.userId)).toBe(before + 1);
    const row = await sqlFirst<{ metadata: string }>(
      "SELECT metadata FROM audit_events WHERE action = 'permission.denied' AND actor = ? ORDER BY ts DESC LIMIT 1",
      nv.userId,
    );
    expect(JSON.parse(row?.metadata ?? "{}")).toMatchObject({ permission: "product:write" });
    const anon = await fetcher(`${ORIGIN}/products`, { method: "POST", headers: CSRF_HEADERS, body: JSON.stringify(body) });
    expect(anon.status).toBe(401);
    expect(await count("SELECT COUNT(*) AS n FROM products WHERE code_norm IN ('NV-01', 'MAY-IN-02', 'P-7')")).toBe(0);
  });

  it("AC-3 / FR-2, DEC-1, DEC-5, DEC-6: a new level from tomorrow; backdated 422; same day 409; cancel a scheduled level, never one in effect; triggers guard D1", async () => {
    const { gd, nv } = await team();
    const min = await product(gd, "DEMO-MIN-01");
    const current = min.price!;
    const tomorrow = addDays(today(), 1);

    await problemOf(await addPriceRaw(gd, min.id, { unit_price_ex_vat: 1_100_000, vat_rate_bps: 800, effective_from: addDays(today(), -1) }), 422, "price-backdated");
    // DEC-5 B: a LATER level starts tomorrow at the earliest (two documents of one day never differ in price)
    await problemOf(await addPriceRaw(gd, min.id, { unit_price_ex_vat: 1_100_000, vat_rate_bps: 800, effective_from: today() }), 422, "price-backdated");
    for (const b of [
      { unit_price_ex_vat: 1_100_000, vat_rate_bps: 700, effective_from: tomorrow },
      { unit_price_ex_vat: -5, vat_rate_bps: 800, effective_from: tomorrow },
      { unit_price_ex_vat: 1_100_000, vat_rate_bps: 800, effective_from: "2027-02-30" },
      { unit_price_ex_vat: 1_100_000, vat_rate_bps: 800 },
    ]) {
      expect((await addPriceRaw(gd, min.id, b)).status, JSON.stringify(b)).toBe(422);
    }

    const res = await addPriceRaw(gd, min.id, { unit_price_ex_vat: 1_100_000, vat_rate_bps: 800, effective_from: tomorrow });
    expect(res.status).toBe(201);
    const next: Level = await res.json();
    expect(next).toMatchObject({ effective_from: tomorrow, effective_to: null, unit_price_ex_vat: 1_100_000, vat_rate_bps: 800, unit_price_inc_vat: 1_188_000 });
    expect((await auditMeta("price.added"))[0]).toMatchObject({
      code: "DEMO-MIN-01",
      effective_from: tomorrow,
      unit_price_ex_vat: 1_100_000,
      vat_rate_bps: 800,
    });

    // today keeps the old level (and announces the next one); tomorrow reads the new one
    const now = await product(nv, "DEMO-MIN-01");
    expect(now.price).toMatchObject({ id: current.id, unit_price_ex_vat: 1_000_000, vat_rate_bps: 1000, effective_to: today() });
    expect(now.next_price).toMatchObject({ id: next.id, effective_from: tomorrow });
    expect((await product(nv, "DEMO-MIN-01", `date=${tomorrow}`)).price).toMatchObject({ id: next.id, unit_price_ex_vat: 1_100_000 });
    const hist = await detail(nv, min.id);
    expect(hist.prices.map((p) => [p.id, p.status])).toEqual([
      [next.id, "scheduled"],
      [current.id, "current"],
    ]);

    // same day twice → 409 duplicate (UNIQUE)
    await problemOf(await addPriceRaw(gd, min.id, { unit_price_ex_vat: 1_200_000, vat_rate_bps: 1000, effective_from: tomorrow }), 409, "duplicate");

    // DEC-6: cancel the scheduled level → 204 + price.cancelled; the level in effect → 409 price-in-effect
    expect((await del(gd, `/products/${min.id}/prices/${next.id}`)).status).toBe(204);
    expect(await auditCount("price.cancelled")).toBe(1);
    expect((await auditMeta("price.cancelled"))[0]).toMatchObject({ code: "DEMO-MIN-01", effective_from: tomorrow });
    expect((await del(gd, `/products/${min.id}/prices/${next.id}`)).status).toBe(404);
    await problemOf(await del(gd, `/products/${min.id}/prices/${current.id}`), 409, "price-in-effect");
    expect((await detail(nv, min.id)).prices.map((p) => p.id)).toEqual([current.id]);
    expect((await addPriceRaw(gd, UNKNOWN_ID, { unit_price_ex_vat: 1, vat_rate_bps: null, effective_from: tomorrow })).status).toBe(404);

    // the second lock: D1 refuses even a direct write (PLAN P-4)
    expect(await sqlRefusal("UPDATE product_prices SET unit_price_ex_vat = 1 WHERE id = ?", current.id)).toMatch(/append-only/);
    expect(await sqlRefusal("DELETE FROM product_prices WHERE id = ?", current.id)).toMatch(/in effect/);
    expect(
      await sqlRefusal(
        "INSERT INTO product_prices (id, product_id, effective_from, unit_price_ex_vat, vat_rate_bps, created_by, created_at) VALUES (?, ?, ?, 1, 1000, NULL, unixepoch())",
        "01J9ZTESTBACKDATED00000000",
        min.id,
        addDays(today(), -1),
      ),
    ).toMatch(/backdated/);
    expect(await count("SELECT COUNT(*) AS n FROM product_prices WHERE id = ? AND unit_price_ex_vat = 1000000", current.id)).toBe(1);
  });

  it("AC-4 / FR-4, FR-5, DEC-2, DEC-3: the server prices the lines on the doc date — KCT package, mixed VAT groups, per-line discount; client prices refused", async () => {
    const { nv, gd } = await team();
    const tpl = await templateId(nv);
    const c = await customer(nv);
    const id = await ids(nv);

    const a = await createContract(nv, tpl, c, [{ product_id: id["G6"]!, qty: 1 }]);
    expect(a.total).toBe(2_565_000);
    expect(a.snapshot.lines).toEqual([
      {
        product_id: id["G6"],
        code: "G6",
        name: "Gói 6 tháng",
        kind: "service",
        unit: "cửa hàng",
        duration_value: 6,
        duration_unit: "month",
        qty: 1,
        unit_price_ex_vat: 2_700_000,
        vat_rate_bps: null,
        price_from: "2026-07-01",
        amount_ex_vat: 2_700_000,
        discount_amount: 135_000,
        net_ex_vat: 2_565_000,
      },
    ]);
    expect(a.snapshot).toMatchObject({
      vat_groups: [{ vat_rate_bps: null, base: 2_565_000, vat: 0 }],
      subtotal_ex_vat: 2_700_000,
      discount_bps: 500,
      discount_amount: 135_000,
      total_ex_vat: 2_565_000,
      vat_total: 0,
      total: 2_565_000,
      total_words: "Hai triệu năm trăm sáu mươi lăm nghìn đồng",
      dates: { doc_date: today(), start: today() },
    });
    expect(a.snapshot.inputs.lines).toEqual([{ product_id: id["G6"], qty: 1 }]);
    expect(a.snapshot).not.toHaveProperty("package");
    expect(a.snapshot).not.toHaveProperty("gross");

    const b = await createContract(nv, tpl, c, [{ product_id: id["G12"]!, qty: 2 }], { ...VALUES, giam_gia: 1500 });
    expect(b.total).toBe(8_160_000);

    const mixed = await createContract(nv, tpl, c, [{ product_id: id["G6"]!, qty: 1 }, { product_id: id["DEMO-MIN-01"]!, qty: 1 }], { ...VALUES, giam_gia: 0 });
    expect(mixed.snapshot).toMatchObject({
      vat_groups: [
        { vat_rate_bps: null, base: 2_700_000, vat: 0 },
        { vat_rate_bps: 1000, base: 1_000_000, vat: 100_000 },
      ],
      subtotal_ex_vat: 3_700_000,
      total_ex_vat: 3_700_000,
      vat_total: 100_000,
      total: 3_800_000,
      total_words: "Ba triệu tám trăm nghìn đồng",
    });
    expect(mixed.total).toBe(3_800_000);

    // DEC-3: −5% on each line BEFORE VAT; DEC-2: VAT per rate group (PLAN P-1: the contract case of SPEC's 62.700)
    const paper = await createContract(nv, tpl, c, [{ product_id: id["G6"]!, qty: 1 }, { product_id: id["DEMO-GIAY-01"]!, qty: 3 }]);
    expect(paper.snapshot.lines.map((l) => [l.code, l.amount_ex_vat, l.discount_amount, l.net_ex_vat])).toEqual([
      ["G6", 2_700_000, 135_000, 2_565_000],
      ["DEMO-GIAY-01", 60_000, 3_000, 57_000],
    ]);
    expect(paper.snapshot.vat_groups).toEqual([
      { vat_rate_bps: null, base: 2_565_000, vat: 0 },
      { vat_rate_bps: 1000, base: 57_000, vat: 5_700 },
    ]);
    expect(paper.total).toBe(2_627_700);

    // DEC-13: the form's preview = the same function, nothing written; generic line rules only (PLAN P-1)
    const before = await countContracts();
    const pv = await post(nv, "/pricing/preview", { lines: [{ product_id: id["DEMO-GIAY-01"], qty: 3 }], discount_bps: 500 });
    expect(pv.status).toBe(200);
    const preview: Preview = await pv.json();
    expect(preview).toMatchObject({
      doc_date: today(),
      vat_groups: [{ vat_rate_bps: 1000, base: 57_000, vat: 5_700 }],
      subtotal_ex_vat: 60_000,
      discount_amount: 3_000,
      total_ex_vat: 57_000,
      vat_total: 5_700,
      total: 62_700,
      total_words: "Sáu mươi hai nghìn bảy trăm đồng",
    });
    expect(await countContracts()).toBe(before);
    expect((await post(gd, "/pricing/preview", { lines: [{ product_id: id["G6"], qty: 1 }], discount_bps: 10_001 })).status).toBe(422);

    // I4: the client never sends a price or a total
    const g6 = { product_id: id["G6"]!, qty: 1 };
    for (const [lines, values, extra] of [
      [[{ ...g6, unit_price: 1 }], VALUES, {}],
      [[{ ...g6, unit_price_ex_vat: 1 }], VALUES, {}],
      [[g6], VALUES, { total: 1 }],
      [[g6], VALUES, { unit_price: 1 }],
      [[g6], { ...VALUES, unit_price: 1 }, {}],
      [[g6], { ...VALUES, ma_goi: "G6", so_cua_hang: 1 }, {}], // the v1 inputs are gone
      [[{ ...g6, qty: 0 }], VALUES, {}],
      [[{ ...g6, qty: 10_000 }], VALUES, {}],
      [[{ ...g6, qty: 1.5 }], VALUES, {}],
    ] as Array<[unknown[], Record<string, unknown>, Record<string, unknown>]>) {
      const res = await createContractRaw(nv, tpl, c, lines, values, extra);
      expect(res.status, JSON.stringify({ lines, values, extra })).toBe(422);
    }
    expect(await countContracts()).toBe(before);
  });

  it("AC-5 / FR-5, I2, §4 Lifecycle: rename + new level + deactivate leave the issued paper byte-identical and the draft untouched until its creator edits it", async () => {
    const { gd, ql, nv } = await team();
    const tpl = await templateId(nv);
    const c = await customer(nv);
    const id = await ids(nv);

    const d = await createContract(nv, tpl, c, [{ product_id: id["G6"]!, qty: 1 }]);
    await act(nv, d.id, "submit");
    await act(ql, d.id, "approve");
    const issued = await act(ql, d.id, "issue");
    const first = await render(nv, d.id);
    expect(first.res.headers.get("etag")).toContain(issued.rendered_hash!);
    const draft = await createContract(nv, tpl, c, [{ product_id: id["G6"]!, qty: 1 }, { product_id: id["DEMO-MIN-01"]!, qty: 1 }]);

    const g6 = await product(gd, "G6");
    const renamed = await patch(gd, `/products/${g6.id}`, { expected_version: g6.version, name: "Gói 6 tháng (mới)" });
    expect(renamed.status).toBe(200);
    const v2: Product = await renamed.json();
    expect(v2.version).toBe(g6.version + 1);
    expect((await addPriceRaw(gd, g6.id, { unit_price_ex_vat: 2_900_000, vat_rate_bps: null, effective_from: addDays(today(), 1) })).status).toBe(201);
    const off = await patch(gd, `/products/${g6.id}`, { expected_version: v2.version, active: false });
    expect(off.status).toBe(200);
    expect((await off.json<Product>()).active).toBe(false);
    expect((await auditMeta("product.updated"))[0]).toMatchObject({ code: "G6", fields: ["name"] });
    expect(await auditCount("product.deactivated")).toBe(1);
    expect((await listProducts(nv, "active=true")).items.map((p) => p.code)).not.toContain("G6");

    // the issued paper: same bytes, same ETag, old name
    const second = await render(nv, d.id);
    expect(second.html).toBe(first.html);
    expect(second.res.headers.get("etag")).toBe(first.res.headers.get("etag"));
    expect(second.html).not.toContain("(mới)");

    // the draft: unchanged until its creator edits it; then the inactive line is named
    const still = await getContract(nv, draft.id);
    expect(still.snapshot_hash).toBe(draft.snapshot_hash);
    expect(still.total).toBe(draft.total);
    const edit = await patch(nv, `/contracts/${draft.id}`, {
      expected_version: still.version,
      lines: [{ product_id: id["G6"], qty: 1 }, { product_id: id["DEMO-MIN-01"], qty: 1 }],
      values: VALUES,
    });
    const p = await problemOf(edit, 422, "product-inactive");
    expect(paths(p)).toContain("lines.0.product_id");
    expect((await getContract(nv, draft.id)).snapshot_hash).toBe(draft.snapshot_hash);

    // back on sale → the edit re-reads the product (new name; today's price, the scheduled one is not yet in effect)
    const on = await patch(gd, `/products/${g6.id}`, { expected_version: v2.version + 1, active: true });
    expect(on.status).toBe(200);
    expect(await auditCount("product.reactivated")).toBe(1);
    const again = await patch(nv, `/contracts/${draft.id}`, {
      expected_version: still.version,
      lines: [{ product_id: id["G6"], qty: 1 }, { product_id: id["DEMO-MIN-01"], qty: 1 }],
      values: VALUES,
    });
    expect(again.status).toBe(200);
    const edited: Contract = await again.json();
    expect(edited.snapshot.lines[0]).toMatchObject({ name: "Gói 6 tháng (mới)", unit_price_ex_vat: 2_700_000 });
  });

  it("AC-6 / FR-4, DEC-10: bad line sets → 422 naming the rule or the line; nothing stored", async () => {
    const { gd, nv } = await team();
    const tpl = await templateId(nv);
    const c = await customer(nv);
    const id = await ids(nv);
    const dt7 = await createProduct(gd, {
      kind: "service",
      code: "DT7",
      name: "Dùng thử 7 ngày",
      unit: "cửa hàng",
      duration_value: 7,
      duration_unit: "day",
      first_price: { unit_price_ex_vat: 0, vat_rate_bps: null, effective_from: today() },
    });
    const unpriced = await createProduct(gd, { kind: "goods", code: "CHUA-GIA-01", name: "Ngăn kéo đựng tiền", unit: "cái" });
    const later = await createProduct(gd, {
      kind: "goods",
      code: "SAP-BAN-01",
      name: "Máy quét mã vạch",
      unit: "cái",
      first_price: { unit_price_ex_vat: 900_000, vat_rate_bps: 1000, effective_from: addDays(today(), 3) },
    });
    const G6 = { product_id: id["G6"]!, qty: 1 };
    const MIN = { product_id: id["DEMO-MIN-01"]!, qty: 1 };

    const expectLines = async (lines: unknown[], slug: string, path: string) => {
      const p = await problemOf(await createContractRaw(nv, tpl, c, lines), 422, slug);
      expect(paths(p), `${slug} ${JSON.stringify(lines)}`).toContain(path);
    };
    // document rules (DEC-10: exactly one monthly service line + 0..n goods; 1–50 lines)
    expect((await createContractRaw(nv, tpl, c, [])).status).toBe(422);
    expect((await createContractRaw(nv, tpl, c, [G6, ...Array.from({ length: 50 }, () => MIN)])).status).toBe(422);
    await expectLines([G6, { product_id: id["G12"]!, qty: 1 }], "validation", "lines"); // two services
    await expectLines([MIN], "validation", "lines"); // goods only
    await expectLines([{ product_id: dt7.id, qty: 1 }], "validation", "lines"); // a day-based service
    // line rules (checked first — PLAN P-2)
    await expectLines([{ product_id: id["DT14"]!, qty: 1 }], "product-inactive", "lines.0.product_id");
    await expectLines([G6, MIN, MIN], "validation", "lines.2.product_id"); // the same product twice
    await expectLines([G6, { product_id: unpriced.id, qty: 1 }], "no-price", "lines.1.product_id");
    await expectLines([G6, { product_id: later.id, qty: 1 }], "no-price", "lines.1.product_id"); // priced only from D+3
    await expectLines([G6, { product_id: UNKNOWN_ID, qty: 1 }], "validation", "lines.1.product_id");
    expect(await countContracts()).toBe(0);
  });

  it("AC-7 / FR-6, DEC-7, DEC-8: template v2 prints the line table (escaped), pre-tax money, VAT by rate, the payable total in words; no 'đã gồm VAT'", async () => {
    const { gd, nv } = await team();
    const tpl = await templateId(nv);
    const c = await customer(nv);
    const id = await ids(nv);

    // DEC-8: the lines version is current (v2; SPEC-09 0026 adds v3 = v2 + parent:* sources), older ones kept (append-only)
    const seed: TemplateDetail = await (await nv.session.fetch(`/templates/${tpl}`)).json();
    expect(seed.version.version_no).toBe(3);
    expect(seed.versions.map((v) => v.version_no).sort()).toEqual([1, 2, 3]);
    const keys = new Map(seed.version.fields.map((f) => [f.key, f]));
    expect(keys.get("bang_hang")).toMatchObject({ type: "lines", source: "derived:lines_table" });
    for (const [key, source] of [
      ["ten_goi", "derived:service_name"],
      ["tien_truoc_thue", "derived:subtotal_ex_vat"],
      ["tien_giam_gia", "derived:discount_amount"],
      ["thue_suat", "derived:vat_rates"],
      ["tien_thue", "derived:vat_total"],
      ["tong_thanh_toan", "derived:total"],
      ["tong_thanh_toan_bang_chu", "derived:total_in_words"],
    ]) {
      expect(keys.get(key!)?.source, key).toBe(source);
    }
    for (const gone of ["ma_goi", "so_cua_hang", "tong_tien"]) expect(keys.has(gone), gone).toBe(false);
    expect(seed.version.fields.some((f) => f.source.startsWith("price_list:"))).toBe(false);
    expect(seed.version.body).not.toContain("đã gồm VAT");
    const v1: TemplateDetail = await (await nv.session.fetch(`/templates/${tpl}?version_no=1`)).json();
    expect(v1.version.body).toContain("đã gồm VAT"); // v1 byte-for-byte as seeded

    const a = await createContract(nv, tpl, c, [{ product_id: id["G6"]!, qty: 1 }]);
    const html = (await render(nv, a.id)).html;
    expect(html).toContain("<table");
    for (const head of ["STT", "ĐVT", "Đơn giá chưa VAT", "Thuế suất", "Thành tiền chưa VAT"]) expect(html, head).toContain(head);
    for (const text of ["Gói 6 tháng", "2.700.000", "135.000", "2.565.000", "KCT", "Hai triệu năm trăm sáu mươi lăm nghìn đồng"]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("đã gồm VAT");
    expect(html).not.toContain("{{");

    const mixed = await createContract(nv, tpl, c, [{ product_id: id["G6"]!, qty: 1 }, { product_id: id["DEMO-MIN-01"]!, qty: 1 }], { ...VALUES, giam_gia: 0 });
    const mixedHtml = (await render(nv, mixed.id)).html;
    for (const text of ["KCT, 10%", "100.000", "3.800.000", "Máy in hóa đơn (DEMO)"]) expect(mixedHtml, text).toContain(text);

    // every cell is escaped: a product named <b>x</b> prints as text
    const xss = await goods(gd, "XSS-01", "<b>x</b>", 1_000);
    const x = await createContract(nv, tpl, c, [{ product_id: id["G6"]!, qty: 1 }, { product_id: xss.id, qty: 1 }]);
    const xHtml = (await render(nv, x.id)).html;
    expect(xHtml).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(xHtml).not.toContain("<b>x</b>");
  });

  it("AC-8 / §4 Two people: two PATCHes on one version → 200 + 409 stale, one audit row; two levels on one day at once → 201 + 409", async () => {
    const { gd, ql } = await team();
    const g6 = await product(gd, "G6");
    const [r1, r2] = await Promise.all([
      patch(gd, `/products/${g6.id}`, { expected_version: g6.version, name: "Gói 6 tháng A" }),
      patch(ql, `/products/${g6.id}`, { expected_version: g6.version, name: "Gói 6 tháng B" }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect((await loser.json<ProblemBody>()).type).toContain("stale");
    expect(await auditCount("product.updated")).toBe(1);
    const winner = r1.status === 200 ? "Gói 6 tháng A" : "Gói 6 tháng B";
    expect((await product(gd, "G6")).name).toBe(winner);

    const min = await product(gd, "DEMO-MIN-01");
    const day = addDays(today(), 2);
    const [p1, p2] = await Promise.all([
      addPriceRaw(gd, min.id, { unit_price_ex_vat: 1_050_000, vat_rate_bps: 1000, effective_from: day }),
      addPriceRaw(ql, min.id, { unit_price_ex_vat: 1_060_000, vat_rate_bps: 1000, effective_from: day }),
    ]);
    expect([p1.status, p2.status].sort()).toEqual([201, 409]);
    expect(await count("SELECT COUNT(*) AS n FROM product_prices WHERE product_id = ? AND effective_from = ?", min.id, day)).toBe(1);
    expect(await auditCount("price.added")).toBe(1); // the loser writes no audit row (§4 Failure)

    // a stale write after the race → 409 stale; unknown product → 404
    await problemOf(await patch(ql, `/products/${g6.id}`, { expected_version: g6.version, unit: "chi nhánh" }), 409, "stale");
    expect((await patch(ql, `/products/${UNKNOWN_ID}`, { expected_version: 1, name: "x" })).status).toBe(404);
  });

  it("§5 / §4 Permissions: anonymous → 401 on every new endpoint; Nhân viên reads but every write → 403 + one permission.denied; admin has no product access; GET /price-list is gone", async () => {
    const { admin, nv, gd } = await team();
    const g6 = await product(gd, "G6");
    const level = g6.price!;
    const endpoints: Array<[string, string, unknown?]> = [
      ["GET", "/products"],
      ["GET", `/products/${g6.id}`],
      ["POST", "/products", { kind: "goods", code: "Z-1", name: "Z", unit: "cái" }],
      ["PATCH", `/products/${g6.id}`, { expected_version: g6.version, name: "Z" }],
      ["POST", `/products/${g6.id}/prices`, { unit_price_ex_vat: 1, vat_rate_bps: null, effective_from: addDays(today(), 5) }],
      ["DELETE", `/products/${g6.id}/prices/${level.id}`],
      ["POST", "/pricing/preview", { lines: [{ product_id: g6.id, qty: 1 }], discount_bps: 0 }],
    ];
    for (const [method, path, body] of endpoints) {
      const res = await fetcher(`${ORIGIN}${path}`, { method, headers: CSRF_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(res.status, `anonymous ${method} ${path}`).toBe(401);
      expect(await res.text()).not.toContain("Gói 6 tháng");
    }

    // Nhân viên: reads + preview yes; writes no — exactly one denied row each
    expect((await nv.session.fetch("/products")).status).toBe(200);
    expect((await nv.session.fetch(`/products/${g6.id}`)).status).toBe(200);
    for (const [method, path, body] of endpoints.slice(2, 6)) {
      const before = await deniedCount(nv.userId);
      const res = await nv.session.fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(res.status, `nhan_vien ${method} ${path}`).toBe(403);
      expect(await deniedCount(nv.userId), `${method} ${path}`).toBe(before + 1);
    }

    // admin: no contract:read, no product:write → 403 (+ denied)
    const before = await deniedCount(admin.userId);
    expect((await admin.session.fetch("/products")).status).toBe(403);
    expect((await post(admin, "/products", { kind: "goods", code: "Z-2", name: "Z", unit: "cái" })).status).toBe(403);
    expect((await post(admin, "/pricing/preview", { lines: [{ product_id: g6.id, qty: 1 }], discount_bps: 0 })).status).toBe(403);
    expect(await deniedCount(admin.userId)).toBe(before + 3);

    // nothing moved
    expect((await product(gd, "G6")).name).toBe("Gói 6 tháng");
    expect(await count("SELECT COUNT(*) AS n FROM products WHERE code_norm IN ('Z-1', 'Z-2')")).toBe(0);
    expect((await detail(gd, g6.id)).prices.map((p) => p.id)).toContain(level.id);

    // DEC-9: GET /price-list is removed (the table stays, unread)
    expect((await nv.session.fetch("/price-list")).status).toBe(404);
    expect((await gd.session.fetch(`/products/${UNKNOWN_ID}`)).status).toBe(404);
  });
});
