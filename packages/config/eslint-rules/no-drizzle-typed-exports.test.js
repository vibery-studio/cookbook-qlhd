/**
 * Fixture tests for the `no-drizzle-typed-exports` rule.
 *
 * We use ESLint's `Linter` API directly (RuleTester works with Node's
 * built-in `test` runner, not vitest's describe/it). Each fixture asserts
 * one branch of the rule's detection logic:
 *   - 1 valid fixture: clean DTO-only exports produce zero reports.
 *   - Invalid fixtures: one per emitted messageId, verifying the correct
 *     branch fires.
 */
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";
import { noDrizzleTypedExports } from "./no-drizzle-typed-exports.js";

const linter = new Linter({ configType: "flat" });

function lint(code) {
  return linter.verify(code, [
    {
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      },
      plugins: {
        "runway-blueprint": { rules: { "no-drizzle-typed-exports": noDrizzleTypedExports } },
      },
      rules: {
        "runway-blueprint/no-drizzle-typed-exports": "error",
      },
    },
  ]);
}

describe("no-drizzle-typed-exports", () => {
  it("permits clean DTO-only exports", () => {
    const messages = lint(`
      export interface UserDto {
        id: string;
        email: string;
      }

      export async function findUser(): Promise<UserDto | null> {
        return null;
      }
    `);
    expect(messages).toEqual([]);
  });

  it("fires 'inferModelUtility' on InferSelectModel export", () => {
    const messages = lint(`
      import { InferSelectModel } from "drizzle-orm";
      import { users } from "./db/schema";

      export type UserRow = InferSelectModel<typeof users>;
    `);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.messageId === "inferModelUtility")).toBe(true);
  });

  it("fires 'schemaTableReExport' when re-exporting a schema table", () => {
    const messages = lint(`
      import { users } from "./db/schema";

      export { users };
    `);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.messageId === "schemaTableReExport")).toBe(true);
  });
});
