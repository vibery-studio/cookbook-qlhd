/**
 * C-02-003: the migration-seeded template passes the same checkTemplate used at write time (SPEC-02 §3.4/§3.5, AC-1/AC-2/AC-9).
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

describe("seeded template v1", () => {
  it("passes checkTemplate, 17 fields (16 placeholders + ma_goi), version 1, audit row with NULL actor", async () => {
    const seed = await readSeed();
    const fields = JSON.parse(seed.fields) as FieldDef[];
    const input = {
      body: seed.body,
      fields,
      field_rules: JSON.parse(seed.field_rules) as FieldRule[],
      approval_policy: JSON.parse(seed.approval_policy) as unknown,
    };
    expect(checkTemplate(input)).toEqual([]);
    expect(fields).toHaveLength(17);
    const placeholders = new Set([...seed.body.matchAll(/\{\{(?:#if )?([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]));
    expect(placeholders.size).toBe(16);
    expect(fields.map((f) => f.key)).toContain("ma_goi");
    expect(JSON.parse(seed.default_line_items)).toEqual([]);
    expect(JSON.parse(seed.default_clauses)).toEqual([]);

    const ver = await env.DB.prepare(`SELECT version_no, created_by FROM template_versions WHERE id = ?`)
      .bind(seed.current_version_id)
      .first<{ version_no: number; created_by: string | null }>();
    expect(ver).toEqual({ version_no: 1, created_by: null });

    const audit = await env.DB.prepare(`SELECT actor, metadata FROM audit_events WHERE action = 'template.created' AND target = ?`)
      .bind(`template:${seed.id}`)
      .all<{ actor: string | null; metadata: string }>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]!.actor).toBeNull();
    expect(JSON.parse(audit.results[0]!.metadata)).toEqual({ version_no: 1, fields: 17 });
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
