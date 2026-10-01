/**
 * PLAN-08 P-6 / SPEC-08 §5 "spam sản phẩm": at most 500 products. `POST /products` at the limit → 409 `product-limit`,
 * no new row, no audit row. The limit is enforced inside the INSERT (`… WHERE (SELECT COUNT(*) FROM products) < 500`),
 * not by a count read before it. Error order (PLAN-08 §2b): a code already taken still answers 409 `duplicate`.
 * Red on the C-08-003 501 handlers; green with C-08-004.
 */
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAuditEvents,
  CSRF_HEADERS,
  createAdmin,
  createSession,
  loginAs,
  readLastVerifyToken,
  truncateTables,
  type RunwaySession,
} from "@runway/test-fixtures";
import { getDb } from "../../src/db/client";
import { jwtRevocations, refreshTokens, userRoles, users, verificationTokens } from "../../src/db/schema";
import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import { assignRoleByName } from "../../src/services/admin-service";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const LIMIT = 500;
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);

async function count(query: string, ...binds: unknown[]): Promise<number> {
  return (
    (await env.DB.prepare(query)
      .bind(...binds)
      .first<{ n: number }>())?.n ?? -1
  );
}

const countProducts = () => count("SELECT COUNT(*) AS n FROM products");

async function directorSession(): Promise<RunwaySession> {
  const admin = await createAdmin({
    fetcher,
    readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
    assignAdminRole: async (userId) => {
      await assignRoleByName({ db: getDb(env), kv: env.SESSIONS, env }, { userId, roleName: "admin" });
    },
    origin: ORIGIN,
  });
  const email = "minh@nhatminh.vn";
  const res = await admin.session.fetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, display_name: "Nguyễn Nhật Minh", role: "giam_doc" }),
  });
  expect(res.status).toBe(201);
  const body: { user: { id: string }; activation_url: string } = await res.json();
  const token = new URL(body.activation_url).searchParams.get("token");
  const act = await fetcher(`${ORIGIN}/auth/activate`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token, password: PASSWORD }),
  });
  expect(act.status).toBe(204);
  const cookies = await loginAs(fetcher, { email, password: PASSWORD, origin: ORIGIN });
  return createSession({ userId: body.user.id, email, ...cookies, fetcher, origin: ORIGIN });
}

/** Fill `products` up to `total` rows with goods `LIM-0001…` (26-char ids `01LIMIT` + 19 digits). */
async function fillTo(total: number): Promise<void> {
  const missing = total - (await countProducts());
  if (missing <= 0) return;
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO products (id, kind, code, code_norm, name, unit, duration_value, duration_unit, active, version, created_by, created_at, updated_at)
     SELECT '01LIMIT' || printf('%019d', i), 'goods', 'LIM-' || printf('%04d', i), 'LIM-' || printf('%04d', i), 'Hàng ' || i, 'cái',
            NULL, NULL, 1, 1, NULL, unixepoch(), unixepoch()
     FROM n`,
  )
    .bind(missing)
    .run();
}

let keySeq = 0;
const newKey = () => {
  keySeq += 1;
  return `01J9Z3NDEKTSV4RRFFQ7${String(keySeq).padStart(6, "0")}`;
};

const createProduct = (gd: RunwaySession, code: string) =>
  gd.fetch("/products", {
    method: "POST",
    headers: { "Idempotency-Key": newKey() },
    body: JSON.stringify({ kind: "goods", code, name: "Máy quét mã vạch", unit: "cái" }),
  });

async function slugOf(res: Response): Promise<string> {
  return (await res.json<{ type: string }>()).type;
}

describe("PLAN-08 P-6: product limit", () => {
  beforeEach(async () => {
    await clearAuditEvents(env.DB);
    try {
      await env.DB.prepare("DELETE FROM idempotency_keys").run();
    } catch {
      // not created yet
    }
    await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  afterEach(async () => {
    await env.DB.prepare("DELETE FROM products WHERE id LIKE '01LIMIT%'").run();
  });

  it("499 products → the 500th is created; at 500 → 409 product-limit, no row, no audit; a taken code → 409 duplicate", async () => {
    const gd = await directorSession();

    await fillTo(LIMIT - 1);
    expect(await countProducts()).toBe(LIMIT - 1);
    const last = await createProduct(gd, "MAY-QUET-01");
    expect(last.status).toBe(201);
    expect(await countProducts()).toBe(LIMIT);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'product.created'")).toBe(1);

    const over = await createProduct(gd, "MAY-QUET-02");
    expect(over.status).toBe(409);
    expect(await slugOf(over)).toContain("product-limit");
    expect(await countProducts()).toBe(LIMIT);
    expect(await count("SELECT COUNT(*) AS n FROM products WHERE code_norm = 'MAY-QUET-02'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'product.created'")).toBe(1);

    // error order: duplicate before product-limit
    const dup = await createProduct(gd, "may-quet-01");
    expect(dup.status).toBe(409);
    expect(await slugOf(dup)).toContain("duplicate");
    expect(await countProducts()).toBe(LIMIT);

    await env.DB.prepare("DELETE FROM products WHERE code_norm = 'MAY-QUET-01'").run();
  });
});
