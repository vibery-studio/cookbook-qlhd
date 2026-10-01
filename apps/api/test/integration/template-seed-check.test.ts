/**
 * C-02-003: the migration-seeded template passes the same checkTemplate used at write time (SPEC-02 §3.4/§3.5, AC-1/AC-2/AC-9).
 * C-08-005: the current seed version is v2 (migration 0023, SPEC-08 DEC-8); v1 stays stored as seeded.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { checkTemplate, type FieldDef, type FieldRule } from "../../src/domain/template-check";

const NAME = "Hợp đồng cung cấp dịch vụ phần mềm";

interface SeedRow {
  id: string;
  current_version_id: string | null;
  body: string;
  fields: string;
  field_rules: string;
  approval_policy: string;
  default_line_items: string;
  default_clauses: string;
}

async function readSeed(): Promise<SeedRow> {
  const row = await env.DB.prepare(
    `SELECT t.id, t.current_version_id, v.body, v.fields, v.field_rules, v.approval_policy, v.default_line_items, v.default_clauses
       FROM templates t JOIN template_versions v ON v.id = t.current_version_id
      WHERE t.name = ?`,
  )
    .bind(NAME)
    .first<SeedRow>();
  if (!row) throw new Error("seed template missing");
  return row;
}

describe("seeded template (current = v2)", () => {
  it("v2 passes checkTemplate, 20 fields = 20 placeholders, bang_hang is the lines table; v2 + audit row with NULL actor", async () => {
    const seed = await readSeed();
    const fields = JSON.parse(seed.fields) as FieldDef[];
    const input = {
      body: seed.body,
      fields,
      field_rules: JSON.parse(seed.field_rules) as FieldRule[],
      approval_policy: JSON.parse(seed.approval_policy) as unknown,
    };
    expect(checkTemplate(input)).toEqual([]);
    expect(fields).toHaveLength(20);
    const placeholders = new Set([...seed.body.matchAll(/\{\{(?:#if )?([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]));
    expect(placeholders.size).toBe(20);
    expect(fields.find((f) => f.key === "bang_hang")).toMatchObject({ type: "lines", source: "derived:lines_table", required: true });
    for (const gone of ["ma_goi", "so_cua_hang", "tong_tien", "tong_tien_bang_chu"]) expect(fields.map((f) => f.key), gone).not.toContain(gone);
    expect(JSON.parse(seed.default_line_items)).toEqual([]);
    expect(JSON.parse(seed.default_clauses)).toEqual([]);

    const ver = await env.DB.prepare(`SELECT version_no, created_by FROM template_versions WHERE id = ?`)
      .bind(seed.current_version_id)
      .first<{ version_no: number; created_by: string | null }>();
    expect(ver).toEqual({ version_no: 2, created_by: null });

    const created = await env.DB.prepare(`SELECT actor, metadata FROM audit_events WHERE action = 'template.created' AND target = ?`)
      .bind(`template:${seed.id}`)
      .all<{ actor: string | null; metadata: string }>();
    expect(created.results).toHaveLength(1);
    expect(created.results[0]!.actor).toBeNull();
    expect(JSON.parse(created.results[0]!.metadata)).toEqual({ version_no: 1, fields: 17 });

    const v2 = await env.DB.prepare(`SELECT actor, metadata FROM audit_events WHERE action = 'template.version_created' AND target = ?`)
      .bind(`template:${seed.id}`)
      .all<{ actor: string | null; metadata: string }>();
    expect(v2.results).toHaveLength(1);
    expect(v2.results[0]!.actor).toBeNull();
    expect(JSON.parse(v2.results[0]!.metadata)).toEqual({ version_no: 2, fields: 20 });
  });

  it("v1 is kept as seeded (17 fields, ma_goi, 'đã gồm VAT')", async () => {
    const seed = await readSeed();
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

  it("a copy with the internal note appended fails with internal_note (drift guard)", async () => {
    const seed = await readSeed();
    const errors = checkTemplate({
      body: `${seed.body}\n<p>Ghi chú nội bộ: xóa trước khi gửi khách.</p>`,
      fields: JSON.parse(seed.fields) as FieldDef[],
      field_rules: JSON.parse(seed.field_rules) as FieldRule[],
      approval_policy: JSON.parse(seed.approval_policy) as unknown,
    });
    expect(errors.map((e) => e.code)).toContain("internal_note");
  });
});
