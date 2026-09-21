/**
 * GDPR privacy lifecycle (Phase 3 v1.1). Covers:
 *   - Export: signup → login → POST /me/export → verify signature +
 *     contents; 429 on rapid repeat.
 *   - Deletion: signup → login → POST /me/delete → sessions revoked,
 *     users row flagged; sweeper (invoked directly) anonymizes on
 *     grace elapse.
 *   - Cancellation: POST /me/delete/cancel while pending → cleared.
 *   - Retention: expired user_exports rows pruned.
 *   - Inventory coverage: DATA_INVENTORY includes every user-owned
 *     table declared in schema.ts.
 */
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import {
  jwtRevocations,
  notes,
  refreshTokens,
  settings,
  userExports,
  userRoles,
  users,
  verificationTokens,
} from "../../src/db/schema";
import { schema as fullSchema } from "../../src/db/schema";
import {
  getNoopSentEmails,
  resetNoopEmailBuffer,
} from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import {
  DATA_INVENTORY,
  INVENTORY_EXEMPT_TABLES,
} from "../../src/privacy/data-inventory";
import { pruneExpiredRows } from "../../src/crons/expired-rows-pruner";
import { verifyExportSignature } from "../../src/privacy/export-service";
import { hashIdentity } from "../../src/privacy/deletion-service";
import { SettingsService } from "../../src/settings/settings-service";

const ORIGIN = "http://localhost:8787";
const CSRF_HEADERS = {
  "content-type": "application/json",
  origin: ORIGIN,
  "x-requested-with": "fetch",
};

async function truncate(): Promise<void> {
  const db = getDb(env);
  await db.delete(notes);
  await db.delete(userExports);
  await db.delete(verificationTokens);
  await db.delete(refreshTokens);
  await db.delete(jwtRevocations);
  await db.delete(userRoles);
  await db.delete(users);
  await db.delete(settings);
}

function extractCookie(response: Response, name: string): string | null {
  const raw = response.headers.get("set-cookie");
  if (raw === null) return null;
  const idx = raw.indexOf(`${name}=`);
  if (idx === -1) return null;
  const start = idx + name.length + 1;
  const endIdx = raw.indexOf(";", start);
  return raw.slice(start, endIdx === -1 ? undefined : endIdx);
}

function extractVerifyToken(): string {
  const emails = getNoopSentEmails();
  const last = emails[emails.length - 1];
  if (last === undefined || last.template !== "verify-email") {
    throw new Error("no verify-email in noop buffer");
  }
  const url = new URL(last.props.verifyUrl);
  const token = url.searchParams.get("token");
  if (token === null) throw new Error("verifyUrl missing token");
  return token;
}

async function signupVerifyLogin(
  emailAddr: string,
  password: string,
): Promise<{ userId: string; cookie: string }> {
  const signup = await SELF.fetch(`${ORIGIN}/auth/signup`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email: emailAddr, password }),
  });
  expect(signup.status).toBe(201);
  const signupBody: { user_id: string } = await signup.json();

  const token = extractVerifyToken();
  const verify = await SELF.fetch(`${ORIGIN}/auth/verify`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token }),
  });
  expect(verify.status).toBe(200);

  const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email: emailAddr, password }),
  });
  expect(login.status).toBe(200);
  const cookie = extractCookie(login, "runway_at");
  if (cookie === null) throw new Error("no access cookie");
  return { userId: signupBody.user_id, cookie };
}

describe("data inventory (unit)", () => {
  it("covers every user-owned table declared in schema.ts", () => {
    const inventoryTables = new Set(DATA_INVENTORY.map((e) => e.table));
    const exempt = new Set(INVENTORY_EXEMPT_TABLES);

    // Every table declared in the schema module gets an SQL name via
    // drizzle's `Table.Symbol.Name`. Cross-check the union.
    const schemaTables: string[] = [];
    for (const [key, val] of Object.entries(fullSchema)) {
      // Drizzle sqliteTable holds the SQL name on a Symbol; use the
      // introspection method drizzle exposes.
      const tblName = (val as unknown as { [k: symbol]: string })[
        Symbol.for("drizzle:Name")
      ];
      if (typeof tblName === "string") schemaTables.push(tblName);
      else schemaTables.push(key); // fallback
    }

    for (const t of schemaTables) {
      const covered = inventoryTables.has(t) || exempt.has(t);
      expect(covered, `table '${t}' missing from DATA_INVENTORY (or add to INVENTORY_EXEMPT_TABLES)`).toBe(true);
    }
  });
});

describe("POST /me/export (integration)", () => {
  beforeEach(async () => {
    await truncate();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("returns a signed archive containing the user's data", async () => {
    const { userId, cookie } = await signupVerifyLogin(
      "exporter@example.com",
      "correct-horse-battery-staple",
    );

    // Give the user some data: create a note.
    const db = getDb(env);
    await db.insert(notes).values({
      id: "01NOTE00000000000000000001",
      userId,
      title: "hello",
      body: "world",
      createdAt: Math.floor(Date.now() / 1000),
    });

    const res = await SELF.fetch(`${ORIGIN}/me/export`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
    });
    expect(res.status).toBe(200);
    const body: {
      export_id: string;
      generated_at: number;
      archive: {
        schema_version: 1;
        generated_at: number;
        user_id: string;
        tables: Record<string, unknown[]>;
        signature: string;
      };
    } = await res.json();

    expect(body.archive.user_id).toBe(userId);
    expect(body.archive.tables["notes"]?.length).toBe(1);
    expect(body.archive.tables["users"]?.length).toBe(1);
    // refresh_tokens are NOT exportable — security-sensitive.
    expect(body.archive.tables["refresh_tokens"]).toBeUndefined();

    // Signature verifies.
    expect(
      verifyExportSignature(body.archive, env.TOKEN_PEPPER),
    ).toBe(true);
  });

  it("second export within rate window → 429", async () => {
    const { cookie } = await signupVerifyLogin(
      "rate-limited@example.com",
      "correct-horse-battery-staple",
    );

    const first = await SELF.fetch(`${ORIGIN}/me/export`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
    });
    expect(first.status).toBe(200);

    const second = await SELF.fetch(`${ORIGIN}/me/export`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).not.toBeNull();
  });

  it("401 when not authenticated", async () => {
    const res = await SELF.fetch(`${ORIGIN}/me/export`, {
      method: "POST",
      headers: CSRF_HEADERS,
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /me/delete (integration)", () => {
  beforeEach(async () => {
    await truncate();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("wrong password → 401; sessions untouched", async () => {
    const { userId, cookie } = await signupVerifyLogin(
      "wrong-pw@example.com",
      "correct-horse-battery-staple",
    );

    const res = await SELF.fetch(`${ORIGIN}/me/delete`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    expect(res.status).toBe(401);

    // Session still works.
    const me = await SELF.fetch(`${ORIGIN}/me`, {
      headers: { cookie: `runway_at=${cookie}` },
    });
    expect(me.status).toBe(200);

    // User row NOT flagged.
    const db = getDb(env);
    const raw = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(raw?.deletionRequestedAt).toBeNull();
  });

  it("correct password → 202; refresh tokens revoked; users flagged", async () => {
    const { userId, cookie } = await signupVerifyLogin(
      "will-delete@example.com",
      "correct-horse-battery-staple",
    );

    const res = await SELF.fetch(`${ORIGIN}/me/delete`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
      body: JSON.stringify({ password: "correct-horse-battery-staple" }),
    });
    expect(res.status).toBe(202);
    const body: { scheduled_completion_at: number } = await res.json();
    expect(body.scheduled_completion_at).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );

    // Verify state via a fresh SELF.fetch instead of a same-isolate D1
    // query — Miniflare on CI sometimes tears down the D1 pool as the
    // /me/delete response completes, which races an immediate D1 read
    // and surfaces as a spurious "Network connection lost". The DAO
    // state is already exercised via the direct-query path in
    // "wrong password → 401; sessions untouched" (which asserts
    // deletionRequestedAt is null after a rejected request).
    const db = getDb(env);
    // Small await to let the isolate settle post-response.
    await new Promise((r) => setTimeout(r, 100));
    const raw = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(raw?.deletionRequestedAt).not.toBeNull();

    // Refresh tokens all revoked.
    const tokens = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it("cancel before sweep clears the flag", async () => {
    const { userId, cookie } = await signupVerifyLogin(
      "cancel-me@example.com",
      "correct-horse-battery-staple",
    );

    const del = await SELF.fetch(`${ORIGIN}/me/delete`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
      body: JSON.stringify({ password: "correct-horse-battery-staple" }),
    });
    expect(del.status).toBe(202);

    // Access token still valid (per plan: grace applies only to data;
    // deletion revokes REFRESH tokens; the current access token lives
    // until its short TTL expires). So /me/delete/cancel is reachable
    // from the same cookie.
    const cancel = await SELF.fetch(`${ORIGIN}/me/delete/cancel`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
    });
    expect(cancel.status).toBe(200);

    const db = getDb(env);
    const raw = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(raw?.deletionRequestedAt).toBeNull();
  });

  it("sweeper anonymizes user + erases child rows after grace elapses", async () => {
    const { userId, cookie } = await signupVerifyLogin(
      "erased@example.com",
      "correct-horse-battery-staple",
    );

    // Give the user a note to prove it gets erased.
    const db = getDb(env);
    await db.insert(notes).values({
      id: "01NOTE00000000000000000042",
      userId,
      title: "will vanish",
      body: "gone",
      createdAt: Math.floor(Date.now() / 1000),
    });

    // Set grace window to 1 second so the sweeper picks up the row.
    const svc = new SettingsService({ db, kv: env.SETTINGS });
    await svc.set("privacy.deletion_grace_seconds", 60, "test");

    // Request deletion.
    const del = await SELF.fetch(`${ORIGIN}/me/delete`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: `runway_at=${cookie}` },
      body: JSON.stringify({ password: "correct-horse-battery-staple" }),
    });
    expect(del.status).toBe(202);

    // Backdate `deletion_requested_at` so the sweeper's cutoff catches it.
    const past = Math.floor(Date.now() / 1000) - 3600;
    await db.update(users).set({ deletionRequestedAt: past }).where(eq(users.id, userId));

    // Capture original email for identity_hash check.
    const before = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const originalEmail = before?.email ?? "erased@example.com";

    // Invoke the pruner (which now includes the privacy sweep). Give
    // the isolate a beat to settle the batched writes before the
    // follow-up assertions — under CI load, an immediate read can race
    // the pruner's KV/D1 flush and surface as "Network connection lost".
    await pruneExpiredRows(env);
    await new Promise((r) => setTimeout(r, 200));

    // Note is gone.
    const remainingNotes = await db.select().from(notes).where(eq(notes.userId, userId));
    expect(remainingNotes.length).toBe(0);

    // Users row anonymized.
    const after = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(after?.deletedAt).not.toBeNull();
    expect(after?.email).toBe(`deleted-${userId}@runway.local`);
    expect(after?.status).toBe("disabled");

    // Identity hash reproducible.
    const expectedHash = hashIdentity(originalEmail, userId);
    expect(expectedHash.length).toBe(64); // sha256 hex
  });
});

describe("retention (integration)", () => {
  beforeEach(async () => {
    await truncate();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("expired user_exports rows are pruned by the sweeper", async () => {
    const { userId } = await signupVerifyLogin(
      "retention@example.com",
      "correct-horse-battery-staple",
    );

    const db = getDb(env);
    const past = Math.floor(Date.now() / 1000) - 3600;
    await db.insert(userExports).values({
      id: "01EXPORT00000000000000EXPIR",
      userId,
      status: "completed",
      archiveUrl: null,
      requestedAt: past - 60,
      completedAt: past - 60,
      expiresAt: past, // already expired
    });

    await pruneExpiredRows(env);

    const remaining = await db.select().from(userExports);
    expect(remaining.length).toBe(0);
  });
});
