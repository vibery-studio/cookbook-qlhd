/** C-04b-001a: listCustomers adds issued_* with a constant number of statements (no N+1 per customer). */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { listCustomers } from "../../src/dao/customer-dao";
import { schema } from "../../src/db/schema";
import { generateUlid } from "../../src/utils/id";

async function seed(n: number): Promise<void> {
  await env.DB.prepare("DELETE FROM customers").run();
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < n; i++) {
    await env.DB.prepare(
      "INSERT INTO customers (id, name, created_by, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)",
    )
      .bind(generateUlid(), `Khách ${String(i).padStart(3, "0")}`, "u1", now, now)
      .run();
  }
}

/** Counts `prepare` calls on the D1 binding the drizzle client uses. */
async function statementsFor(limit: number): Promise<{ statements: number; items: number }> {
  let statements = 0;
  const counting = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          statements += 1;
          return target.prepare(sql);
        };
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const db = drizzle(counting, { schema });
  const page = await listCustomers(db, { limit });
  return { statements, items: page.items.length };
}

describe("listCustomers issued_* statement count", () => {
  beforeEach(() => seed(0));

  it("is the same for 3 and 50 customers (list + one grouped aggregate)", async () => {
    await seed(3);
    const few = await statementsFor(50);
    await seed(50);
    const many = await statementsFor(50);
    expect(few.items).toBe(3);
    expect(many.items).toBe(50);
    expect(many.statements).toBe(few.statements);
    expect(many.statements).toBe(2);
  });
});
