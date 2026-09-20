/**
 * Nightly pruner integration. Seeds a handful of expired rows in
 * `jwt_revocations` and `idempotency_keys`, invokes the scheduled
 * handler, then asserts every expired row is gone and non-expired
 * rows survive.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../src/db/client";
import { idempotencyKeys, jwtRevocations } from "../../src/db/schema";
import { pruneExpiredRows } from "../../src/crons/expired-rows-pruner";

async function truncate(): Promise<void> {
  const db = getDb(env);
  await db.delete(jwtRevocations);
  await db.delete(idempotencyKeys);
}

describe("pruneExpiredRows (cron)", () => {
  beforeEach(async () => {
    await truncate();
  });

  it("deletes expired jti revocations, keeps live ones", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);

    await db.insert(jwtRevocations).values([
      {
        jti: "01JTI-EXPIRED-1",
        userId: "01USER0000000000000000AAAA",
        reason: "logout",
        revokedAt: now - 3600,
        expiresAt: now - 60,
      },
      {
        jti: "01JTI-EXPIRED-2",
        userId: "01USER0000000000000000AAAA",
        reason: "logout",
        revokedAt: now - 7200,
        expiresAt: now - 300,
      },
      {
        jti: "01JTI-LIVE-1",
        userId: "01USER0000000000000000AAAA",
        reason: "logout",
        revokedAt: now,
        expiresAt: now + 3600,
      },
    ]);

    await pruneExpiredRows(env);

    const remaining = await db.select().from(jwtRevocations);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.jti).toBe("01JTI-LIVE-1");
  });

  it("deletes expired idempotency keys, keeps live ones", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);

    await db.insert(idempotencyKeys).values([
      {
        key: "expired-key-1",
        requestHash: "hash-1",
        responseStatus: 201,
        responseBody: "{}",
        createdAt: now - 3600,
        expiresAt: now - 60,
      },
      {
        key: "live-key-1",
        requestHash: "hash-2",
        responseStatus: 201,
        responseBody: "{}",
        createdAt: now,
        expiresAt: now + 3600,
      },
    ]);

    await pruneExpiredRows(env);

    const remaining = await db.select().from(idempotencyKeys);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.key).toBe("live-key-1");
  });

  it("handles empty tables without errors", async () => {
    await expect(pruneExpiredRows(env)).resolves.toBeUndefined();
  });
});
