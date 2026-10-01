import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, auditSentence } from "./audit-sentence";

describe("auditSentence", () => {
  it("gives a non-empty Vietnamese sentence for every known action", () => {
    for (const action of Object.keys(AUDIT_ACTIONS)) {
      const s = auditSentence({ action });
      expect(s.text.length).toBeGreaterThan(3);
      expect(s.text).not.toBe(action);
    }
  });

  it("never renders empty for an unknown action, and shows the code", () => {
    expect(auditSentence({ action: "foo.bar_baz" }).text).toBe("thực hiện foo.bar_baz");
    expect(auditSentence({ action: "" }).text).not.toBe("");
  });

  it("permission.denied is danger and exposes only the permission code", () => {
    const s = auditSentence({ action: "permission.denied", metadata: { permission: "audit:read", path: "/audit" } });
    expect(s.tone).toBe("danger");
    expect(s.icon).toBe("🔒");
    expect(s.code).toBe("audit:read");
  });

  it("covers the auth, customer and user actions of row 1", () => {
    for (const a of ["auth.login", "customer.created", "customer.updated", "user.invited", "user.role_changed", "user.disabled"]) {
      expect(AUDIT_ACTIONS[a]).toBeDefined();
    }
  });

  it("covers withdraw and delete of a draft", () => {
    expect(auditSentence({ action: "contract.withdrawn" }).text).toBe("rút hợp đồng về nháp");
    expect(auditSentence({ action: "contract.deleted" }).text).toBe("xóa hợp đồng nháp");
    expect(auditSentence({ action: "contract.pdf_generated" }).text).toBe("tạo PDF cho hợp đồng");
  });

  it("names the role in role.* sentences, with or without metadata", () => {
    expect(auditSentence({ action: "role.created", metadata: { label: "Kế toán" } }).text).toBe("tạo vai trò «Kế toán»");
    expect(auditSentence({ action: "role.updated", metadata: { label: "Kế toán" } }).text).toBe("sửa vai trò «Kế toán»");
    expect(auditSentence({ action: "role.deleted", metadata: { label: "Kế toán" } }).text).toBe("xóa vai trò «Kế toán»");
    expect(
      auditSentence({ action: "role.permissions_changed", metadata: { label: "Quản lý", added: ["a:b"], removed: ["c:d", "e:f"] } }).text,
    ).toBe("bật 1 · tắt 2 quyền của «Quản lý»");
    expect(auditSentence({ action: "role.permissions_changed", metadata: { label: "Quản lý", added: [], removed: ["c:d"] } }).text).toBe(
      "tắt 1 quyền của «Quản lý»",
    );
    expect(auditSentence({ action: "role.created" }).text).toBe("tạo vai trò");
  });

  it("sod.* names both permissions by label", () => {
    const m = { perm_a: "contract:issue", perm_b: "contract:approve" };
    expect(auditSentence({ action: "sod.pair_added", metadata: m }).text).toBe("khai cặp quyền xung đột «Phát hành & hủy» ⟷ «Duyệt / từ chối»");
    expect(auditSentence({ action: "sod.pair_removed", metadata: m }).text).toBe("xóa cặp quyền xung đột «Phát hành & hủy» ⟷ «Duyệt / từ chối»");
    expect(auditSentence({ action: "sod.pair_added" }).text).toBe("khai cặp quyền xung đột");
  });

  it("role.change_* sentences carry the counts and the role", () => {
    const m = { label: "Quản lý", added: ["a:b", "c:d"], removed: ["e:f"] };
    expect(auditSentence({ action: "role.change_requested", metadata: m }).text).toBe("gửi yêu cầu bật 2 · tắt 1 quyền của «Quản lý»");
    expect(auditSentence({ action: "role.change_approved", metadata: m }).text).toBe("duyệt yêu cầu bật 2 · tắt 1 quyền của «Quản lý»");
    expect(auditSentence({ action: "role.change_rejected", metadata: m }).text).toBe("từ chối yêu cầu bật 2 · tắt 1 quyền của «Quản lý»");
    expect(auditSentence({ action: "role.change_withdrawn", metadata: m }).text).toBe("rút yêu cầu bật 2 · tắt 1 quyền của «Quản lý»");
    expect(auditSentence({ action: "role.change_expired", metadata: m }).text).toBe("yêu cầu bật 2 · tắt 1 quyền của «Quản lý» hết hạn");
    expect(auditSentence({ action: "role.change_requested", metadata: { label: "Quản lý", added: [], removed: ["e:f"] } }).text).toBe(
      "gửi yêu cầu tắt 1 quyền của «Quản lý»",
    );
    expect(auditSentence({ action: "role.change_requested" }).text).toBe("gửi yêu cầu đổi quyền của vai trò");
  });

  it("jit.* sentences: grant shows the VN time and the reason", () => {
    // 2026-10-01T08:30:00Z = 15:30 in Asia/Ho_Chi_Minh
    const expires_at = Date.UTC(2026, 9, 1, 8, 30) / 1000;
    expect(auditSentence({ action: "jit.granted", metadata: { user: "u1", reason: "Sửa cấu hình email", expires_at } }).text).toBe(
      "cấp quản trị tạm thời tới 15:30 — lý do: Sửa cấu hình email",
    );
    expect(auditSentence({ action: "jit.granted", metadata: { user_name: "Bình", reason: "Sửa cấu hình email", expires_at } }).text).toBe(
      "cấp quản trị tạm thời cho «Bình» tới 15:30 — lý do: Sửa cấu hình email",
    );
    expect(auditSentence({ action: "jit.granted" }).text).toBe("cấp quản trị tạm thời");
    expect(auditSentence({ action: "jit.revoked" }).text).toBe("thu hồi quản trị tạm thời");
    expect(auditSentence({ action: "jit.expired" }).text).toBe("quản trị tạm thời hết hạn");
  });

  it("review.* sentences", () => {
    expect(auditSentence({ action: "review.opened", metadata: { period: "2026-Q4" } }).text).toBe("mở đợt rà soát quyền Q4/2026");
    expect(auditSentence({ action: "review.closed", metadata: { period: "2026-Q4" } }).text).toBe("kết thúc đợt rà soát quyền Q4/2026");
    expect(auditSentence({ action: "review.opened" }).text).toBe("mở đợt rà soát quyền");
    expect(auditSentence({ action: "review.item_decided", metadata: { role: "quan_ly", decision: "keep" } }).text).toBe("rà soát quyền: giữ một tài khoản");
    expect(auditSentence({ action: "review.item_decided", metadata: { decision: "remove" } }).text).toBe("rà soát quyền: gỡ một tài khoản");
  });

  it("every FR-9 action has an entry", () => {
    for (const a of [
      "sod.pair_added", "sod.pair_removed",
      "role.change_requested", "role.change_approved", "role.change_rejected", "role.change_withdrawn", "role.change_expired",
      "jit.granted", "jit.revoked", "jit.expired", "review.opened", "review.closed", "review.item_decided",
    ]) {
      expect(AUDIT_ACTIONS[a], a).toBeDefined();
    }
  });

  it("product.* and price.* name the code, rate and date (SPEC-08 FR-8)", () => {
    const price = { code: "DEMO-MIN-01", unit_price_ex_vat: 1_100_000, vat_rate_bps: 1000, effective_from: "2027-01-01" };
    expect(auditSentence({ action: "price.added", metadata: price }).text).toBe("đặt giá «DEMO-MIN-01» 1.100.000 đ + 10% từ 01/01/2027");
    expect(auditSentence({ action: "price.added", metadata: { ...price, vat_rate_bps: null } }).text).toBe("đặt giá «DEMO-MIN-01» 1.100.000 đ KCT từ 01/01/2027");
    expect(auditSentence({ action: "price.cancelled", metadata: price }).text).toBe("hủy mức giá «DEMO-MIN-01» 1.100.000 đ + 10% từ 01/01/2027");
    expect(auditSentence({ action: "product.created", metadata: { code: "G6", kind: "service" } }).text).toBe("thêm sản phẩm «G6»");
    expect(auditSentence({ action: "product.updated", metadata: { code: "G6", fields: ["name"] } }).text).toBe("sửa sản phẩm «G6»");
    expect(auditSentence({ action: "product.deactivated", metadata: { code: "G6" } }).text).toBe("ngừng bán «G6»");
    expect(auditSentence({ action: "product.reactivated", metadata: { code: "G6" } }).text).toBe("bán lại «G6»");
    expect(auditSentence({ action: "product.created" }).text).toBe("thêm sản phẩm");
    expect(auditSentence({ action: "price.added" }).text).toBe("đặt giá");
  });
});

describe("auditSentence by document type (SPEC-09 FR-10)", () => {
  it("no type = hợp đồng, the old sentences stay", () => {
    expect(auditSentence({ action: "contract.created", metadata: { to: "draft" } }).text).toBe("tạo hợp đồng");
    expect(auditSentence({ action: "contract.issued" }).text).toBe("phát hành hợp đồng");
  });
  it("names the type in every contract.* sentence", () => {
    const t = (action: string, type: string) => auditSentence({ action, metadata: { type } }).text;
    expect(t("contract.created", "quote")).toBe("tạo báo giá");
    expect(t("contract.updated", "delivery_note")).toBe("sửa phiếu xuất kho");
    expect(t("contract.submitted", "payment_request")).toBe("gửi duyệt đề nghị thanh toán");
    expect(t("contract.approved", "quote")).toBe("duyệt báo giá");
    expect(t("contract.rejected", "quote")).toBe("từ chối báo giá");
    expect(t("contract.withdrawn", "quote")).toBe("rút báo giá về nháp");
    expect(t("contract.deleted", "delivery_note")).toBe("xóa phiếu xuất kho nháp");
    expect(t("contract.issued", "quote")).toBe("phát hành báo giá");
    expect(t("contract.voided", "payment_request")).toBe("hủy đề nghị thanh toán đã phát hành");
    expect(t("contract.pdf_generated", "quote")).toBe("tạo PDF cho báo giá");
  });
  it("a child made from its parent says so", () => {
    expect(auditSentence({ action: "contract.created", metadata: { type: "contract", parent_id: "P", parent_number: "BG-2026-001" } }).text)
      .toBe("lập hợp đồng từ báo giá BG-2026-001");
    expect(auditSentence({ action: "contract.created", metadata: { type: "payment_request", parent_id: "P", parent_number: "HD-2026-004" } }).text)
      .toBe("lập đề nghị thanh toán từ hợp đồng HD-2026-004");
  });
  it("an unknown type falls back to hợp đồng instead of printing the code", () => {
    expect(auditSentence({ action: "contract.created", metadata: { type: "zzz" } }).text).toBe("tạo hợp đồng");
  });
});

