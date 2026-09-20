import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuditLogger, deepScrub } from "../../src/observability/logger";

describe("deepScrub", () => {
  it("returns primitives unchanged", () => {
    expect(deepScrub("hello")).toBe("hello");
    expect(deepScrub(42)).toBe(42);
    expect(deepScrub(true)).toBe(true);
    expect(deepScrub(null)).toBe(null);
    expect(deepScrub(undefined)).toBe(undefined);
  });

  it("redacts top-level sensitive keys", () => {
    const scrubbed = deepScrub({
      email: "u@example.com",
      password: "s3cret",
    }) as Record<string, unknown>;
    expect(scrubbed.email).toBe("u@example.com");
    expect(scrubbed.password).toBe("[REDACTED]");
  });

  it("redacts nested sensitive keys (recursive)", () => {
    const scrubbed = deepScrub({
      user: {
        profile: {
          nested: { authorization: "Bearer abc" },
        },
      },
    }) as { user: { profile: { nested: { authorization: string } } } };
    expect(scrubbed.user.profile.nested.authorization).toBe("[REDACTED]");
  });

  it("case-insensitive matching (Password, TOKEN, Cookie)", () => {
    const scrubbed = deepScrub({
      Password: "x",
      TOKEN: "y",
      Cookie: "z",
    }) as Record<string, string>;
    expect(scrubbed.Password).toBe("[REDACTED]");
    expect(scrubbed.TOKEN).toBe("[REDACTED]");
    expect(scrubbed.Cookie).toBe("[REDACTED]");
  });

  it("matches substrings (user_password_hash, x-api-key)", () => {
    const scrubbed = deepScrub({
      user_password_hash: "$scrypt$...",
      "x-api-key": "sk_live_...",
    }) as Record<string, string>;
    expect(scrubbed.user_password_hash).toBe("[REDACTED]");
    expect(scrubbed["x-api-key"]).toBe("[REDACTED]");
  });

  it("walks arrays element-by-element", () => {
    const scrubbed = deepScrub([
      { name: "ok" },
      { password: "leaked" },
    ]) as Array<Record<string, string>>;
    expect(scrubbed[0]?.name).toBe("ok");
    expect(scrubbed[1]?.password).toBe("[REDACTED]");
  });

  it("caps recursion depth to prevent stack overflow", () => {
    // Build a 40-deep nested object; MAX_DEPTH is 32.
    let node: Record<string, unknown> = { deepest: "value" };
    for (let i = 0; i < 40; i++) {
      node = { child: node };
    }
    const result = deepScrub(node);
    // The exact shape isn't the assertion — we just want the walk
    // to terminate without throwing, and to emit the truncation
    // sentinel somewhere below depth 32.
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("[TRUNCATED_DEPTH]");
  });

  it("preserves undefined and null values verbatim", () => {
    const scrubbed = deepScrub({
      a: undefined,
      b: null,
      password: undefined,
    }) as Record<string, unknown>;
    expect(scrubbed.a).toBe(undefined);
    expect(scrubbed.b).toBe(null);
    // Sensitive key with undefined value still redacts (defense-in-
    // depth — the presence of the key itself may reveal something).
    expect(scrubbed.password).toBe("[REDACTED]");
  });
});

describe("createAuditLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("writes structured JSON with ts + kind + event fields", () => {
    const audit = createAuditLogger({ ctx: undefined });
    audit({ actor: "01USER0000000000000000AAAA", action: "test.foo" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.kind).toBe("audit");
    expect(parsed.action).toBe("test.foo");
    expect(parsed.actor).toBe("01USER0000000000000000AAAA");
    expect(typeof parsed.ts).toBe("number");
  });

  it("scrubs sensitive metadata before emitting", () => {
    const audit = createAuditLogger({ ctx: undefined });
    audit({
      actor: "01USER0000000000000000AAAA",
      action: "test.leak",
      metadata: { password: "s3cret", email: "u@x.com" },
    });

    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      metadata: { password: string; email: string };
    };
    expect(parsed.metadata.password).toBe("[REDACTED]");
    expect(parsed.metadata.email).toBe("u@x.com");
  });

  it("sync:true writes before returning (mock console counts)", () => {
    const audit = createAuditLogger({ ctx: undefined });
    audit(
      { actor: null, action: "test.sync" },
      { sync: true },
    );
    // The audit call is synchronous — console.log fired before we
    // hit the assertion, no await needed.
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("async mode delegates to ctx.waitUntil when ctx is present", () => {
    const promises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>): void => {
        promises.push(p);
      },
    };
    const audit = createAuditLogger({ ctx });
    audit({ actor: null, action: "test.async" });

    // Console NOT yet called; write is queued.
    expect(logSpy).toHaveBeenCalledTimes(0);
    // waitUntil received one promise.
    expect(promises.length).toBe(1);
  });

  it("falls back to sync log when ctx is undefined and sync is unset", () => {
    const audit = createAuditLogger({ ctx: undefined });
    audit({ actor: null, action: "test.fallback" });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
