import { describe, expect, it } from "vitest";
import { roleDiff, roleDiffLabel } from "./role-diff";

describe("roleDiffLabel", () => {
  it("is plain Lưu with no permission change", () => {
    expect(roleDiffLabel(["a:b", "c:d"], ["c:d", "a:b"])).toBe("Lưu");
  });
  it("shows only the removed count (U+2212 minus)", () => {
    expect(roleDiffLabel(["a:b", "c:d"], ["a:b"])).toBe("Lưu (−1 quyền)");
  });
  it("shows only the added count", () => {
    expect(roleDiffLabel(["a:b"], ["a:b", "c:d", "e:f"])).toBe("Lưu (+2 quyền)");
  });
  it("shows both, added first", () => {
    expect(roleDiffLabel(["a:b", "c:d"], ["a:b", "e:f", "g:h"])).toBe("Lưu (+2 quyền · −1 quyền)");
  });
  it("roleDiff lists the codes", () => {
    expect(roleDiff(["a:b", "c:d"], ["c:d", "e:f"])).toEqual({ added: ["e:f"], removed: ["a:b"] });
  });
});
