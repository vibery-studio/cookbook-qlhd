import { describe, expect, it } from "vitest";
import { checkTemplate, type FieldDef, type TemplateCheckInput } from "../../src/domain/template-check";
import { isResolvableSource } from "../../src/domain/template-sources";

const SEED_POLICY = {
  mode: "combined",
  steps: [{ step_no: 1, label: "Quản lý duyệt", permission: "contract:approve" }],
  rules: [
    {
      when: { var: "discount_bps", op: "gt", value: 1000 },
      add_steps: [{ label: "Giám đốc duyệt", permission: "contract:approve", role: "giam_doc" }],
    },
  ],
};

const f = (key: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label: key,
  type: "text",
  required: false,
  source: "manual",
  ...extra,
});

function make(over: Partial<TemplateCheckInput> = {}): TemplateCheckInput {
  return {
    body: "<p>Khách: {{ten}}</p>",
    fields: [f("ten", { required: true, source: "subject:name" })],
    approval_policy: { mode: "none" },
    ...over,
  };
}

const codes = (i: TemplateCheckInput) => checkTemplate(i).map((e) => e.code);

describe("checkTemplate", () => {
  it("a full valid tiny template returns []", () => {
    const input = make({
      body: "<h1 class=\"center b\">HỢP ĐỒNG</h1><p>{{ten}}</p>{{#if so_bao_gia}}<p>Báo giá {{so_bao_gia}} ngày {{ngay_bao_gia}}</p>{{/if}}<table><tr><td>a</td><th>b</th></tr></table><br/>",
      fields: [
        f("ten", { required: true, source: "subject:name" }),
        f("so_bao_gia"),
        f("ngay_bao_gia", { type: "date" }),
        f("so", { required: false, source: "issue:number" }),
      ],
      field_rules: [{ all_or_none: ["so_bao_gia", "ngay_bao_gia"] }],
      approval_policy: SEED_POLICY,
    });
    expect(checkTemplate(input)).toEqual([]);
  });

  it("the seed policy passes; modes none/steps/threshold pass", () => {
    expect(codes(make({ approval_policy: SEED_POLICY }))).toEqual([]);
    expect(codes(make({ approval_policy: { mode: "steps", steps: [{ label: "x", permission: "contract:approve" }] } }))).toEqual([]);
    expect(
      codes(make({ approval_policy: { mode: "threshold", rules: SEED_POLICY.rules } })),
    ).toEqual([]);
  });

  it("placeholder without field, malformed placeholder, unknown #if key", () => {
    const e = checkTemplate(make({ body: "<p>{{ten_cong_ty}} {{ Ten }} {{Ten}} {{#if khong_co}}x{{/if}}</p>" }));
    const keys = e.filter((x) => x.code === "placeholder_without_field").map((x) => x.key);
    expect(keys).toEqual(["ten_cong_ty", "{{ Ten }}", "{{Ten}}", "khong_co"]);
    expect(e.every((x) => x.message.length > 0)).toBe(true);
  });

  it("if balance: unclosed, extra close, nested balanced ok", () => {
    expect(codes(make({ body: "{{#if ten}}<p>x</p>" }))).toEqual(["unbalanced_if"]);
    expect(codes(make({ body: "<p>x</p>{{/if}}" }))).toEqual(["unbalanced_if"]);
    expect(codes(make({ body: "{{#if ten}}{{#if ten}}x{{/if}}{{/if}}" }))).toEqual([]);
    expect(codes(make({ body: "{{#if}}x{{/if}}" }))).toContain("placeholder_without_field");
  });

  it("required field without source; empty string counts as none; optional without source ok", () => {
    const e = checkTemplate(
      make({
        body: "<p>x</p>",
        fields: [f("a", { required: true, source: undefined }), f("b", { required: true, source: "" }), f("c", { source: null })],
      }),
    );
    expect(e.map((x) => [x.code, x.key])).toEqual([
      ["required_field_without_source", "a"],
      ["required_field_without_source", "b"],
    ]);
  });

  it("unresolvable sources report the source", () => {
    const e = checkTemplate(
      make({ body: "<p>x</p>", fields: [f("a", { source: "deal:ten_khach" }), f("b", { source: "subject:zalo" }), f("c", { source: "derived" }), f("d", { source: "manual:x" })] }),
    );
    expect(e.map((x) => [x.code, x.key, x.source])).toEqual([
      ["unresolvable_source", "a", "deal:ten_khach"],
      ["unresolvable_source", "b", "subject:zalo"],
      ["unresolvable_source", "c", "derived"],
      ["unresolvable_source", "d", "manual:x"],
    ]);
  });

  it("source registry accepts every documented source", () => {
    for (const s of [
      "manual",
      "subject:tax_code",
      "derived:total_in_words",
      "issue:number",
      "derived:discount_bps",
      "derived:subtotal_ex_vat",
      "derived:discount_amount",
      "derived:total_ex_vat",
      "derived:vat_total",
      "derived:vat_rates",
      "derived:service_name",
      "derived:lines_table",
    ]) {
      expect(isResolvableSource(s), s).toBe(true);
    }
    // SPEC-08 DEC-8/9: the price list is no longer a source
    for (const s of ["price_list:unit_price", "price_list:name", "price_list:code"]) expect(isResolvableSource(s), s).toBe(false);
    expect(isResolvableSource("__proto__:x")).toBe(false);
    expect(isResolvableSource("constructor:name")).toBe(false);
    expect(isResolvableSource(undefined)).toBe(false);
  });

  it("a `lines` field ⇔ source derived:lines_table (PLAN-08 R-5); price_list:* refused", () => {
    const body = "<p>{{bang}}</p>";
    expect(codes(make({ body, fields: [f("bang", { type: "lines", required: true, source: "derived:lines_table" })] }))).toEqual([]);
    const e = checkTemplate(
      make({
        body: "<p>{{a}} {{b}} {{c}}</p>",
        fields: [
          f("a", { type: "lines", source: "manual" }),
          f("b", { type: "text", source: "derived:lines_table" }),
          f("c", { source: "price_list:unit_price" }),
        ],
      }),
    );
    expect(e.map((x) => [x.code, x.key, x.source])).toEqual([
      ["unresolvable_source", "a", "manual"],
      ["unresolvable_source", "b", "derived:lines_table"],
      ["unresolvable_source", "c", "price_list:unit_price"],
    ]);
  });

  it("SPEC-09 §3.3: the new document sources resolve; unknown parent/creator refs do not", () => {
    for (const s of [
      "parent:number",
      "parent:doc_date",
      "derived:valid_until",
      "derived:payment_due",
      "derived:amount_requested",
      "derived:amount_requested_in_words",
      "creator:name",
      "derived:goods_table",
    ]) {
      expect(isResolvableSource(s), s).toBe(true);
    }
    for (const s of ["parent:total", "parent:id", "creator:email", "derived:goods"]) expect(isResolvableSource(s), s).toBe(false);
  });

  it("a `goods` field ⇔ source derived:goods_table (02-VT trusted channel, like `lines`)", () => {
    const ok = make({
      body: "<p>{{so}} {{ngay}} {{nguoi}} {{han}}</p>{{bang}}",
      fields: [
        f("bang", { type: "goods", required: true, source: "derived:goods_table" }),
        f("so", { source: "parent:number" }),
        f("ngay", { type: "date", source: "parent:doc_date" }),
        f("nguoi", { source: "creator:name" }),
        f("han", { type: "date", source: "derived:payment_due" }),
      ],
    });
    expect(codes(ok)).toEqual([]);
    const e = checkTemplate(
      make({
        body: "<p>{{a}} {{b}} {{c}} {{d}}</p>",
        fields: [
          f("a", { type: "goods", source: "derived:lines_table" }),
          f("b", { type: "goods", source: "manual" }),
          f("c", { type: "text", source: "derived:goods_table" }),
          f("d", { type: "lines", source: "derived:goods_table" }),
        ],
      }),
    );
    expect(e.map((x) => [x.code, x.key, x.source])).toEqual([
      ["unresolvable_source", "a", "derived:lines_table"],
      ["unresolvable_source", "b", "manual"],
      ["unresolvable_source", "c", "derived:goods_table"],
      ["unresolvable_source", "d", "derived:goods_table"],
    ]);
  });

  it("html attack list is refused (case-insensitive, fail-closed)", () => {
    const attacks = [
      "<SCRIPT>alert(1)</SCRIPT>",
      "<p onClick=\"x()\">a</p>",
      "<p ONCLICK=x>a</p>",
      "<img src=x onerror=alert(1)>",
      "<a href=\"javascript:alert(1)\">a</a>",
      "<p>javascript:alert(1)</p>",
      "<style>p{}</style>",
      "<p style=\"color:red\">a</p>",
      "<!-- c --><p>a</p>",
      "<!DOCTYPE html>",
      "<P>upper</P><Iframe></Iframe>",
      "<p>abc <b",
      "<p class=\"evil\">a</p>",
      "<p class=\"center\" id=\"x\">a</p>",
      "<a href=\"https://x\">a</a>",
      "<span src=\"x\">a</span>",
    ];
    for (const body of attacks) {
      expect(codes(make({ body })), body).toContain("html_not_allowed");
    }
  });

  it("html allowlist: uppercase allowed tags and class values pass", () => {
    expect(codes(make({ body: "<P CLASS=\"center\">a</P>".replace("CLASS", "class") }))).toEqual([]);
    expect(codes(make({ body: "<DIV class=\"sig right\"><SPAN>a</SPAN></DIV><ul><li>a</li></ul><ol><li>b</li></ol>" }))).toEqual([]);
  });

  it("internal note: diacritic- and case-insensitive", () => {
    for (const body of ["<p>Ghi chú nội bộ (xóa trước khi gửi khách): x</p>", "<p>GHI CHU NOI BO</p>", "<p>Xoá trước khi gửi khách</p>"]) {
      expect(codes(make({ body })), body).toContain("internal_note");
    }
  });

  it("policy: unknown permission, empty steps, unknown var/op/role, 11 steps", () => {
    const p = (approval_policy: unknown) => codes(make({ approval_policy }));
    expect(p({ mode: "steps", steps: [{ label: "x", permission: "contract:khong_co" }] })).toEqual(["policy_invalid"]);
    expect(p({ mode: "steps", steps: [] })).toEqual(["policy_invalid"]);
    expect(p({ mode: "combined", steps: [{ label: "x", permission: "contract:approve" }] })).toEqual(["policy_invalid"]);
    expect(p({ mode: "wat" })).toEqual(["policy_invalid"]);
    expect(p(null)).toEqual(["policy_invalid"]);
    const rule = (when: object, step: object = { label: "g", permission: "contract:approve" }) => ({
      mode: "threshold",
      rules: [{ when, add_steps: [step] }],
    });
    expect(p(rule({ var: "vat", op: "gt", value: 1 }))).toEqual(["policy_invalid"]);
    expect(p(rule({ var: "total", op: "neq", value: 1 }))).toEqual(["policy_invalid"]);
    expect(p(rule({ var: "total", op: "gt", value: "1" }))).toEqual(["policy_invalid"]);
    expect(p(rule({ var: "total", op: "gte", value: 1 }, { label: "g", permission: "contract:approve", role: "ceo" }))).toEqual(["policy_invalid"]);
    const step = { label: "x", permission: "contract:approve" };
    expect(p({ mode: "steps", steps: Array(10).fill(step) })).toEqual([]);
    expect(p({ mode: "steps", steps: Array(11).fill(step) })).toEqual(["too_large"]);
    expect(p({ mode: "combined", steps: Array(10).fill(step), rules: SEED_POLICY.rules })).toEqual(["too_large"]);
  });

  it("all_or_none keys must be declared fields", () => {
    const e = checkTemplate(make({ field_rules: [{ all_or_none: ["ten", "khong_co"] }] }));
    expect(e.map((x) => [x.code, x.key])).toEqual([["all_or_none_invalid", "khong_co"]]);
    expect(codes(make({ field_rules: [{ all_or_none: ["ten"] }] }))).toEqual(["all_or_none_invalid"]);
  });

  it("body limit is 64 KB in BYTES", () => {
    const pad = (n: number) => `<p>${"a".repeat(n - 7)}</p>`;
    expect(codes(make({ body: pad(64 * 1024) }))).toEqual([]);
    expect(codes(make({ body: pad(65 * 1024) }))).toEqual(["too_large"]);
    expect(codes(make({ body: pad(64 * 1024 + 1) }))).toEqual(["too_large"]);
    // 2-byte chars: 20000 chars = 40 KB ok, 40000 chars = 80 KB too large although < 64K characters
    expect(codes(make({ body: `<p>${"ệ".repeat(20000)}</p>` }))).toEqual([]);
    const big = `<p>${"ệ".repeat(30000)}</p>`;
    expect(big.length).toBeLessThan(64 * 1024);
    expect(codes(make({ body: big }))).toEqual(["too_large"]);
  });

  it("fields limit is 60", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => f(`k${i}`));
    expect(codes(make({ body: "<p>x</p>", fields: many(60) }))).toEqual([]);
    expect(codes(make({ body: "<p>x</p>", fields: many(61) }))).toEqual(["too_large"]);
  });

  it("many errors come back in one call, deterministic, never throws", () => {
    const input: TemplateCheckInput = {
      body: "<script>x</script><p onclick=\"a\">Ghi chú nội bộ {{khong_co}}</p>{{#if ten}}",
      fields: [f("ten", { required: true, source: undefined }), f("z", { source: "deal:x" })],
      field_rules: [{ all_or_none: ["ten", "nope"] }],
      approval_policy: { mode: "steps", steps: [] },
    };
    const a = checkTemplate(input).map((e) => e.code);
    expect(a).toEqual([
      "html_not_allowed",
      "html_not_allowed",
      "internal_note",
      "placeholder_without_field",
      "unbalanced_if",
      "required_field_without_source",
      "unresolvable_source",
      "all_or_none_invalid",
      "policy_invalid",
    ]);
    expect(checkTemplate(input).map((e) => e.code)).toEqual(a);
    expect(() => checkTemplate({ body: 5, fields: null, approval_policy: undefined } as never)).not.toThrow();
  });
});
