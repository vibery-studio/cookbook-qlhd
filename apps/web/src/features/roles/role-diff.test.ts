import { describe, expect, it } from "vitest";
import { requestDiffLabel, roleDiff } from "./role-diff";

describe("requestDiffLabel (SPEC-07 DEC-1: permission edits are sent, not saved)", () => {
  it("is plain Gửi yêu cầu with no permission change", () => {
    expect(requestDiffLabel(["a:b", "c:d"], ["c:d", "a:b"])).toBe("Gửi yêu cầu");
  });
  it("shows only the removed count (U+2212 minus)", () => {
    expect(requestDiffLabel(["a:b", "c:d"], ["a:b"])).toBe("Gửi yêu cầu (−1)");
  });
  it("shows only the added count", () => {
    expect(requestDiffLabel(["a:b"], ["a:b", "c:d", "e:f"])).toBe("Gửi yêu cầu (+2)");
  });
  it("shows both, added first", () => {
    expect(requestDiffLabel(["a:b", "c:d"], ["a:b", "e:f", "g:h"])).toBe("Gửi yêu cầu (+2 · −1)");
  });
  it("roleDiff lists the codes", () => {
    expect(roleDiff(["a:b", "c:d"], ["c:d", "e:f"])).toEqual({ added: ["e:f"], removed: ["a:b"] });
  });
});
