/**
 * SPEC-02 acceptance (AC-1 … AC-11): versioned contract templates + the seeded "Hợp đồng cung cấp dịch vụ phần mềm".
 * Written before the code (PLAN-02 §1). Calls the API exactly as SPEC-02 §3.8 says; the tables this row adds
 * (`templates`, `template_versions`) are touched only through raw SQL so the file compiles before the schema exists.
 * Fixtures follow foundation-acceptance.test.ts: seedAdmin → invite → activate → login.
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
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
const SEED_NAME = "Hợp đồng cung cấp dịch vụ phần mềm";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);

type Role = "giam_doc" | "quan_ly" | "nhan_vien";
interface Staff {
  userId: string;
  email: string;
  session: RunwaySession;
}

// ---- response shapes (SPEC-02 §3.8) ----------------------------------------------------------------------------
interface FieldDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  source: string;
  options?: string[];
  options_from?: string;
  default?: string | number;
}
interface VersionDetail {
  id: string;
  version_no: number;
  body: string;
  fields: FieldDef[];
  field_rules: Array<{ all_or_none: string[] }>;
  default_line_items: unknown[];
  default_clauses: unknown[];
  approval_policy: Record<string, unknown>;
  note?: string | null;
  created_at: number;
  created_by_name: string | null;
}
interface TemplateDetail {
  id: string;
  type: string;
  name: string;
  subject_type: string;
  active: boolean;
  version: VersionDetail;
  versions: Array<{ id: string; version_no: number; created_at: number; created_by_name: string | null; note?: string | null }>;
}
interface TemplateList {
  items: Array<{
    id: string;
    type: string;
    name: string;
    active: boolean;
    current_version: { id: string; version_no: number; created_at: number; created_by_name: string | null };
    required_fields: string[];
    steps_summary: unknown;
  }>;
  next_cursor: string | null;
}
interface CheckProblem {
  type: string;
  status: number;
  errors: Array<{ code: string; key?: string; source?: string; message: string }>;
}

// ---- fixtures ----------------------------------------------------------------------------------------------------
/**
 * `template_versions` is append-only (a DB trigger refuses UPDATE/DELETE — AC-10), so the per-test reset
 * drops that trigger, removes what tests created, puts the seed template back on v1, and recreates the trigger.
 * Everything is raw SQL and tolerant of a missing table (red run).
 */
async function resetTemplates(): Promise<void> {
  try {
    const seed = await env.DB.prepare("SELECT id FROM templates WHERE name = ?").bind(SEED_NAME).first<{ id: string }>();
    const triggers = await env.DB.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'template_versions'",
    ).all<{ name: string; sql: string }>();
    for (const t of triggers.results) await env.DB.prepare(`DROP TRIGGER ${t.name}`).run();
    try {
      if (seed) {
        await env.DB.prepare("DELETE FROM template_versions WHERE template_id <> ? OR version_no > 1").bind(seed.id).run();
        await env.DB.prepare("DELETE FROM templates WHERE id <> ?").bind(seed.id).run();
        await env.DB.prepare(
          "UPDATE templates SET current_version_id = (SELECT id FROM template_versions WHERE template_id = templates.id AND version_no = 1) WHERE id = ?",
        )
          .bind(seed.id)
          .run();
      } else {
        await env.DB.prepare("DELETE FROM template_versions").run();
        await env.DB.prepare("DELETE FROM templates").run();
      }
    } finally {
      for (const t of triggers.results) await env.DB.prepare(t.sql).run();
    }
  } catch {
    // tables not created yet (red run) — the assertions below report the real failure
  }
}

async function resetDb(): Promise<void> {
  await resetTemplates();
  try {
    // keep the seed's own `template.created` row (actor NULL); drop everything else
    await env.DB.prepare("DELETE FROM audit_events WHERE NOT (action = 'template.created' AND actor IS NULL)").run();
  } catch {
    // table missing (red run)
  }
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
  expect(token).toBeTruthy();
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

async function team() {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
  return { admin, gd, ql, nv };
}

async function getSeed(s: RunwaySession): Promise<TemplateDetail> {
  const list = await s.fetch("/templates");
  expect(list.status).toBe(200);
  const body: TemplateList = await list.json();
  const item = body.items.find((t) => t.name === SEED_NAME);
  expect(item).toBeTruthy();
  const res = await s.fetch(`/templates/${item!.id}`);
  expect(res.status).toBe(200);
  return res.json();
}

/** The POST /templates/{id}/versions payload made from an existing version (everything but `id`/`created_*`). */
function versionPayload(v: VersionDetail, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body: v.body,
    fields: v.fields,
    field_rules: v.field_rules,
    default_line_items: v.default_line_items,
    default_clauses: v.default_clauses,
    approval_policy: v.approval_policy,
    ...over,
  };
}

/** A small, valid version: one placeholder with a field that has a real source. */
function tinyVersion(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body: "<p>Xin chào {{ten_khach}}</p>",
    fields: [{ key: "ten_khach", label: "Tên khách", type: "text", required: true, source: "subject:name" }],
    field_rules: [],
    default_line_items: [],
    default_clauses: [],
    approval_policy: { mode: "none" },
    ...over,
  };
}

function postTemplate(s: RunwaySession, name: string, version: Record<string, unknown> = tinyVersion(), headers?: HeadersInit) {
  return s.fetch("/templates", {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "contract", name, subject_type: "customer", version }),
  });
}

function postVersion(s: RunwaySession, id: string, payload: Record<string, unknown>, headers?: HeadersInit) {
  return s.fetch(`/templates/${id}/versions`, { method: "POST", headers, body: JSON.stringify(payload), });
}

async function auditRows(s: RunwaySession, action: string) {
  const res = await s.fetch(`/audit?action=${encodeURIComponent(action)}&limit=50`);
  expect(res.status).toBe(200);
  const body: { items: Array<{ actor: string | null; action: string; target: string | null; metadata: Record<string, unknown>; ip: string | null }> } =
    await res.json();
  return body.items;
}

// SPEC-02 §3.4 — the 16 placeholders of Hop_Dong_Dich_Vu.docx and where each value comes from
const SEED_SOURCES: Record<string, string> = {
  so_hop_dong: "issue:number",
  so_bao_gia: "manual",
  ngay_bao_gia: "manual",
  ngay_hop_dong: "derived:doc_date",
  ten_cua_hang: "subject:name",
  ten_khach: "subject:contact_person",
  chuc_vu_nguoi_ky: "manual",
  sdt: "subject:phone",
  email: "subject:email",
  ten_goi: "price_list:name",
  so_cua_hang: "manual",
  ngay_bat_dau: "manual",
  ngay_ket_thuc: "derived:contract_end",
  giam_gia: "manual",
  tong_tien: "derived:total",
  tong_tien_bang_chu: "derived:total_in_words",
};

describe("SPEC-02 templates (acceptance)", () => {
  beforeEach(async () => {
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("AC-1: after migrate, all three roles see exactly the one seeded template at v1 with its approval policy", async () => {
    const { gd, ql, nv } = await team();
    for (const s of [nv.session, ql.session, gd.session]) {
      const res = await s.fetch("/templates");
      expect(res.status).toBe(200);
      const list: TemplateList = await res.json();
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ name: SEED_NAME, type: "contract", active: true });
      expect(list.items[0]?.current_version.version_no).toBe(1);
      expect(list.items[0]?.required_fields).toContain("chuc_vu_nguoi_ky");
      expect(list.items[0]).not.toHaveProperty("body"); // list has no body (§3.8)
    }

    const t = await getSeed(nv.session);
    expect(t.subject_type).toBe("customer");
    expect(t.version.version_no).toBe(1);
    expect(t.versions.map((v) => v.version_no)).toEqual([1]);
    expect(t.version.approval_policy).toEqual({
      mode: "combined",
      steps: [{ step_no: 1, label: "Quản lý duyệt", permission: "contract:approve" }],
      rules: [
        {
          when: { var: "discount_bps", op: "gt", value: 1000 },
          add_steps: [{ label: "Giám đốc duyệt", permission: "contract:approve", role: "giam_doc" }],
        },
      ],
    });
    const byKey = new Map(t.version.fields.map((f) => [f.key, f]));
    expect(byKey.get("ma_goi")?.options).toEqual(["G3", "G6", "G12"]);
    expect(byKey.get("ngay_bat_dau")?.default).toBe("derived:doc_date");
    expect(byKey.get("giam_gia")?.default).toBe(0);
    expect(t.version.default_line_items).toEqual([]);
    expect(t.version.default_clauses).toEqual([]);
  });

  it("AC-2: seed body v1 — no internal note, 16 placeholders each with the right source, chuc_vu_nguoi_ky manual + required, so_bao_gia/ngay_bao_gia optional + all_or_none, {{#if}} wraps 'Căn cứ'", async () => {
    const { nv } = await team();
    const t = await getSeed(nv.session);
    const body = t.version.body;
    expect(body).not.toContain("Ghi chú nội bộ");
    expect(body).not.toContain("xóa trước khi gửi khách");

    const keys = new Set([...body.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g)].map((m) => m[1]!));
    expect([...keys].sort()).toEqual(Object.keys(SEED_SOURCES).sort());
    expect(keys.size).toBe(16);

    const byKey = new Map(t.version.fields.map((f) => [f.key, f]));
    for (const [key, source] of Object.entries(SEED_SOURCES)) {
      expect(byKey.get(key)?.source, key).toBe(source);
    }
    expect(byKey.get("chuc_vu_nguoi_ky")).toMatchObject({ source: "manual", required: true });
    expect(byKey.get("so_bao_gia")?.required).toBe(false);
    expect(byKey.get("ngay_bao_gia")?.required).toBe(false);
    expect(t.version.field_rules).toContainEqual({ all_or_none: ["so_bao_gia", "ngay_bao_gia"] });
    for (const k of ["ten_khach", "sdt", "email"]) expect(byKey.get(k)?.required, k).toBe(true); // DEC-8
    // ma_goi is used to compute, not printed
    expect(keys.has("ma_goi")).toBe(false);
    expect(byKey.get("ma_goi")).toMatchObject({ type: "choice", required: true, source: "manual" });

    expect(body).toMatch(/\{\{#if so_bao_gia\}\}[^]*Căn cứ báo giá số \{\{so_bao_gia\}\}[^]*\{\{\/if\}\}/);
    expect(body).toContain("CÔNG TY TNHH PHẦN MỀM NHẬT MINH"); // Bên A stays in the body (DEC-4)
  });

  it("AC-3: Giám đốc posts v2 (expected_version_no 1) → 201; v2 becomes current; v1 is byte-for-byte unchanged", async () => {
    const { gd, nv } = await team();
    const seed = await getSeed(gd.session);
    // compare the v1 VERSION object only — the detail's `versions[]` list legitimately gains v2
    const v1Of = async (s: RunwaySession): Promise<string> => {
      const d: TemplateDetail = await (await s.fetch(`/templates/${seed.id}?version_no=1`)).json();
      return JSON.stringify(d.version);
    };
    const v1Before = await v1Of(gd.session);

    const edited = seed.version.body.replace("Hôm nay, ngày", "Hôm nay là ngày");
    expect(edited).not.toBe(seed.version.body);
    const res = await postVersion(gd.session, seed.id, versionPayload(seed.version, { expected_version_no: 1, body: edited, note: "sửa một câu" }));
    expect(res.status).toBe(201);
    const created: TemplateDetail = await res.json();
    expect(created.version.version_no).toBe(2);

    const now: TemplateDetail = await (await nv.session.fetch(`/templates/${seed.id}`)).json();
    expect(now.version.version_no).toBe(2);
    expect(now.version.body).toBe(edited);
    expect(now.versions.map((v) => v.version_no).sort()).toEqual([1, 2]);
    const list: TemplateList = await (await nv.session.fetch("/templates")).json();
    expect(list.items[0]?.current_version.version_no).toBe(2);

    const v1After = await v1Of(nv.session);
    expect(v1After).toBe(v1Before);
    expect((await nv.session.fetch(`/templates/${seed.id}?version_no=9`)).status).toBe(404);
    expect((await nv.session.fetch("/templates/01ARZ3NDEKTSV4RRFFQ69G5FAV")).status).toBe(404);
  });

  it("AC-4: placeholder without a field, required field without a source, unresolvable sources → 422 template-check-failed listing ALL; nothing written", async () => {
    const { gd } = await team();
    const seed = await getSeed(gd.session);
    const auditBefore = (await auditRows(gd.session, "template.version_created")).length;

    const bad = versionPayload(seed.version, {
      expected_version_no: 1,
      body: `${seed.version.body}<p>{{ten_cong_ty}}</p>`,
      fields: [
        ...seed.version.fields,
        { key: "khong_nguon", label: "Không nguồn", type: "text", required: true, source: "" },
        { key: "tu_deal", label: "Từ deal", type: "text", required: false, source: "deal:ten_khach" },
        { key: "zalo", label: "Zalo", type: "text", required: false, source: "subject:zalo" },
      ],
    });
    const res = await postVersion(gd.session, seed.id, bad);
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const p: CheckProblem = await res.json();
    expect(p.type).toMatch(/\/template-check-failed$/);
    expect(p.errors).toContainEqual(expect.objectContaining({ code: "placeholder_without_field", key: "ten_cong_ty" }));
    expect(p.errors).toContainEqual(expect.objectContaining({ code: "required_field_without_source", key: "khong_nguon" }));
    expect(p.errors).toContainEqual(expect.objectContaining({ code: "unresolvable_source", key: "tu_deal", source: "deal:ten_khach" }));
    expect(p.errors).toContainEqual(expect.objectContaining({ code: "unresolvable_source", key: "zalo", source: "subject:zalo" }));
    for (const e of p.errors) expect(e.message.length).toBeGreaterThan(0);

    const after: TemplateDetail = await (await gd.session.fetch(`/templates/${seed.id}`)).json();
    expect(after.versions.map((v) => v.version_no)).toEqual([1]);
    expect((await auditRows(gd.session, "template.version_created")).length).toBe(auditBefore);
  });

  it("AC-4 (input edge cases): unbalanced {{#if}}, malformed {{ Placeholder }}, duplicate field key, choice without options, body empty → 422", async () => {
    const { gd } = await team();
    const seed = await getSeed(gd.session);
    const post = (over: Record<string, unknown>) => postVersion(gd.session, seed.id, tinyVersion({ expected_version_no: 1, ...over }));

    const unbalanced = await post({ body: "<p>{{#if ten_khach}}Xin chào {{ten_khach}}</p>" });
    expect(unbalanced.status).toBe(422);
    const unbalancedBody: CheckProblem = await unbalanced.json();
    expect(unbalancedBody.errors.map((e) => e.code)).toContain("unbalanced_if");

    const malformed = await post({ body: "<p>Xin chào {{ Ten }} {{ten_khach}}</p>" });
    expect(malformed.status).toBe(422);
    const malformedBody: CheckProblem = await malformed.json();
    expect(malformedBody.type).toMatch(/\/template-check-failed$/);

    const field = { key: "ten_khach", label: "Tên khách", type: "text", required: true, source: "subject:name" };
    expect((await post({ fields: [field, field] })).status).toBe(422);
    expect(
      (await post({ fields: [field, { key: "ma", label: "Mã", type: "choice", required: false, source: "manual" }] })).status,
    ).toBe(422);
    expect((await post({ body: "" })).status).toBe(422);

    const after: TemplateDetail = await (await gd.session.fetch(`/templates/${seed.id}`)).json();
    expect(after.versions).toHaveLength(1);
  });

  it("AC-5: internal note → internal_note; <script>/onclick → html_not_allowed; bad approval_policy → policy_invalid; oversize → too_large", async () => {
    const { gd } = await team();
    const seed = await getSeed(gd.session);
    const codes = async (over: Record<string, unknown>): Promise<string[]> => {
      const res = await postVersion(gd.session, seed.id, tinyVersion({ expected_version_no: 1, ...over }));
      expect(res.status).toBe(422);
      const p: CheckProblem = await res.json();
      expect(p.type).toMatch(/\/template-check-failed$/);
      return p.errors.map((e) => e.code);
    };

    expect(await codes({ body: "<p>Ghi chú nội bộ (xóa trước khi gửi khách): giảm >10% cần Giám đốc.</p><p>{{ten_khach}}</p>" })).toContain("internal_note");
    expect(await codes({ body: "<p>{{ten_khach}}</p><script>alert(1)</script>" })).toContain("html_not_allowed");
    expect(await codes({ body: '<p onclick="x()">{{ten_khach}}</p>' })).toContain("html_not_allowed");
    expect(await codes({ body: '<p style="color:red">{{ten_khach}}</p>' })).toContain("html_not_allowed");
    expect(
      await codes({ approval_policy: { mode: "steps", steps: [{ step_no: 1, label: "Duyệt", permission: "contract:teleport" }] } }),
    ).toContain("policy_invalid");
    expect(await codes({ approval_policy: { mode: "steps", steps: [] } })).toContain("policy_invalid");
    expect(await codes({ body: `<p>{{ten_khach}}</p><p>${"a".repeat(65 * 1024)}</p>` })).toContain("too_large");
    const many = Array.from({ length: 61 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: "text", required: false, source: "manual" }));
    expect(await codes({ fields: [{ key: "ten_khach", label: "Tên", type: "text", required: true, source: "subject:name" }, ...many] })).toContain("too_large");

    const after: TemplateDetail = await (await gd.session.fetch(`/templates/${seed.id}`)).json();
    expect(after.versions).toHaveLength(1);
  });

  it("AC-6: two concurrent POSTs with the same expected_version_no → exactly one 201 and one 409 stale; versions 1 and 2 only", async () => {
    const { admin, gd } = await team();
    const other = await invite(admin, "giam_doc", "hai@nhatminh.vn", "Giám đốc hai");
    const seed = await getSeed(gd.session);
    const mk = (marker: string) => versionPayload(seed.version, { expected_version_no: 1, body: seed.version.body.replace("Điều 5", `Điều 5 ${marker}`) });

    const [a, b] = await Promise.all([postVersion(gd.session, seed.id, mk("A")), postVersion(other.session, seed.id, mk("B"))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    const loserBody: { type: string } = await loser.json();
    expect(loserBody.type).toMatch(/\/stale$/);

    const t: TemplateDetail = await (await gd.session.fetch(`/templates/${seed.id}`)).json();
    expect(t.versions.map((v) => v.version_no).sort()).toEqual([1, 2]);
    expect(t.version.version_no).toBe(2);
    const rows = await env.DB.prepare("SELECT version_no FROM template_versions WHERE template_id = ? ORDER BY version_no").bind(seed.id).all<{ version_no: number }>();
    expect(rows.results.map((r) => r.version_no)).toEqual([1, 2]);
    expect(await auditRows(gd.session, "template.version_created")).toHaveLength(1);
  });

  it("AC-7: the same Idempotency-Key twice → identical responses, only one new version", async () => {
    const { gd } = await team();
    const seed = await getSeed(gd.session);
    const key = crypto.randomUUID();
    const payload = versionPayload(seed.version, { expected_version_no: 1, body: seed.version.body.replace("Điều 5", "Điều 5 (lặp)") });
    const r1 = await postVersion(gd.session, seed.id, payload, { "Idempotency-Key": key });
    const r2 = await postVersion(gd.session, seed.id, payload, { "Idempotency-Key": key });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await r2.text()).toBe(await r1.text());
    const t: TemplateDetail = await (await gd.session.fetch(`/templates/${seed.id}`)).json();
    expect(t.versions.map((v) => v.version_no).sort()).toEqual([1, 2]);
    expect(await auditRows(gd.session, "template.version_created")).toHaveLength(1);
  });

  it("AC-8: not logged in → 401; nhan_vien and quan_ly cannot POST (403 + one permission.denied each, template:write, ip); admin GET → 403; nothing changed", async () => {
    for (const path of ["/templates", "/templates/01ARZ3NDEKTSV4RRFFQ69G5FAV"]) {
      const res = await fetcher(`${ORIGIN}${path}`);
      expect(res.status, path).toBe(401);
      expect(await res.text()).not.toContain("items");
    }
    const { admin, gd, ql, nv } = await team();
    const seed = await getSeed(gd.session);
    const ip = { "cf-connecting-ip": "203.0.113.9" };

    for (const who of [nv, ql]) {
      const c = await postTemplate(who.session, `Mẫu của ${who.email}`, tinyVersion(), ip);
      expect(c.status).toBe(403);
      expect(c.headers.get("content-type")).toContain("application/problem+json");
      const v = await postVersion(who.session, seed.id, versionPayload(seed.version, { expected_version_no: 1 }), ip);
      expect(v.status).toBe(403);
      expect(v.headers.get("content-type")).toContain("application/problem+json");
    }
    const denied = await auditRows(gd.session, "permission.denied");
    const mine = denied.filter((e) => e.metadata.permission === "template:write");
    expect(mine).toHaveLength(4);
    for (const who of [nv, ql]) {
      const rows = mine.filter((e) => e.actor === who.userId);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.ip).toBe("203.0.113.9");
    }

    const list: TemplateList = await (await gd.session.fetch("/templates")).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.current_version.version_no).toBe(1);
    expect((await admin.fetch("/templates")).status).toBe(403);
    expect((await admin.fetch(`/templates/${seed.id}`)).status).toBe(403);
  });

  it("AC-9: every successful POST writes exactly one template.created / template.version_created row (no body in metadata); GET /audit shows it", async () => {
    const { gd } = await team();
    const seedRow = await env.DB.prepare("SELECT actor, target FROM audit_events WHERE action = 'template.created' AND actor IS NULL").all<{ actor: string | null; target: string }>();
    expect(seedRow.results).toHaveLength(1); // the migration's own row (DEC-5)
    expect(seedRow.results[0]?.target).toMatch(/^template:/);

    const created = await postTemplate(gd.session, "Mẫu thử nghiệm AC-9");
    expect(created.status).toBe(201);
    const t: TemplateDetail = await created.json();
    const seed = await getSeed(gd.session);
    const v2 = await postVersion(gd.session, seed.id, versionPayload(seed.version, { expected_version_no: 1, body: seed.version.body.replace("Điều 5", "Điều 5 bis") }));
    expect(v2.status).toBe(201);

    const createdRows = (await auditRows(gd.session, "template.created")).filter((e) => e.actor !== null);
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({ actor: gd.userId, target: `template:${t.id}` });
    expect(createdRows[0]?.metadata).toMatchObject({ version_no: 1 });

    const vRows = await auditRows(gd.session, "template.version_created");
    expect(vRows).toHaveLength(1);
    expect(vRows[0]).toMatchObject({ actor: gd.userId, target: `template:${seed.id}` });
    expect(vRows[0]?.metadata).toMatchObject({ version_no: 2 });
    const raw = JSON.stringify([...createdRows, ...vRows]);
    expect(raw).not.toContain("Điều 5");
    expect(raw).not.toContain("CÔNG TY TNHH");
    expect(raw).not.toContain("Xin chào");
  });

  it("AC-10: no PATCH/PUT/DELETE on /templates/** in the OpenAPI; a direct UPDATE/DELETE on template_versions is refused by the trigger", async () => {
    const res = await fetcher(`${ORIGIN}/openapi.json`);
    expect(res.status).toBe(200);
    const doc: { paths: Record<string, Record<string, unknown>> } = await res.json();
    const tpl = Object.entries(doc.paths).filter(([p]) => p === "/templates" || p.startsWith("/templates/"));
    expect(tpl.length).toBeGreaterThanOrEqual(3); // /templates, /templates/{id}, /templates/{id}/versions
    for (const [p, ops] of tpl) {
      for (const verb of ["patch", "put", "delete"]) expect(ops[verb], `${verb} ${p}`).toBeUndefined();
    }

    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM template_versions").first<{ n: number }>();
    await expect(env.DB.prepare("UPDATE template_versions SET body = 'x'").run()).rejects.toThrow();
    await expect(env.DB.prepare("DELETE FROM template_versions").run()).rejects.toThrow();
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM template_versions").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
    expect(after?.n).toBeGreaterThanOrEqual(1);
  });

  it("AC-11: POST /templates with a small valid version → 201 at v1; the same name again (case/space-insensitive) → 409 duplicate + existing_id", async () => {
    const { gd, nv } = await team();
    const res = await postTemplate(gd.session, "Phiếu đề nghị thanh toán");
    expect(res.status).toBe(201);
    const t: TemplateDetail = await res.json();
    expect(t.version.version_no).toBe(1);
    expect(t).toMatchObject({ name: "Phiếu đề nghị thanh toán", type: "contract", subject_type: "customer" });
    expect(t.versions).toHaveLength(1);

    const dup = await postTemplate(gd.session, "  PHIẾU ĐỀ NGHỊ THANH TOÁN ");
    expect(dup.status).toBe(409);
    const d: { type: string; existing_id: string } = await dup.json();
    expect(d.type).toMatch(/\/duplicate$/);
    expect(d.existing_id).toBe(t.id);

    const dupSeed = await postTemplate(gd.session, SEED_NAME);
    expect(dupSeed.status).toBe(409);

    const list: TemplateList = await (await nv.session.fetch("/templates")).json();
    expect(list.items.map((i) => i.name).sort()).toEqual([SEED_NAME, "Phiếu đề nghị thanh toán"].sort());
    // wrong shape → 422 validation (not template-check-failed)
    const shape = await gd.session.fetch("/templates", { method: "POST", body: JSON.stringify({ type: "contract", name: "X" }) });
    expect(shape.status).toBe(422);
    const shapeBody: { type: string } = await shape.json();
    expect(shapeBody.type).toMatch(/\/validation$/);
  });
});
