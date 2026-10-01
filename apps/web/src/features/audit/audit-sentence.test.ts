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
});
