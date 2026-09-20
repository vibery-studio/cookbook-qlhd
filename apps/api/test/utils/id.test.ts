import { describe, expect, it } from "vitest";
import { generateUlid } from "../../src/utils/id";

const CROCKFORD_BASE32 = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe("generateUlid", () => {
  it("generates 1000 ULIDs that are 26 chars, unique, monotonic, and valid Crockford base32", () => {
    const count = 1000;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(generateUlid());
    }

    // (a) all 26 chars
    for (const id of ids) {
      expect(id).toHaveLength(26);
    }

    // (d) crockford base32 alphabet only (also implicitly covers (a))
    for (const id of ids) {
      expect(id).toMatch(CROCKFORD_BASE32);
    }

    // (b) all unique
    expect(new Set(ids).size).toBe(count);

    // (c) monotonic ordering — since these were generated back-to-back
    // synchronously, most (if not all) fall within the same millisecond,
    // exercising the monotonic-increment path; lexicographic string
    // ordering must match generation order for every pair.
    for (let i = 1; i < ids.length; i++) {
      const curr = ids[i]!;
      const prev = ids[i - 1]!;
      expect(curr > prev).toBe(true);
    }
  });
});
