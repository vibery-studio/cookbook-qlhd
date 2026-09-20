import { describe, expect, it } from "vitest";
import {
  PasswordResetPropsSchema,
  TEMPLATE_NAMES,
  VerifyEmailPropsSchema,
} from "../src";

describe("prop schemas", () => {
  describe("TEMPLATE_NAMES", () => {
    it("frozen and alphabetized", () => {
      expect([...TEMPLATE_NAMES]).toEqual([...TEMPLATE_NAMES].sort());
    });
  });

  describe("VerifyEmailPropsSchema", () => {
    it("accepts valid props", () => {
      const result = VerifyEmailPropsSchema.safeParse({
        userName: "Alex",
        verifyUrl: "https://runway.dev/verify?token=abc",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing userName", () => {
      const result = VerifyEmailPropsSchema.safeParse({
        verifyUrl: "https://runway.dev/verify?token=abc",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty userName", () => {
      const result = VerifyEmailPropsSchema.safeParse({
        userName: "",
        verifyUrl: "https://runway.dev/verify?token=abc",
      });
      expect(result.success).toBe(false);
    });

    it("rejects extra props (strict)", () => {
      const result = VerifyEmailPropsSchema.safeParse({
        userName: "Alex",
        verifyUrl: "https://runway.dev/verify?token=abc",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __evil: "injection",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PasswordResetPropsSchema", () => {
    it("accepts valid props", () => {
      const result = PasswordResetPropsSchema.safeParse({
        userName: "Alex",
        resetUrl: "https://runway.dev/reset?token=abc",
        expiresIn: "1 hour",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing expiresIn", () => {
      const result = PasswordResetPropsSchema.safeParse({
        userName: "Alex",
        resetUrl: "https://runway.dev/reset?token=abc",
      });
      expect(result.success).toBe(false);
    });
  });
});
