/**
 * SPEC-10 acceptance (AC-1 … AC-7) — import a Word template: POST /templates/import/preview (stateless) + save through the
 * EXISTING POST /templates · POST /templates/{id}/versions. Written before the code (PLAN-10 §1); calls the API exactly as
 * SPEC-10 §3.4 says. AC-8 (done-check) is the e2e `apps/web/e2e/templates-import.spec.ts`; converter details that the API
 * cannot see (structure mapping, lying zip headers, entry count, slug table) live in `test/domain/docx-convert.test.ts`.
 * Fixtures: `test/fixtures/docx/` (3 box files verbatim + build-fixtures.mjs), read through fixtures.generated.ts (base64).
 * Helpers follow templates-acceptance.test.ts / contracts-pdf-acceptance.test.ts (those files are not edited).
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
import { fixtureBytes, type DocxFixtureName } from "../fixtures/docx/fixtures.generated";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const SEED_NAME = "Hợp đồng cung cấp dịch vụ phần mềm";
const DOCX_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PREVIEW = "/templates/import/preview";
const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);

/** Box rule (INTENT-09 Q-3, SPEC-10 FR-10): Quản lý duyệt; giảm > 10% thêm Giám đốc — same shape as the seed's policy. */
const BOX_POLICY = {
  mode: "combined",
  steps: [{ step_no: 1, label: "Quản lý duyệt", permission: "contract:approve" }],
  rules: [
    {
      when: { var: "discount_bps", op: "gt", value: 1000 },
      add_steps: [{ label: "Giám đốc duyệt", permission: "contract:approve", role: "giam_doc" }],
    },
  ],
};

const BAO_GIA_KEYS = [
  "so_bao_gia", "ngay_bao_gia", "ten_khach", "ten_cua_hang", "sdt", "email", "ten_goi", "so_cua_hang", "don_gia",
  "giam_gia", "thanh_tien", "tong_tien", "tong_tien_bang_chu", "hieu_luc_den", "nv_phu_trach",
];
const BAO_GIA_LINE_KEYS = ["ten_goi", "so_cua_hang", "don_gia", "giam_gia", "thanh_tien"];

type Role = "giam_doc" | "quan_ly" | "nhan_vien";
interface Staff {
  userId: string;
  email: string;
  session: RunwaySession;
}
interface Team {
  admin: RunwaySession;
  gd: Staff;
  ql: Staff;
  nv: Staff;
}

// ---- response shapes (SPEC-10 §3.4) ------------------------------------------------------------------------------
interface FieldDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  source: string;
  options?: string[];
  default?: string | number;
}
interface Preview {
  body: string;
  placeholders: Array<{
    key: string;
    original: string;
    count: number;
    table_index: number | null;
    suggested: FieldDef;
    suggestion_from: "current_version" | "other_template" | "none";
  }>;
  tables: Array<{ index: number; rows: number; cols: number; placeholder_keys: string[] }>;
  removed: Array<{ kind: "internal_note"; text: string }>;
  warnings: Array<{ code: string; message: string; count: number }>;
  sources: string[];
  base: {
    template_id: string | null;
    version_no: number | null;
    approval_policy: Record<string, unknown>;
    field_rules: Array<{ all_or_none: string[] }>;
    default_line_items: unknown[];
    default_clauses: unknown[];
  };
  check_errors: Array<{ code: string; key?: string; source?: string; message: string }>;
  stats: { body_bytes: number; fields: number };
}
interface ProblemBody {
  type: string;
  status: number;
  reason?: string;
  errors?: Array<{ path?: string; code?: string; key?: string; message: string }>;
}
interface TemplateDetail {
  id: string;
  type: string;
  name: string;
  version: {
    id: string;
    version_no: number;
    body: string;
    fields: FieldDef[];
    field_rules: Array<{ all_or_none: string[] }>;
    approval_policy: Record<string, unknown>;
    note: string | null;
  };
}

// ---- fixtures ----------------------------------------------------------------------------------------------------
/**
 * Reset that survives row 4 (which seeds more templates and a newer contract version): seeded templates/versions have
 * `created_by` NULL, so only rows made by people are removed (append-only trigger dropped/recreated around it) and every
 * template points back at its newest remaining version. Contracts first (AC-6).
 */
async function resetDb(): Promise<void> {
  for (const table of ["approval_steps", "contracts", "customers", "idempotency_keys"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const triggers = await env.DB.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'template_versions'",
  ).all<{ name: string; sql: string }>();
  for (const t of triggers.results) await env.DB.prepare(`DROP TRIGGER ${t.name}`).run();
  try {
    await env.DB.prepare("DELETE FROM template_versions WHERE created_by IS NOT NULL").run();
    await env.DB.prepare("DELETE FROM templates WHERE created_by IS NOT NULL").run();
    await env.DB.prepare(
      "UPDATE templates SET current_version_id = (SELECT id FROM template_versions v WHERE v.template_id = templates.id ORDER BY v.version_no DESC LIMIT 1)",
    ).run();
  } finally {
    for (const t of triggers.results) await env.DB.prepare(t.sql).run();
  }
  await clearAuditEvents(env.DB, "NOT (action IN ('template.created', 'template.version_created') AND actor IS NULL)");
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
}

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
  const res = await by.fetch("/admin/users", { method: "POST", body: JSON.stringify({ email, display_name: displayName, role }) });
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

async function team(): Promise<Team> {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
  return { admin, gd, ql, nv };
}

function preview(
  s: RunwaySession,
  body: Uint8Array | string,
  q: { template_id?: string; lines_table?: number } = {},
  contentType: string = DOCX_CT,
): Promise<Response> {
  const qs = new URLSearchParams();
  if (q.template_id !== undefined) qs.set("template_id", q.template_id);
  if (q.lines_table !== undefined) qs.set("lines_table", String(q.lines_table));
  const query = qs.size > 0 ? `?${qs.toString()}` : "";
  return s.fetch(`${PREVIEW}${query}`, { method: "POST", headers: { "content-type": contentType }, body });
}

async function previewOk(s: RunwaySession, name: DocxFixtureName, q: { template_id?: string; lines_table?: number } = {}): Promise<Preview> {
  const res = await preview(s, fixtureBytes(name), q);
  expect(res.status, `${name} ${JSON.stringify(q)}`).toBe(200);
  return res.json();
}

/** What the web sends on "Lưu": body + one field per placeholder (its suggestion) + base (SPEC-10 DEC-2 A, FR-10). */
function versionFrom(pv: Preview, note: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body: pv.body,
    fields: pv.placeholders.map((p) => p.suggested),
    field_rules: pv.base.field_rules,
    default_line_items: pv.base.default_line_items,
    default_clauses: pv.base.default_clauses,
    approval_policy: pv.base.approval_policy,
    note,
    ...over,
  };
}

async function getSeed(s: RunwaySession): Promise<TemplateDetail> {
  const list: { items: Array<{ id: string; name: string }> } = await (await s.fetch("/templates")).json();
  const item = list.items.find((t) => t.name === SEED_NAME);
  expect(item).toBeTruthy();
  return (await s.fetch(`/templates/${item!.id}`)).json();
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const r = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return r?.n ?? -1;
}
/** Rows a preview must never add (SPEC-10 FR-1: "Không ghi gì"). */
async function writeFootprint(): Promise<string> {
  const parts = await Promise.all([
    count("SELECT COUNT(*) AS n FROM templates"),
    count("SELECT COUNT(*) AS n FROM template_versions"),
    count("SELECT COUNT(*) AS n FROM audit_events WHERE action <> 'permission.denied'"),
    count("SELECT COUNT(*) AS n FROM idempotency_keys"),
  ]);
  return parts.join("/");
}

async function problemOf(res: Response): Promise<ProblemBody> {
  return res.json();
}

function byKey(pv: Preview) {
  return new Map(pv.placeholders.map((p) => [p.key, p]));
}

// contracts (AC-6) — pattern of contracts-pdf-acceptance
let phoneSeq = 0;
function post(by: Staff, path: string, body: unknown): Promise<Response> {
  return by.session.fetch(path, { method: "POST", body: JSON.stringify(body) });
}
async function draftOnSeed(t: Team, templateId: string): Promise<{ id: string }> {
  phoneSeq += 1;
  const cRes = await post(t.nv, "/customers", {
    name: "Tạp hóa Cô Ba",
    contact_person: "Trần Thị Ba",
    phone: `0901 234 ${String(500 + phoneSeq).padStart(3, "0")}`,
    email: `coba-import${phoneSeq}@example.com`,
    address: "12 Lê Lợi, Q.1, TP.HCM",
  });
  expect(cRes.status).toBe(201);
  const cust: { id: string } = await cRes.json();
  const res = await post(t.nv, "/contracts", {
    template_id: templateId,
    customer_id: cust.id,
    lines: [{ product_id: "01PROD000000000000000000G6", qty: 1 }],
    values: { giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" },
  });
  expect(res.status).toBe(201);
  return res.json();
}
async function act(by: Staff, id: string, action: "submit" | "approve" | "issue"): Promise<void> {
  const res = await post(by, `/contracts/${id}/${action}`, {});
  expect(res.status, `${action} ${id}`).toBe(200);
}

// ================================================================ tests

describe("SPEC-10 import a Word template (acceptance)", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("AC-1: Bao_Gia.docx → 15 fields, 1 line table, nothing written; lines_table=0 → {{bang_hang}} replaces the table, 12 fields (giam_gia kept, P-7), no check error", async () => {
    const { gd } = await team();
    const before = await writeFootprint();

    const pv = await previewOk(gd.session, "Bao_Gia.docx");
    expect(pv.placeholders.map((p) => p.key).sort()).toEqual([...BAO_GIA_KEYS].sort());
    for (const p of pv.placeholders) expect(p.count, p.key).toBe(1);
    expect(pv.tables).toEqual([{ index: 0, rows: 2, cols: 6, placeholder_keys: BAO_GIA_LINE_KEYS }]);
    const k = byKey(pv);
    for (const key of BAO_GIA_LINE_KEYS) expect(k.get(key)?.table_index, key).toBe(0);
    expect(k.get("tong_tien")?.table_index).toBeNull();
    // FR-4 / DEC-5: no target template → same key on another template's current version (the seed v2), else a manual default
    expect(k.get("ten_khach")).toMatchObject({ suggestion_from: "other_template", suggested: { source: "subject:contact_person" } });
    for (const p of pv.placeholders.filter((x) => x.suggestion_from === "none")) {
      expect(p.suggested, p.key).toEqual({ key: p.key, label: p.original, type: "text", required: true, source: "manual" });
    }
    // body is the converter's tag set only; Heading1 → <h1>; Bên A stays
    expect(pv.body).toContain("<h1>BÁO GIÁ</h1>");
    expect(pv.body).toContain("CÔNG TY TNHH PHẦN MỀM NHẬT MINH");
    expect(pv.body).toContain("<table>");
    expect(pv.check_errors.filter((e) => e.code === "html_not_allowed")).toEqual([]);
    expect(pv.removed).toEqual([]);
    // FR-10: a new template gets the box policy and empty defaults
    expect(pv.base).toEqual({
      template_id: null,
      version_no: null,
      approval_policy: BOX_POLICY,
      field_rules: [],
      default_line_items: [],
      default_clauses: [],
    });
    expect(pv.sources).toEqual(expect.arrayContaining(["manual", "subject:name", "subject:contact_person", "issue:number", "derived:total", "derived:lines_table"]));
    expect(pv.stats).toEqual({ body_bytes: new TextEncoder().encode(pv.body).length, fields: 15 });

    // DEC-4 B: "Đây là bảng dòng hàng"
    const lines = await previewOk(gd.session, "Bao_Gia.docx", { lines_table: 0 });
    expect(lines.body).toContain("{{bang_hang}}");
    expect(lines.body).not.toContain("<table");
    const lk = byKey(lines);
    expect(lines.placeholders).toHaveLength(12);
    for (const gone of BAO_GIA_LINE_KEYS.filter((k) => k !== "giam_gia")) expect(lk.has(gone), gone).toBe(false);
    // P-7: the document-level discount stays a field (the >10% → Giám đốc rule needs it), printed right after the table
    expect(lk.has("giam_gia")).toBe(true);
    expect(lines.body).toMatch(/\{\{bang_hang\}\}[\s\S]*Giảm giá: \{\{giam_gia\}\}%/);
    expect(lk.get("bang_hang")?.suggested).toMatchObject({ type: "lines", source: "derived:lines_table" });
    expect(lines.check_errors).toEqual([]);
    expect(lines.stats.fields).toBe(12);

    expect(await writeFootprint()).toBe(before);
  });

  it("AC-2: split runs + proofErr, {{Tên khách}}, {{Mã nội bộ}}, duplicates, '{{' across two paragraphs → one ten_khach (count 2, renamed), so_de_nghi ×2, placeholder_without_field", async () => {
    const { gd } = await team();
    const pv = await previewOk(gd.session, "split-run.docx");
    const k = byKey(pv);
    expect(pv.placeholders.map((p) => p.key).sort()).toEqual(["ma_noi_bo", "so_de_nghi", "ten_khach"]);
    // a key no template has → manual default, label = the original Vietnamese name (DEC-3, FR-4)
    expect(k.get("ma_noi_bo")).toMatchObject({
      suggestion_from: "none",
      original: "Mã nội bộ",
      suggested: { key: "ma_noi_bo", label: "Mã nội bộ", type: "text", required: true, source: "manual" },
    });
    expect(k.get("ten_khach")?.count).toBe(2);
    expect(k.get("ten_khach")?.original).toContain("Tên khách");
    expect(k.get("so_de_nghi")?.count).toBe(2);
    expect(pv.warnings.map((w) => w.code)).toContain("key_renamed");
    // FR-2: the placeholder is printed plain, never split by the run formatting it crossed
    expect(pv.body.match(/\{\{ten_khach\}\}/g)).toHaveLength(2);
    expect(pv.body).not.toMatch(/\{\{ten_<\/strong>/);
    expect(pv.body).not.toContain("Tên khách}}");
    // the broken one is kept as text → checkTemplate blocks the save
    expect(pv.check_errors.map((e) => e.code)).toContain("placeholder_without_field");
  });

  it("AC-3: new version from Hop_Dong_Dich_Vu.docx → internal note removed, suggestions from the current version, base = current; save → N+1 with note; stale save → 409", async () => {
    const { gd } = await team();
    const seed = await getSeed(gd.session);
    const pv = await previewOk(gd.session, "Hop_Dong_Dich_Vu.docx", { template_id: seed.id });

    expect(pv.removed).toHaveLength(1);
    expect(pv.removed[0]).toMatchObject({ kind: "internal_note" });
    expect(pv.removed[0]?.text).toContain("Ghi chú nội bộ");
    expect(pv.body).not.toContain("Ghi chú nội bộ");
    expect(pv.body).not.toContain("xóa trước khi gửi khách");
    expect(pv.tables).toEqual([]); // the 2×2 signature table has no field
    const k = byKey(pv);
    const SEED_V = seed.version.version_no;
    const current = new Map(seed.version.fields.map((f) => [f.key, f]));
    for (const key of ["ten_khach", "so_hop_dong", "ten_cua_hang", "sdt", "email", "chuc_vu_nguoi_ky", "ngay_ket_thuc"]) {
      expect(k.get(key)?.suggestion_from, key).toBe("current_version");
      expect(k.get(key)?.suggested, key).toEqual(current.get(key));
    }
    expect(k.get("tong_tien")?.suggestion_from).not.toBe("current_version"); // the seed dropped it in v2 (SPEC-08)
    expect(pv.base).toMatchObject({ template_id: seed.id, version_no: SEED_V });
    expect(pv.base.approval_policy).toEqual(seed.version.approval_policy);
    // FR-10: rules copied only while every key they name is still in the file
    const inFile = new Set(pv.placeholders.map((p) => p.key));
    expect(pv.base.field_rules).toEqual(seed.version.field_rules.filter((r) => r.all_or_none.every((key) => inFile.has(key))));
    expect(pv.check_errors).toEqual([]);

    const payload = { expected_version_no: SEED_V, ...versionFrom(pv, "Nhập từ Hop_Dong_Dich_Vu.docx") };
    const saved = await gd.session.fetch(`/templates/${seed.id}/versions`, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
    expect(saved.status).toBe(201);
    const t: TemplateDetail = await saved.json();
    expect(t.version.version_no).toBe(SEED_V + 1);
    expect(t.version.note).toBe("Nhập từ Hop_Dong_Dich_Vu.docx");
    expect(t.version.body).toBe(pv.body);

    // two directors at once (§4 Two people): the slower one still holds expected_version_no 2
    const stale = await gd.session.fetch(`/templates/${seed.id}/versions`, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
    expect(stale.status).toBe(409);
    expect((await problemOf(stale)).type).toMatch(/\/stale$/);
    // re-preview against the template now reports the new base
    const again = await previewOk(gd.session, "Hop_Dong_Dich_Vu.docx", { template_id: seed.id });
    expect(again.base.version_no).toBe(SEED_V + 1);
  });

  it("AC-4: rejections — pdf, .docm, inflate bomb, DOCTYPE, 3 MB, text/plain, lines_table out of range, unknown template_id — and nothing is written", async () => {
    const { gd } = await team();
    const before = await writeFootprint();

    const reasons: Array<[DocxFixtureName, string]> = [
      ["not-a-docx.pdf", "not_docx"],
      ["macro.docm", "macro_enabled"],
      ["bomb-declared.docx", "too_large_inflated"],
      ["doctype.docx", "xml_invalid"],
    ];
    for (const [name, reason] of reasons) {
      const res = await preview(gd.session, fixtureBytes(name));
      expect(res.status, name).toBe(422);
      expect(res.headers.get("content-type"), name).toContain("application/problem+json");
      const body: ProblemBody = await res.json();
      expect(body.type, name).toMatch(/\/docx-invalid$/);
      expect(body.reason, name).toBe(reason);
    }

    const big = new Uint8Array(3 * 1024 * 1024);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    const tooBig = await preview(gd.session, big);
    expect(tooBig.status).toBe(413);
    expect(tooBig.headers.get("content-type")).toContain("application/problem+json");

    const wrongType = await preview(gd.session, fixtureBytes("Bao_Gia.docx"), {}, "text/plain");
    expect(wrongType.status).toBe(415);
    expect(wrongType.headers.get("content-type")).toContain("application/problem+json");

    const outOfRange = await preview(gd.session, fixtureBytes("Bao_Gia.docx"), { lines_table: 5 });
    expect(outOfRange.status).toBe(422);
    expect((await problemOf(outOfRange)).type).toMatch(/\/validation$/);

    const unknown = await preview(gd.session, fixtureBytes("Bao_Gia.docx"), { template_id: UNKNOWN_ID });
    expect(unknown.status).toBe(404);

    expect(await writeFootprint()).toBe(before);
  });

  it("AC-5: script text + javascript: link escaped/dropped; image, header {{x}}, merged cells → one warning each; saving a hand-added <img> → 422 html_not_allowed", async () => {
    const { gd } = await team();
    const pv = await previewOk(gd.session, "xss-and-drops.docx");
    expect(pv.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(pv.body).not.toContain("<script");
    expect(pv.body).not.toMatch(/<a[\s>]/);
    expect(pv.body).not.toContain("javascript:");
    expect(pv.body).toContain("bấm đây"); // link text kept, URL dropped
    expect(pv.body).not.toMatch(/<img/i);
    expect(pv.body).not.toContain("{{x}}"); // header content never reaches the body
    expect(pv.placeholders.map((p) => p.key).sort()).toEqual(["so_hop_dong", "ten_khach"]);
    expect(pv.check_errors.filter((e) => e.code === "html_not_allowed")).toEqual([]);
    const codes = pv.warnings.map((w) => w.code);
    for (const code of ["image_dropped", "header_footer_placeholder", "merged_cells_flattened"]) {
      expect(codes.filter((c) => c === code), code).toHaveLength(1);
    }
    expect(pv.warnings.find((w) => w.code === "image_dropped")?.count).toBe(1);

    const res = await gd.session.fetch("/templates", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        type: "contract",
        name: "Mẫu XSS",
        subject_type: "customer",
        version: versionFrom(pv, "Nhập từ xss-and-drops.docx", { body: `${pv.body}<img src="x">` }),
      }),
    });
    expect(res.status).toBe(422);
    const prob: ProblemBody = await res.json();
    expect(prob.type).toMatch(/\/template-check-failed$/);
    expect(prob.errors?.map((e) => e.code)).toContain("html_not_allowed");
  });

  it("AC-6: importing a new version leaves an issued contract's render byte-identical and keeps the draft on its version", async () => {
    const t = await team();
    const seed = await getSeed(t.gd.session);
    const issued = await draftOnSeed(t, seed.id);
    await act(t.nv, issued.id, "submit");
    await act(t.ql, issued.id, "approve");
    await act(t.ql, issued.id, "issue");
    const draft = await draftOnSeed(t, seed.id);
    const renderBefore = await (await t.nv.session.fetch(`/contracts/${issued.id}/render`)).text();
    expect(renderBefore.length).toBeGreaterThan(0);

    const pv = await previewOk(t.gd.session, "Hop_Dong_Dich_Vu.docx", { template_id: seed.id });
    const saved = await t.gd.session.fetch(`/templates/${seed.id}/versions`, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expected_version_no: seed.version.version_no, ...versionFrom(pv, "Nhập từ Hop_Dong_Dich_Vu.docx") }),
    });
    expect(saved.status).toBe(201);

    const renderAfter = await (await t.nv.session.fetch(`/contracts/${issued.id}/render`)).text();
    expect(renderAfter).toBe(renderBefore);
    const d: { template_version_id: string } = await (await t.nv.session.fetch(`/contracts/${draft.id}`)).json();
    expect(d.template_version_id).toBe(seed.version.id);
  });

  it("AC-7: Nhân viên / Quản lý → 403 + one permission.denied each; no cookie → 401; Giám đốc without X-Requested-With → 403", async () => {
    const { gd, ql, nv } = await team();
    const bytes = fixtureBytes("Bao_Gia.docx");
    for (const s of [nv, ql]) {
      const res = await preview(s.session, bytes);
      expect(res.status, s.email).toBe(403);
      expect(
        await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'permission.denied' AND actor = ? AND target = ?", s.userId, PREVIEW),
        s.email,
      ).toBe(1);
    }

    const anon = await fetcher(`${ORIGIN}${PREVIEW}`, { method: "POST", headers: { ...CSRF_HEADERS, "content-type": DOCX_CT }, body: bytes });
    expect(anon.status).toBe(401);

    const noFetchHeader = await fetcher(`${ORIGIN}${PREVIEW}`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": DOCX_CT,
        cookie: `runway_at=${gd.session.accessCookie}; runway_rt=${gd.session.refreshCookie}`,
      },
      body: bytes,
    });
    expect(noFetchHeader.status).toBe(403);
    expect((await problemOf(noFetchHeader)).type).toMatch(/\/forbidden$/);
  });
});
