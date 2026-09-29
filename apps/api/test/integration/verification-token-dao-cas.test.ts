/**
 * Proves `consumeVerificationToken` is an atomic CAS, not read-then-write:
 * concurrent double-consume of the same token must yield exactly one
 * success; expired and already-used tokens must yield `null` without a
 * second overlapping write.
 */
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../src/db/client";
import { verificationTokens } from "../../src/db/schema";
import {
  consumeVerificationToken,
  insertVerificationToken,
} from "../../src/dao/verification-token-dao";
import { generateUlid } from "../../src/utils/id";

async function truncateAll(db: ReturnType<typeof getDb>): Promise<void> {
  await db.delete(verificationTokens);
}

describe("verification-token-dao: consumeVerificationToken CAS", () => {
  beforeEach(async () => {
    await truncateAll(getDb(env));
  });

  it("exactly one of 5 concurrent consumes on the same token succeeds", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const tokenHash = "concurrent-hash-1";

    await insertVerificationToken(db, {
      tokenHash,
      userId,
      purpose: "verify_email",
      expiresAt: now + 3600,
      createdAt: now,
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeVerificationToken(db, tokenHash, now, "verify_email")),
    );

    const successes = results.filter((r) => r !== null);
    const failures = results.filter((r) => r === null);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(4);
    expect(successes[0]).toEqual({ userId, purpose: "verify_email" });

    // DB reflects exactly one used_at write.
    const row = await db.query.verificationTokens.findFirst({
      where: eq(verificationTokens.tokenHash, tokenHash),
    });
    expect(row?.usedAt).toBe(now);
  });

  it("expired token: consume returns null", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const tokenHash = "expired-hash-1";

    await insertVerificationToken(db, {
      tokenHash,
      userId,
      purpose: "password_reset",
      expiresAt: now - 10, // already expired
      createdAt: now - 100,
    });

    const result = await consumeVerificationToken(db, tokenHash, now, "verify_email");
    expect(result).toBeNull();

    const row = await db.query.verificationTokens.findFirst({
      where: eq(verificationTokens.tokenHash, tokenHash),
    });
    expect(row?.usedAt).toBeNull();
  });

  it("already-used token: second consume returns null, only one used_at write recorded", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const tokenHash = "already-used-hash-1";

    await insertVerificationToken(db, {
      tokenHash,
      userId,
      purpose: "verify_email",
      expiresAt: now + 3600,
      createdAt: now,
    });

    const first = await consumeVerificationToken(db, tokenHash, now, "verify_email");
    expect(first).toEqual({ userId, purpose: "verify_email" });

    const later = now + 10;
    const second = await consumeVerificationToken(db, tokenHash, later, "verify_email");
    expect(second).toBeNull();

    // Row shows only the FIRST used_at timestamp — the second call never
    // overwrote it (proves CAS guarded the write, not just the return value).
    const row = await db.query.verificationTokens.findFirst({
      where: eq(verificationTokens.tokenHash, tokenHash),
    });
    expect(row?.usedAt).toBe(now);
  });

  it("never-existed token: consume returns null", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);

    const result = await consumeVerificationToken(db, "does-not-exist", now, "verify_email");
    expect(result).toBeNull();
  });
});
