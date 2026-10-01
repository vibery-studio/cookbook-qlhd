import { describe, expect, it } from "vitest";
import { lockReason, visibleActions, type LockContext } from "./lock-reasons";
import { buildValues, buildLines, rowsFromInputs, previewBody, bpsToPercentText, emptyForm, formFromInputs, activeKeys, productsFor, VALUE_LABELS, type FieldSpec } from "./values";
import { buildFlow } from "./flow";
import { parseListParams, TYPE_TABS, typeEmptyTitle, createLabel, creatableTypes } from "./list-params";
import { parseSnapshot } from "./snapshot";

const noCan = { edit: false, submit: false, approve: false, reject: false, issue: false, void: false, copy: false, withdraw: false, delete: false, create_child: [] };
type C = LockContext["contract"];
const step = (o: Partial<C["steps"][number]>): C["steps"][number] => ({
  id: "s", step_no: 1, label: "Quản lý duyệt", status: "waiting", required_permission: "contract:approve", required_role: "quan_ly",
  decided_by: null, decided_by_name: null, decided_at: null, note: null, snapshot_hash_at_decision: null, ...o,
});
const ctx = (c: Partial<C>, meId = "me", permissions: string[] = []): LockContext => ({
  contract: { status: "pending", created_by: "creator", steps: [step({})], can: noCan, replaced_by_id: null, ...c },
  meId,
  permissions,
});

describe("lockReason (SPEC-04b 3.4)", () => {
  it("returns null when the API says can", () => {
    expect(lockReason("approve", ctx({ can: { ...noCan, approve: true } }))).toBeNull();
  });
  it("creator cannot approve their own contract", () => {
    expect(lockReason("approve", ctx({}, "creator"))).toBe("Bạn là người tạo nên không tự duyệt được.");
  });
  it("one person, one step", () => {
    const c = ctx({ steps: [step({ status: "approved", decided_by: "me" }), step({ step_no: 2, label: "Giám đốc duyệt", required_role: "giam_doc" })] });
    expect(lockReason("approve", c)).toContain("mỗi người chỉ quyết một bước");
  });
  it("names the waiting step and its role", () => {
    expect(lockReason("approve", ctx({}))).toBe("Bước «Quản lý duyệt» do Quản lý duyệt.");
    expect(lockReason("approve", ctx({ steps: [step({ label: "Giám đốc duyệt", required_role: null })] }))).toBe("Bước «Giám đốc duyệt» do Quản lý hoặc Giám đốc duyệt.");
  });
  it("edit on a sent contract hints Rút về nháp only when withdraw is possible", () => {
    expect(lockReason("edit", ctx({ can: { ...noCan, withdraw: true } }, "creator"))).toContain("Rút về nháp");
    expect(lockReason("edit", ctx({}, "creator"))).toBe("Hợp đồng đã gửi duyệt, không sửa được nữa.");
    expect(lockReason("edit", ctx({ status: "draft" }, "someone"))).toBe("Chỉ người tạo mới sửa/gửi duyệt hợp đồng nháp.");
  });
  it("withdraw: creator-only, blocked once a step was decided", () => {
    expect(lockReason("withdraw", ctx({}, "someone"))).toBe("Chỉ người tạo mới rút về nháp được.");
    const decided = ctx({ steps: [step({ status: "approved", decided_by: "x" })] }, "creator");
    expect(lockReason("withdraw", decided)).toBe("Đã có người duyệt/từ chối một bước, không rút về nháp được.");
  });
  it("issue / void / delete", () => {
    expect(lockReason("issue", ctx({ status: "approved" }, "me", []))).toBe("Chỉ Quản lý hoặc Giám đốc phát hành.");
    expect(lockReason("issue", ctx({ status: "pending" }, "me", ["contract:issue"]))).toBe("Cần duyệt xong mọi bước mới phát hành được.");
    expect(lockReason("void", ctx({ status: "approved" }, "me", ["contract:issue"]))).toBe("Chỉ hủy được hợp đồng đã phát hành.");
    expect(lockReason("delete", ctx({ status: "pending" }, "creator"))).toBe("Chỉ xóa được hợp đồng còn là nháp.");
    expect(lockReason("delete", ctx({ status: "draft" }, "someone"))).toBe("Chỉ người tạo mới xóa được nháp.");
  });
  it("a locked action always has a sentence (never a silent dead button)", () => {
    for (const status of ["draft", "pending", "approved", "issued", "rejected", "voided"] as const) {
      for (const action of visibleActions(status)) {
        expect(lockReason(action, ctx({ status }, "stranger")), `${status}/${action}`).toMatch(/\S/);
      }
    }
  });
  it("voided contract with a replacement says so", () => {
    expect(lockReason("copy", ctx({ status: "voided", replaced_by_id: "R" }))).toBe("Đã có bản thay thế");
  });
});

describe("buildValues", () => {
  const fields: FieldSpec[] = [
    { key: "ma_goi", required: true, source: "manual" }, // v1 leftovers: no longer form keys, never sent
    { key: "so_cua_hang", required: true, source: "manual" },
    { key: "giam_gia", required: false, source: "manual" },
    { key: "chuc_vu_nguoi_ky", required: true, source: "manual" },
    { key: "so_bao_gia", required: false, source: "manual" },
    { key: "ngay_bao_gia", required: false, source: "manual" },
    { key: "ten_khach", required: false, source: "subject:contact_person" },
    { key: "khoa_la", required: false, source: "manual" },
  ];
  const filled = { ...emptyForm(), chuc_vu_nguoi_ky: "  Chủ hộ  " };

  it("sends only known keys, drops blanks, trims", () => {
    const r = buildValues({ ...filled, giam_gia: "5" }, fields);
    expect(r).toEqual({ ok: true, values: { giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ" } });
    expect(activeKeys(fields)).not.toContain("khoa_la" as never);
  });
  it("7,5 and 7.5 are 750 bps — an integer, not a float", () => {
    for (const t of ["7,5", "7.5"]) {
      const r = buildValues({ ...filled, giam_gia: t }, fields);
      expect(r.ok && r.values.giam_gia).toBe(750);
    }
    expect(Number.isInteger((buildValues({ ...filled, giam_gia: "0,07" }, fields) as { values: { giam_gia: number } }).values.giam_gia)).toBe(true);
  });
  it("a bad discount is a field error and sends nothing", () => {
    for (const giam_gia of ["100,01", "abc", "7,555"]) {
      const r = buildValues({ ...filled, giam_gia }, fields);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.errors.giam_gia).toBeTruthy();
    }
  });
  it("ngay_bat_dau / giam_gia left blank are valid (server defaults it to Ngày lập) and is not sent", () => {
    const withStart: FieldSpec[] = [...fields.map((f) => (f.key === "giam_gia" ? { ...f, required: true } : f)), { key: "ngay_bat_dau", required: true, source: "manual" }];
    const r = buildValues(filled, withStart);
    expect(r).toEqual({ ok: true, values: { chuc_vu_nguoi_ky: "Chủ hộ" } });
  });
  it("names the missing required fields in Vietnamese", () => {
    const r = buildValues({ ...filled, chuc_vu_nguoi_ky: "   " }, fields);
    expect(r).toMatchObject({ ok: false, message: "Thiếu: Chức vụ người ký. Điền rồi tạo lại." });
  });
  it("so_bao_gia and ngay_bao_gia: both or neither", () => {
    const r = buildValues({ ...filled, so_bao_gia: "BG-1" }, fields);
    expect(!r.ok && r.errors.so_bao_gia).toBe("Nhập cả hai hoặc bỏ trống cả hai");
    expect(!r.ok && r.errors.ngay_bao_gia).toBe("Nhập cả hai hoặc bỏ trống cả hai");
    expect(buildValues({ ...filled, so_bao_gia: "BG-1", ngay_bao_gia: "2026-09-01" }, fields).ok).toBe(true);
  });
  it("round-trips bps for the edit form", () => {
    expect(bpsToPercentText(750)).toBe("7,5");
    expect(bpsToPercentText(500)).toBe("5");
    expect(bpsToPercentText(1234)).toBe("12,34");
    expect(bpsToPercentText(5)).toBe("0,05");
    expect(formFromInputs({ giam_gia: 750, chuc_vu_nguoi_ky: "GĐ" })).toMatchObject({ giam_gia: "7,5", chuc_vu_nguoi_ky: "GĐ" });
  });
});

describe("buildFlow", () => {
  const base = { void_reason: null };
  it("draft = only Tạo; steps come with their own decider; the first waiting step is current", () => {
    const draft = buildFlow({ ...base, status: "draft", steps: [], timeline: [{ action: "contract.created", at: 1, actor: "An" }] });
    expect(draft.map((i) => i.label)).toEqual(["Tạo"]);
    const pending = buildFlow({
      ...base,
      status: "pending",
      steps: [step({ step_no: 2, label: "Giám đốc duyệt" }), step({ step_no: 1, status: "approved", decided_by_name: "Bình", decided_at: 5, note: "ok" })],
      timeline: [
        { action: "contract.created", at: 1, actor: "An" },
        { action: "contract.submitted", at: 2, actor: "An" },
        { action: "contract.withdrawn", at: 3, actor: "An" },
        { action: "contract.submitted", at: 4, actor: "An" },
      ],
    });
    expect(pending.map((i) => i.label)).toEqual(["Tạo", "Gửi duyệt", "Quản lý duyệt", "Giám đốc duyệt"]);
    expect(pending.find((i) => i.key === "submitted")?.at).toBe(4);
    expect(pending[2]).toMatchObject({ actor: "Bình", state: "done", note: "ok", current: false });
    expect(pending[3]).toMatchObject({ state: "waiting", current: true });
  });
  it("voided keeps the reason as text", () => {
    const f = buildFlow({
      status: "voided", void_reason: "<b>Đổi gói</b>", steps: [],
      timeline: [{ action: "contract.created", at: 1 }, { action: "contract.submitted", at: 2 }, { action: "contract.issued", at: 3 }, { action: "contract.voided", at: 4, actor: "Giám đốc" }],
    });
    expect(f.map((i) => i.kind)).toEqual(["created", "submitted", "issued", "voided"]);
    expect(f[3]?.note).toBe("<b>Đổi gói</b>");
  });
});

describe("parseListParams", () => {
  it("keeps only the tab name and ULIDs", () => {
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const p = parseListParams(new URLSearchParams(`tab=pending&khach=${id}&nguoi-tao=Nguyen+Van+A&mau=${id}`));
    expect(p).toEqual({ tab: "pending", filters: { customerId: id, templateId: id } });
    expect(parseListParams(new URLSearchParams("tab=hack")).tab).toBe("all");
  });
});

describe("line block (DEC-13 A: the client sends product_id + qty, never a price)", () => {
  const G6 = "01PROD000000000000000000G6";
  const MIN = "01PROD00000000000000DEMOMIN";
  it("rows -> body lines: ids and integer qty only, trimmed", () => {
    const r = buildLines([{ key: "a", productId: G6, qty: " 1 " }, { key: "b", productId: MIN, qty: "9999" }]);
    expect(r).toEqual({ ok: true, lines: [{ product_id: G6, qty: 1 }, { product_id: MIN, qty: 9999 }] });
  });
  it("no row, no product, or qty outside 1–9999 / not an integer is a per-row error and sends nothing", () => {
    expect(buildLines([])).toMatchObject({ ok: false, message: "Thêm ít nhất một dòng hàng." });
    const r = buildLines([{ key: "a", productId: "", qty: "1" }, { key: "b", productId: G6, qty: "0" }, { key: "c", productId: G6, qty: "1,5" }, { key: "d", productId: G6, qty: "10000" }]);
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors)).toEqual(["0", "1", "2", "3"]);
    expect(!r.ok && r.errors[0]).toBe("Chọn sản phẩm");
    expect(!r.ok && r.errors[1]).toBe("Số lượng phải là số nguyên từ 1 đến 9999");
  });
  it("edit form rebuilds the rows from snapshot.inputs.lines; one empty row when there are none", () => {
    const rows = rowsFromInputs([{ productId: G6, qty: 1 }, { productId: MIN, qty: 3 }]);
    expect(rows.map((x) => [x.productId, x.qty])).toEqual([[G6, "1"], [MIN, "3"]]);
    expect(new Set(rows.map((x) => x.key)).size).toBe(2);
    expect(rowsFromInputs([]).map((x) => [x.productId, x.qty])).toEqual([["", "1"]]);
  });
  it("preview body: only complete rows, discount as integer bps, null when nothing to price or the discount is invalid", () => {
    const rows = [{ key: "a", productId: G6, qty: "1" }, { key: "b", productId: "", qty: "1" }, { key: "c", productId: MIN, qty: "x" }];
    expect(previewBody(rows, "5")).toEqual({ lines: [{ product_id: G6, qty: 1 }], discount_bps: 500 });
    expect(previewBody(rows, "")).toEqual({ lines: [{ product_id: G6, qty: 1 }], discount_bps: 0 });
    expect(previewBody(rows, "abc")).toBeNull();
    expect(previewBody([{ key: "b", productId: "", qty: "1" }], "")).toBeNull();
  });
});

describe("parseSnapshot", () => {
  it("reads lines, VAT groups, totals and input lines defensively and never throws on junk", () => {
    expect(parseSnapshot(null).lines).toEqual([]);
    expect(parseSnapshot(null).vatGroups).toEqual([]);
    const s = parseSnapshot({
      template: { version_id: "V", version_no: 2 },
      lines: [
        { product_id: "P1", code: "G6", name: "Gói 6 tháng", kind: "service", unit: "gói", qty: 1, unit_price_ex_vat: 2700000, vat_rate_bps: null, amount_ex_vat: 2700000, discount_amount: 135000, net_ex_vat: 2565000 },
        { product_id: "P2", code: "MIN", name: "Máy in", kind: "goods", unit: "cái", qty: 2, unit_price_ex_vat: 500000, vat_rate_bps: 1000, amount_ex_vat: 1000000, discount_amount: 0, net_ex_vat: 1000000 },
      ],
      vat_groups: [{ vat_rate_bps: null, base: 2565000, vat: 0 }, { vat_rate_bps: 1000, base: 1000000, vat: 100000 }],
      subtotal_ex_vat: 3700000, discount_bps: 500, discount_amount: 135000, total_ex_vat: 3565000, vat_total: 100000, total: 3665000,
      dates: { start: "2026-01-01", end: "2026-07-01" },
      inputs: { giam_gia: 500, x: {}, lines: [{ product_id: "P1", qty: 1 }, { product_id: "P2", qty: 2 }, "junk"] },
      total_words: "một trăm",
    });
    expect(s).toMatchObject({ templateVersionId: "V", templateVersionNo: 2, start: "2026-01-01", totalWords: "một trăm", subtotalExVat: 3700000, discountAmount: 135000, vatTotal: 100000, total: 3665000 });
    expect(s.inputs).toEqual({ giam_gia: 500 });
    expect(s.inputLines).toEqual([{ productId: "P1", qty: 1 }, { productId: "P2", qty: 2 }]);
    expect(s.vatGroups).toEqual([{ vatRateBps: null, base: 2565000, vat: 0 }, { vatRateBps: 1000, base: 1000000, vat: 100000 }]);
    expect(s.lines[1]).toMatchObject({ productId: "P2", code: "MIN", name: "Máy in", kind: "goods", unit: "cái", qty: 2, unitPriceExVat: 500000, vatRateBps: 1000, amountExVat: 1000000 });
    expect(s.lines[0]?.vatRateBps).toBeNull();
  });
});

describe("type tabs (SPEC-09 §3.5) — `?loai=` in the URL", () => {
  it("parses a known type; junk is ignored; the status tab and filters still parse", () => {
    expect(parseListParams(new URLSearchParams("loai=quote")).type).toBe("quote");
    expect(parseListParams(new URLSearchParams("loai=delivery_note&tab=issued"))).toMatchObject({ type: "delivery_note", tab: "issued" });
    expect(parseListParams(new URLSearchParams("loai=hack")).type).toBeUndefined();
    expect(parseListParams(new URLSearchParams("")).type).toBeUndefined();
  });
  it("the five tabs, in the order and words of the UI contract", () => {
    expect(TYPE_TABS.map((t) => [t.value, t.label])).toEqual([
      ["all", "Tất cả"], ["quote", "Báo giá"], ["contract", "Hợp đồng"], ["payment_request", "Đề nghị TT"], ["delivery_note", "Phiếu xuất kho"],
    ]);
  });
  it("empty tab sentence + create button per type; DNTT has no create button", () => {
    expect(typeEmptyTitle("quote")).toBe("Chưa có báo giá nào");
    expect(typeEmptyTitle("payment_request")).toBe("Chưa có đề nghị thanh toán nào");
    expect(createLabel("quote")).toBe("Tạo báo giá");
    expect(createLabel("delivery_note")).toBe("Tạo phiếu xuất kho");
  });
  it("+ Tạo offers BG · HĐ · PXK by permission, never DNTT", () => {
    expect(creatableTypes(["quote:write", "contract:write", "delivery_note:write", "payment_request:write"])).toEqual(["quote", "contract", "delivery_note"]);
    expect(creatableTypes(["contract:write"])).toEqual(["contract"]);
    expect(creatableTypes(["contract:read"])).toEqual([]);
  });
});

describe("form by type (SPEC-09 §3.5)", () => {
  const fields: FieldSpec[] = [
    { key: "giam_gia", required: false, source: "manual" },
    { key: "chuc_vu_nguoi_ky", required: false, source: "manual" },
    { key: "ly_do_xuat_kho", required: true, source: "manual" },
    { key: "xuat_tai_kho", required: false, source: "manual" },
    { key: "dia_diem", required: false, source: "manual" },
  ];
  it("PXK: no discount field and no giam_gia in the body; 3 warehouse fields in order", () => {
    expect(activeKeys(fields, "delivery_note")).toEqual(["chuc_vu_nguoi_ky", "ly_do_xuat_kho", "xuat_tai_kho", "dia_diem"]);
    const r = buildValues({ ...emptyForm(), giam_gia: "5", ly_do_xuat_kho: " Giao máy in ", xuat_tai_kho: "Kho A" }, fields, "delivery_note");
    expect(r).toEqual({ ok: true, values: { ly_do_xuat_kho: "Giao máy in", xuat_tai_kho: "Kho A" } });
    expect(VALUE_LABELS.ly_do_xuat_kho).toBe("Lý do xuất kho");
    expect(VALUE_LABELS.xuat_tai_kho).toBe("Xuất tại kho");
    expect(VALUE_LABELS.dia_diem).toBe("Địa điểm");
  });
  it("PXK: the required reason is checked", () => {
    expect(buildValues(emptyForm(), fields, "delivery_note")).toMatchObject({ ok: false, message: "Thiếu: Lý do xuất kho. Điền rồi tạo lại." });
  });
  it("BG: no signer position in the field list or the body", () => {
    expect(activeKeys(fields, "quote")).toEqual(["giam_gia", "ly_do_xuat_kho", "xuat_tai_kho", "dia_diem"]);
    const r = buildValues({ ...emptyForm(), giam_gia: "5", chuc_vu_nguoi_ky: "GĐ" }, fields.slice(0, 2), "quote");
    expect(r).toEqual({ ok: true, values: { giam_gia: 500 } });
  });
  it("a frozen child (price kept from its parent): no discount in the body either", () => {
    const r = buildValues({ ...emptyForm(), giam_gia: "5", chuc_vu_nguoi_ky: "GĐ" }, fields.slice(0, 2), "contract", { frozen: true });
    expect(r).toEqual({ ok: true, values: { chuc_vu_nguoi_ky: "GĐ" } });
  });
  it("HĐ keeps today's behaviour (no type = contract)", () => {
    expect(buildValues({ ...emptyForm(), giam_gia: "5", chuc_vu_nguoi_ky: "GĐ" }, fields.slice(0, 2)))
      .toEqual({ ok: true, values: { giam_gia: 500, chuc_vu_nguoi_ky: "GĐ" } });
  });
  it("the PXK line combobox offers goods only", () => {
    const items = [{ id: "1", kind: "service" }, { id: "2", kind: "goods" }] as Array<{ id: string; kind: "service" | "goods" }>;
    expect(productsFor("delivery_note", items).map((p) => p.id)).toEqual(["2"]);
    expect(productsFor("quote", items).map((p) => p.id)).toEqual(["1", "2"]);
    expect(productsFor(undefined, items)).toHaveLength(2);
  });
});
