import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { renderHtml } from "../../src/domain/contract/render";
import type { Snapshot } from "../../src/domain/contract/types";

// FIX-02: every class the seeded template body uses must be styled by the printable paper.
describe("contract paper CSS covers the seeded template classes", () => {
  const seed = env.TEST_MIGRATIONS.find((m) => m.name.includes("0013_seed_software_contract_template"));
  const seedSql = (seed?.queries ?? []).join("\n");
  const used = [...new Set([...seedSql.matchAll(/class="([^"]+)"/g)].flatMap((m) => (m[1] ?? "").split(/\s+/)))];
  const rendered = renderHtml("<p>x</p>", { fields: {} } as unknown as Snapshot, "HD-1");
  const style = rendered.ok ? (/<style>([\s\S]*?)<\/style>/.exec(rendered.html)?.[1] ?? "") : "";

  it("finds the classes the seed uses", () => {
    expect(used).toEqual(expect.arrayContaining(["center", "b", "sig"]));
  });

  it.each(used)("has a selector for .%s", (cls) => {
    expect(style).toMatch(new RegExp(`\\.${cls}(?![\\w-])`));
  });
});
