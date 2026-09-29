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
  });
});
