import { describe, it, expectTypeOf } from "vitest";
import type { paths, components } from "../src/generated/types";

/**
 * Shape pin for the generated client. If the OpenAPI spec drops a
 * route or renames a component, this file fails to compile — a
 * loud, early warning that consumers will break.
 *
 * Runtime assertions live in `auto-refresh.test.ts` + `result.test.ts`;
 * this file's job is compile-time.
 */

describe("generated types (shape pin)", () => {
  it("declares every route exercised by the client wrapper", () => {
    expectTypeOf<paths["/auth/signup"]["post"]>().not.toBeNever();
    expectTypeOf<paths["/auth/verify"]["post"]>().not.toBeNever();
    expectTypeOf<paths["/auth/login"]["post"]>().not.toBeNever();
    expectTypeOf<paths["/auth/logout"]["post"]>().not.toBeNever();
    expectTypeOf<paths["/auth/refresh"]["post"]>().not.toBeNever();
    expectTypeOf<paths["/me"]["get"]>().not.toBeNever();
  });

  it("SignupRequest carries email + password strings", () => {
    type SignupBody = components["schemas"]["SignupRequest"];
    expectTypeOf<SignupBody["email"]>().toEqualTypeOf<string>();
    expectTypeOf<SignupBody["password"]>().toEqualTypeOf<string>();
  });

  it("Problem envelope matches RFC 7807 shape", () => {
    type P = components["schemas"]["Problem"];
    expectTypeOf<P["type"]>().toEqualTypeOf<string>();
    expectTypeOf<P["title"]>().toEqualTypeOf<string>();
    expectTypeOf<P["status"]>().toEqualTypeOf<number>();
  });
});
