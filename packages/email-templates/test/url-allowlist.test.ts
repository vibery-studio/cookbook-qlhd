import { describe, expect, it } from "vitest";
import { UnsafeUrlError, sanitizeUrl } from "../src";

const APP_ORIGIN = "https://runway.dev";

describe("sanitizeUrl", () => {
  it("accepts a legit https URL under the app origin", () => {
    expect(
      sanitizeUrl("https://runway.dev/verify-email?token=abc", APP_ORIGIN),
    ).toBe("https://runway.dev/verify-email?token=abc");
  });

  it("rejects javascript: XSS", () => {
    expect(() => sanitizeUrl("javascript:alert(1)", APP_ORIGIN)).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects data: URLs", () => {
    expect(() =>
      sanitizeUrl("data:text/html,<script>alert(1)</script>", APP_ORIGIN),
    ).toThrow(UnsafeUrlError);
  });

  it("rejects vbscript: and file: URLs", () => {
    expect(() => sanitizeUrl("vbscript:msgbox(1)", APP_ORIGIN)).toThrow(
      UnsafeUrlError,
    );
    expect(() => sanitizeUrl("file:///etc/passwd", APP_ORIGIN)).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects protocol-relative", () => {
    expect(() => sanitizeUrl("//evil.example.com/x", APP_ORIGIN)).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects plain relative paths", () => {
    expect(() => sanitizeUrl("/verify?token=abc", APP_ORIGIN)).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects http:// (not https)", () => {
    expect(() =>
      sanitizeUrl("http://runway.dev/verify?token=abc", APP_ORIGIN),
    ).toThrow(UnsafeUrlError);
  });

  it("rejects a different https origin when appOrigin is set", () => {
    expect(() =>
      sanitizeUrl("https://evil.example.com/verify?token=abc", APP_ORIGIN),
    ).toThrow(UnsafeUrlError);
  });

  it("accepts any https origin when appOrigin is empty (off-site links)", () => {
    expect(sanitizeUrl("https://help.example.com/faq", "")).toBe(
      "https://help.example.com/faq",
    );
  });

  it("rejects URLs with embedded credentials", () => {
    expect(() =>
      sanitizeUrl("https://user:pass@runway.dev/verify", APP_ORIGIN),
    ).toThrow(UnsafeUrlError);
  });

  it("rejects empty string", () => {
    expect(() => sanitizeUrl("", APP_ORIGIN)).toThrow(UnsafeUrlError);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(
      sanitizeUrl("  https://runway.dev/verify?token=abc  ", APP_ORIGIN),
    ).toBe("https://runway.dev/verify?token=abc");
  });

  it("rejects invalid appOrigin argument", () => {
    expect(() =>
      sanitizeUrl("https://runway.dev/x", "not-a-url"),
    ).toThrow(UnsafeUrlError);
  });
});
