import { describe, expect, it } from "vitest";
import {
  CHILD_OF,
  childRules,
  DOC_TYPES,
  LIVE_STATUSES,
  PARENT_OF,
  WRITE_PERM,
  type ChildRuleParent,
} from "../../src/domain/contract/doc-types";

const ALL = ["contract:read", "contract:write", "quote:write", "payment_request:write", "delivery_note:write"];
const TODAY = "2026-10-01";
const issuedQuote: ChildRuleParent = { type: "quote", status: "issued", valid_until: TODAY };

describe("doc types (PLAN-09 §2b)", () => {
  it("CHILD_OF: BG → HĐ → DNTT; DNTT/PXK have no children; PARENT_OF is its inverse", () => {
    expect(DOC_TYPES).toEqual(["quote", "contract", "payment_request", "delivery_note"]);
    expect(CHILD_OF).toEqual({ quote: ["contract"], contract: ["payment_request"], payment_request: [], delivery_note: [] });
    expect(PARENT_OF).toEqual({ quote: [], contract: ["quote"], payment_request: ["contract"], delivery_note: [] });
    expect(WRITE_PERM).toEqual({
      quote: "quote:write",
      contract: "contract:write",
      payment_request: "payment_request:write",
      delivery_note: "delivery_note:write",
    });
    expect(LIVE_STATUSES).toEqual(["draft", "pending", "approved", "issued"]);
  });

  it("allowed when the parent is issued, in date, has no live child and the caller holds the child's write code", () => {
    expect(childRules({ parent: issuedQuote, liveChildren: [], today: TODAY, perms: ALL })).toEqual([
      { type: "contract", allowed: true, reason_code: null },
    ]);
    // "đến hết ngày": valid_until = today still passes
    expect(childRules({ parent: { ...issuedQuote, valid_until: TODAY }, liveChildren: [], today: TODAY, perms: ALL })[0]!.allowed).toBe(true);
  });

  it("reason order: parent-not-issued → quote-expired → child-exists → forbidden", () => {
    const everything = {
      parent: { type: "quote", status: "approved", valid_until: "2026-09-30" } as ChildRuleParent,
      liveChildren: [{ type: "contract" as const, status: "draft" }],
      today: TODAY,
      perms: ["contract:read"],
    };
    expect(childRules(everything)[0]!.reason_code).toBe("parent-not-issued");
    expect(childRules({ ...everything, parent: { ...everything.parent, status: "issued" } })[0]!.reason_code).toBe("quote-expired");
    expect(childRules({ ...everything, parent: issuedQuote })[0]!.reason_code).toBe("child-exists");
    expect(childRules({ ...everything, parent: issuedQuote, liveChildren: [] })).toEqual([
      { type: "contract", allowed: false, reason_code: "forbidden" },
    ]);
  });

  it("voided parent → parent-not-issued; a live child of another type does not block; non-live children do not count", () => {
    const hd: ChildRuleParent = { type: "contract", status: "voided", valid_until: null };
    expect(childRules({ parent: hd, liveChildren: [], today: TODAY, perms: ALL })[0]!.reason_code).toBe("parent-not-issued");
    const issuedHd: ChildRuleParent = { ...hd, status: "issued" };
    expect(childRules({ parent: issuedHd, liveChildren: [{ type: "contract", status: "draft" }], today: TODAY, perms: ALL })[0]!.allowed).toBe(true);
    expect(childRules({ parent: issuedHd, liveChildren: [{ type: "payment_request", status: "rejected" }], today: TODAY, perms: ALL })[0]!.allowed).toBe(true);
    expect(childRules({ parent: issuedHd, liveChildren: [{ type: "payment_request", status: "pending" }], today: TODAY, perms: ALL })).toEqual([
      { type: "payment_request", allowed: false, reason_code: "child-exists" },
    ]);
  });

  it("a HĐ never expires (valid_until only applies to a BG); DNTT and PXK → []", () => {
    const hd: ChildRuleParent = { type: "contract", status: "issued", valid_until: "2000-01-01" };
    expect(childRules({ parent: hd, liveChildren: [], today: TODAY, perms: ALL })[0]!.allowed).toBe(true);
    for (const type of ["payment_request", "delivery_note"] as const) {
      expect(childRules({ parent: { type, status: "issued", valid_until: null }, liveChildren: [], today: TODAY, perms: ALL })).toEqual([]);
    }
  });

  it("a BG with no valid_until (legacy) is treated as expired, never as open-ended", () => {
    expect(childRules({ parent: { ...issuedQuote, valid_until: null }, liveChildren: [], today: TODAY, perms: ALL })[0]!.reason_code).toBe(
      "quote-expired",
    );
  });
});
