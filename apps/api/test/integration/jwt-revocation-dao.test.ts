import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../src/db/client";
import { jwtRevocations } from "../../src/db/schema";
import { isJtiRevoked, pruneExpiredJtiRevocations, revokeJti } from "../../src/dao/jwt-revocation-dao";
import { generateUlid } from "../../src/utils/id";

async function truncateAll(db: ReturnType<typeof getDb>): Promise<void> {
  await db.delete(jwtRevocations);
}

describe("jwt-revocation-dao", () => {
  beforeEach(async () => {
    await truncateAll(getDb(env));
  });

  it("isJtiRevoked reflects an inserted jti and rejects an unknown one", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const jti = generateUlid();

    await revokeJti(db, {
      jti,
      userId,
      reason: "logout",
      revokedAt: now,
      expiresAt: now + 120,
    });

    expect(await isJtiRevoked(db, jti)).toBe(true);
    expect(await isJtiRevoked(db, "not-inserted")).toBe(false);
  });

  it("pruneExpiredJtiRevocations deletes only expired rows", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();

    const expiredJtis = [generateUlid(), generateUlid(), generateUlid()];
    const futureJtis = [generateUlid(), generateUlid()];

    for (const jti of expiredJtis) {
      await revokeJti(db, { jti, userId, reason: "logout", revokedAt: now - 1000, expiresAt: now - 10 });
    }
    for (const jti of futureJtis) {
      await revokeJti(db, { jti, userId, reason: "logout", revokedAt: now, expiresAt: now + 1000 });
    }

    const pruned = await pruneExpiredJtiRevocations(db, now);
    expect(pruned).toBe(3);

    for (const jti of expiredJtis) {
      expect(await isJtiRevoked(db, jti)).toBe(false);
    }
    for (const jti of futureJtis) {
      expect(await isJtiRevoked(db, jti)).toBe(true);
    }
  });
});
