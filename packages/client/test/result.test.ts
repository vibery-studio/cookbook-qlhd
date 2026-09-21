import { describe, it, expect } from "vitest";
import { ok, err, type Result } from "../src/runtime/result";

describe("Result", () => {
  it("ok() sets discriminant + typed data", () => {
    const r: Result<{ user_id: string }> = ok(201, { user_id: "01USER" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe(201);
      expect(r.data.user_id).toBe("01USER");
    }
  });

  it("err() sets discriminant + typed problem", () => {
    // Return-type declared so TS keeps the full union (doesn't narrow
    // eagerly to the err branch when initialised with err()).
    const build = (): Result<{ user_id: string }> =>
      err<{ user_id: string }>(422, {
        type: "https://example.com/errors/validation",
        title: "Validation failed",
        status: 422,
      });
    const r = build();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(422);
      expect(r.problem.title).toBe("Validation failed");
    }
  });

  it("TS narrows on the ok discriminant (compile-time test)", () => {
    const build = (): Result<{ user_id: string }> => ok(201, { user_id: "01USER" });
    const r = build();
    if (!r.ok) {
      // Error branch — the `problem` field exists here.
      expect(r.problem.status).toBeGreaterThanOrEqual(400);
      return;
    }
    // Success branch — `data` exists here.
    expect(r.data.user_id).toBe("01USER");
  });
});
