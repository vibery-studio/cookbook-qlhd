import { describe, expect, it } from "vitest";
import { UnsafeUrlError, renderTemplate } from "../src";
import { z } from "zod";

const APP_ORIGIN = "https://runway.dev";

describe("renderTemplate", () => {
  it("renders verify-email with sanitized URL, subject, html + text", async () => {
    const result = await renderTemplate({
      template: "verify-email",
      appOrigin: APP_ORIGIN,
      props: {
        userName: "Alex",
        verifyUrl: "https://runway.dev/verify?token=abc123",
      },
    });

    expect(result.subject).toContain("Verify");
    expect(result.html).toContain("Alex");
    expect(result.html).toContain("https://runway.dev/verify?token=abc123");
    expect(result.text).toContain("Alex");
    expect(result.text).toContain("https://runway.dev/verify?token=abc123");
    // Plain-text fallback must exist and be non-trivial
    expect(result.text.length).toBeGreaterThan(50);
  });

  it("renders password-reset with expiresIn", async () => {
    const result = await renderTemplate({
      template: "password-reset",
      appOrigin: APP_ORIGIN,
      props: {
        userName: "Alex",
        resetUrl: "https://runway.dev/reset?token=abc123",
        expiresIn: "1 hour",
      },
    });

    expect(result.subject).toContain("Reset");
    expect(result.html).toContain("1 hour");
    expect(result.html).toContain("https://runway.dev/reset?token=abc123");
  });

  it("throws UnsafeUrlError on javascript: URL (XSS payload never renders)", async () => {
    await expect(
      renderTemplate({
        template: "verify-email",
        appOrigin: APP_ORIGIN,
        props: {
          userName: "Alex",
          verifyUrl: "javascript:alert('xss')",
        },
      }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("throws UnsafeUrlError on off-origin URL", async () => {
    await expect(
      renderTemplate({
        template: "verify-email",
        appOrigin: APP_ORIGIN,
        props: {
          userName: "Alex",
          verifyUrl: "https://evil.example.com/verify?token=abc",
        },
      }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("throws ZodError on invalid props (missing required field)", async () => {
    await expect(
      renderTemplate({
        template: "verify-email",
        appOrigin: APP_ORIGIN,
        // @ts-expect-error deliberately missing userName
        props: { verifyUrl: "https://runway.dev/verify?token=abc" },
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it("html output is deterministic (same input → same html)", async () => {
    const first = await renderTemplate({
      template: "verify-email",
      appOrigin: APP_ORIGIN,
      props: { userName: "Alex", verifyUrl: "https://runway.dev/v?t=xyz" },
    });
    const second = await renderTemplate({
      template: "verify-email",
      appOrigin: APP_ORIGIN,
      props: { userName: "Alex", verifyUrl: "https://runway.dev/v?t=xyz" },
    });
    expect(first.html).toBe(second.html);
    expect(first.text).toBe(second.text);
  });

  it("username with HTML-special chars is escaped in output (no XSS via name)", async () => {
    const result = await renderTemplate({
      template: "verify-email",
      appOrigin: APP_ORIGIN,
      props: {
        userName: "<script>alert(1)</script>",
        verifyUrl: "https://runway.dev/verify?token=abc",
      },
    });
    // React auto-escapes; the raw <script> tag must not appear in html
    expect(result.html).not.toContain("<script>alert(1)</script>");
    // The escaped form should appear
    expect(result.html).toMatch(/&lt;script&gt;/);
  });
});
