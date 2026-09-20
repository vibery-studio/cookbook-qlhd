import { z } from "zod";
import { describe, expect, it } from "vitest";
import { installZodErrorMap } from "../../src/zod-error-map";

installZodErrorMap();

describe("zod-error-map", () => {
  it("never leaks the submitted value for a too-short password field", () => {
    const schema = z.object({ password: z.string().min(12) });

    let issues: z.ZodIssue[] = [];
    try {
      schema.parse({ password: "hunter2" });
      throw new Error("expected schema.parse to throw");
    } catch (err) {
      if (!(err instanceof z.ZodError)) throw err;
      issues = err.issues;
    }

    expect(issues).toHaveLength(1);
    const message = issues[0]!.message;
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("received");
  });

  it("never leaks the submitted value for a wrong-type field", () => {
    // Force an invalid_type by handing a numeric literal to a string schema.
    // The literal itself is the "sensitive" payload we don't want echoed.
    const schema = z.object({ token: z.string() });

    let issues: z.ZodIssue[] = [];
    try {
      schema.parse({ token: 9876543210987 as unknown as string });
      throw new Error("expected schema.parse to throw");
    } catch (err) {
      if (!(err instanceof z.ZodError)) throw err;
      issues = err.issues;
    }

    const message = issues[0]!.message;
    expect(message).not.toContain("9876543210987");
    expect(message).not.toContain("received");
  });

  it("does not quote the raw input value when an enum is invalid", () => {
    const schema = z.enum(["admin", "member"]);

    let issues: z.ZodIssue[] = [];
    try {
      schema.parse("sup3r-s3cr3t-role-guess");
      throw new Error("expected schema.parse to throw");
    } catch (err) {
      if (!(err instanceof z.ZodError)) throw err;
      issues = err.issues;
    }

    const message = issues[0]!.message;
    expect(message).not.toContain("sup3r-s3cr3t-role-guess");
    expect(message).not.toContain("received");
    // The safe part — schema-defined options — is allowed to appear.
    expect(message).toContain("admin");
    expect(message).toContain("member");
  });
});
