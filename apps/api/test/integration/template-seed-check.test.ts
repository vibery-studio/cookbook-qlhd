/**
 * C-02-003: the migration-seeded templates pass the same checkTemplate used at write time (SPEC-02 §3.4/§3.5, AC-1/AC-2/AC-9).
 * C-08-005: contract template v2 (migration 0023, SPEC-08 DEC-8); v1 stays stored as seeded.
 * C-09-005: migration 0026 — contract v3 (so_bao_gia/ngay_bao_gia from the parent quote) + one v1 template per new type
 * (quote, payment_request, delivery_note DEMO 02-VT), every current version passes checkTemplate, policy = v2's (DEC-9 A).
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { checkTemplate, type FieldDef, type FieldRule } from "../../src/domain/template-check";

const CONTRACT = "Hợp đồng cung cấp dịch vụ phần mềm";
const POLICY = {
  mode: "combined",
  steps: [{ step_no: 1, label: "Quản lý duyệt", permission: "contract:approve" }],
  rules: [
    {
      when: { var: "discount_bps", op: "gt", value: 1000 },
      add_steps: [{ label: "Giám đốc duyệt", permission: "contract:approve", role: "giam_doc" }],
    },
  ],
};

interface SeedRow {
  id: string;
  type: string;
  name: string;
  current_version_id: string | null;
  version_no: number;
  created_by: string | null;
  body: string;
  fields: string;
  field_rules: string;
  approval_policy: string;
  default_line_items: string;
  default_clauses: string;
}

async function seeds(): Promise<SeedRow[]> {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.type, t.name, t.current_version_id, v.version_no, v.created_by, v.body, v.fields, v.field_rules, v.approval_policy,
            v.default_line_items, v.default_clauses
       FROM templates t JOIN template_versions v ON v.id = t.current_version_id
      WHERE t.created_by IS NULL
      ORDER BY t.type`,
  ).all<SeedRow>();
  return rows.results;
}

async function seedOf(type: string): Promise<SeedRow> {
  const row = (await seeds()).find((r) => r.type === type);
  if (!row) throw new Error(`seed template of type ${type} missing`);
  return row;
}

function checkInput(seed: SeedRow) {
  return {
    body: seed.body,
    fields: JSON.parse(seed.fields) as FieldDef[],
    field_rules: JSON.parse(seed.field_rules) as FieldRule[],
    approval_policy: JSON.parse(seed.approval_policy) as unknown,
  };
}

function placeholders(body: string): Set<string> {
  return new Set([...body.matchAll(/\{\{(?:#if )?([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]!));
}

function byKey(seed: SeedRow): Map<string, FieldDef> {
  return new Map((JSON.parse(seed.fields) as FieldDef[]).map((f) => [f.key, f]));
}

async function auditOf(action: string, templateId: string) {
  const rows = await env.DB.prepare(`SELECT actor, metadata FROM audit_events WHERE action = ? AND target = ? ORDER BY ts, id`)
    .bind(action, `template:${templateId}`)
    .all<{ actor: string | null; metadata: string }>();
  return rows.results.map((r) => ({ actor: r.actor, metadata: JSON.parse(r.metadata) as unknown }));
}

describe("seeded templates (contract v3 + quote, payment_request, delivery_note v1)", () => {
  it("exactly one system template per type; every current version passes checkTemplate, placeholders = fields, policy = v2's, created_by NULL", async () => {
    const rows = await seeds();
    expect(rows.map((r) => r.type)).toEqual(["contract", "delivery_note", "payment_request", "quote"]);
    const expected: Record<string, { version_no: number; fields: number }> = {
      contract: { version_no: 3, fields: 20 },
      quote: { version_no: 1, fields: 16 },
      payment_request: { version_no: 1, fields: 15 },
      delivery_note: { version_no: 1, fields: 9 },
    };
    for (const seed of rows) {
      expect(checkTemplate(checkInput(seed)), seed.type).toEqual([]);
      const fields = JSON.parse(seed.fields) as FieldDef[];
      expect(fields, seed.type).toHaveLength(expected[seed.type]!.fields);
      expect([...placeholders(seed.body)].sort(), seed.type).toEqual(fields.map((f) => f.key).sort());
      expect({ version_no: seed.version_no, created_by: seed.created_by }, seed.type).toEqual({ version_no: expected[seed.type]!.version_no, created_by: null });
      expect(JSON.parse(seed.approval_policy), seed.type).toEqual(POLICY);
      expect(JSON.parse(seed.default_line_items)).toEqual([]);
      expect(JSON.parse(seed.default_clauses)).toEqual([]);
      expect(fields.filter((f) => f.source === "issue:number"), seed.type).toHaveLength(1);
    }
  });

  it("contract v3 = v2 except so_bao_gia/ngay_bao_gia from the parent (optional, no all_or_none); v1/v2 kept; one version_created {3,20} actor NULL", async () => {
    const seed = await seedOf("contract");
    expect(seed.name).toBe(CONTRACT);
    const v2 = await env.DB.prepare(`SELECT body, fields, approval_policy FROM template_versions WHERE template_id = ? AND version_no = 2`)
      .bind(seed.id)
      .first<{ body: string; fields: string; approval_policy: string }>();
    expect(v2).not.toBeNull();
    expect(seed.body).toBe(v2!.body);
    expect(seed.approval_policy).toBe(v2!.approval_policy);
    const f2 = JSON.parse(v2!.fields) as FieldDef[];
    const f3 = JSON.parse(seed.fields) as FieldDef[];
    expect(f3.map((f) => f.key)).toEqual(f2.map((f) => f.key));
    const changed = f3.filter((f, i) => JSON.stringify(f) !== JSON.stringify(f2[i]));
    expect(changed).toEqual([
      { key: "so_bao_gia", label: "Số báo giá", type: "text", required: false, source: "parent:number" },
      { key: "ngay_bao_gia", label: "Ngày báo giá", type: "date", required: false, source: "parent:doc_date" },
    ]);
    expect(JSON.parse(seed.field_rules)).toEqual([]);
    expect(seed.body).toMatch(/\{\{#if so_bao_gia\}\}[^]*Căn cứ báo giá số \{\{so_bao_gia\}\}[^]*\{\{\/if\}\}/);
    expect(byKey(seed).get("bang_hang")).toMatchObject({ type: "lines", source: "derived:lines_table", required: true });

    const versions = await env.DB.prepare(`SELECT version_no, created_by FROM template_versions WHERE template_id = ? ORDER BY version_no`)
      .bind(seed.id)
      .all<{ version_no: number; created_by: string | null }>();
    expect(versions.results).toEqual([
      { version_no: 1, created_by: null },
      { version_no: 2, created_by: null },
      { version_no: 3, created_by: null },
    ]);
    expect(await auditOf("template.created", seed.id)).toEqual([{ actor: null, metadata: { version_no: 1, fields: 17 } }]);
    expect(await auditOf("template.version_created", seed.id)).toEqual([
      { actor: null, metadata: { version_no: 2, fields: 20 } },
      { actor: null, metadata: { version_no: 3, fields: 20 } },
    ]);
  });

  it("v1 is kept as seeded (17 fields, ma_goi, 'đã gồm VAT')", async () => {
    const seed = await seedOf("contract");
    const v1 = await env.DB.prepare(`SELECT body, fields, created_by FROM template_versions WHERE template_id = ? AND version_no = 1`)
      .bind(seed.id)
      .first<{ body: string; fields: string; created_by: string | null }>();
    expect(v1).not.toBeNull();
    expect(v1!.created_by).toBeNull();
    expect(v1!.body).toContain("đã gồm VAT");
    const fields = JSON.parse(v1!.fields) as FieldDef[];
    expect(fields).toHaveLength(17);
    expect(fields.map((f) => f.key)).toContain("ma_goi");
  });

  it("quote v1: box wording, SPEC-08 money block (no 'đã gồm VAT'), valid 15 days via derived:valid_until, creator:name; giam_gia the only manual field", async () => {
    const seed = await seedOf("quote");
    const f = byKey(seed);
    for (const text of ["CÔNG TY TNHH PHẦN MỀM NHẬT MINH", "028 3997 2468", "kinhdoanh@nhatminh.vn", "BÁO GIÁ", "Kính gửi:", "Báo giá có hiệu lực 15 ngày, đến hết ngày {{hieu_luc_den}}.", "Nhân viên phụ trách: {{nhan_vien}}"]) {
      expect(seed.body, text).toContain(text);
    }
    expect(seed.body).not.toContain("đã gồm VAT");
    expect(f.get("so_bao_gia")).toMatchObject({ source: "issue:number" });
    expect(f.get("hieu_luc_den")).toMatchObject({ type: "date", source: "derived:valid_until" });
    expect(f.get("nhan_vien")).toMatchObject({ source: "creator:name" });
    expect(f.get("bang_hang")).toMatchObject({ type: "lines", source: "derived:lines_table" });
    expect([...f.values()].filter((x) => x.source === "manual").map((x) => x.key)).toEqual(["giam_gia"]);
    expect(f.get("giam_gia")).toMatchObject({ type: "percent", default: 0 });
    expect(await auditOf("template.created", seed.id)).toEqual([{ actor: null, metadata: { version_no: 1, fields: 16 } }]);
  });

  it("payment_request v1: 'Căn cứ hợp đồng số' from the parent, amount requested + words, due date, box bank account in the body, 'NM {{so_de_nghi}}'; no manual field", async () => {
    const seed = await seedOf("payment_request");
    const f = byKey(seed);
    for (const text of [
      "ĐỀ NGHỊ THANH TOÁN",
      "Căn cứ hợp đồng số {{so_hop_dong}} ngày {{ngay_hop_dong}}",
      "Tài khoản: 0071 0004 58213 · Vietcombank · Chủ tài khoản: CÔNG TY TNHH PHẦN MỀM NHẬT MINH",
      "Nội dung chuyển khoản: NM {{so_de_nghi}}",
      "Hạn thanh toán: {{han_thanh_toan}}",
    ]) {
      expect(seed.body, text).toContain(text);
    }
    expect(f.get("so_de_nghi")).toMatchObject({ source: "issue:number" });
    expect(f.get("so_hop_dong")).toMatchObject({ source: "parent:number" });
    expect(f.get("ngay_hop_dong")).toMatchObject({ type: "date", source: "parent:doc_date" });
    expect(f.get("so_tien_de_nghi")).toMatchObject({ type: "money", source: "derived:amount_requested" });
    expect(f.get("so_tien_de_nghi_bang_chu")).toMatchObject({ source: "derived:amount_requested_in_words" });
    expect(f.get("han_thanh_toan")).toMatchObject({ type: "date", source: "derived:payment_due" });
    expect([...f.values()].filter((x) => x.source === "manual")).toEqual([]);
    expect(await auditOf("template.created", seed.id)).toEqual([{ actor: null, metadata: { version_no: 1, fields: 15 } }]);
  });

  it("delivery_note v1 (DEMO 02-VT): layout labels, goods table, ly_do_xuat_kho manual + required, no giam_gia, 5 signatures", async () => {
    const seed = await seedOf("delivery_note");
    const f = byKey(seed);
    for (const text of [
      "Đơn vị: <strong>CÔNG TY TNHH PHẦN MỀM NHẬT MINH</strong>",
      "Bộ phận: …… (DEMO)",
      "Mẫu số 02 - VT",
      "(Kèm theo Thông tư 99/2025/TT-BTC) (DEMO)",
      "PHIẾU XUẤT KHO",
      "Nợ: …… · Có: ……",
      "Họ và tên người nhận hàng: {{nguoi_nhan}}",
      "Địa chỉ (bộ phận):",
      "Lý do xuất kho: {{ly_do_xuat_kho}}",
      "Xuất tại kho (ngăn lô): {{xuat_tai_kho}}",
      "Địa điểm: {{dia_diem}}",
      "Tổng số tiền (viết bằng chữ): ……",
      "Số chứng từ gốc kèm theo: ……",
      "Người lập phiếu",
      "Người nhận hàng",
      "Thủ kho",
      "Kế toán trưởng (hoặc bộ phận có nhu cầu nhập)",
      "Giám đốc",
    ]) {
      expect(seed.body, text).toContain(text);
    }
    expect(f.get("bang_hang_xuat")).toMatchObject({ type: "goods", source: "derived:goods_table", required: true });
    expect(f.get("nguoi_nhan")).toMatchObject({ source: "subject:contact_person" });
    expect(f.get("ly_do_xuat_kho")).toMatchObject({ source: "manual", required: true });
    expect(f.get("xuat_tai_kho")).toMatchObject({ source: "manual", required: false });
    expect(f.get("dia_diem")).toMatchObject({ source: "manual", required: false });
    expect(f.has("giam_gia")).toBe(false);
    expect([...f.values()].some((x) => x.type === "lines")).toBe(false);
    expect(await auditOf("template.created", seed.id)).toEqual([{ actor: null, metadata: { version_no: 1, fields: 9 } }]);
  });

  it("a copy with the internal note appended fails with internal_note (drift guard)", async () => {
    const seed = await seedOf("contract");
    const errors = checkTemplate({ ...checkInput(seed), body: `${seed.body}\n<p>Ghi chú nội bộ: xóa trước khi gửi khách.</p>` });
    expect(errors.map((e) => e.code)).toContain("internal_note");
  });
});
