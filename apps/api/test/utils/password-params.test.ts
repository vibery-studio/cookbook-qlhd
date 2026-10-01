import { OWASP_2024_PARAMS } from "@runway/auth";
import { describe, expect, it } from "vitest";
import { passwordHashParams } from "../../src/utils/password-params";

describe("passwordHashParams — test-fast never weakens deployed envs", () => {
  it("honours test-fast only in development", () => {
    expect(passwordHashParams({ APP_ENV: "development", PASSWORD_HASH_PROFILE: "test-fast" }).N).toBe(2 ** 10);
  });
  it.each(["preview", "production", undefined])("APP_ENV=%s + test-fast → OWASP 2024", (appEnv) => {
    expect(passwordHashParams({ APP_ENV: appEnv, PASSWORD_HASH_PROFILE: "test-fast" })).toEqual(OWASP_2024_PARAMS);
  });
  it("unset profile → OWASP 2024", () => {
    expect(passwordHashParams({ APP_ENV: "development" })).toEqual(OWASP_2024_PARAMS);
  });
});
