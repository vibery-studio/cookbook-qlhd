/**
 * Proves `rotateRefreshToken` is an atomic CAS with typed outcomes:
 * concurrent rotation on the same token yields exactly one "ok"; reuse of
 * an already-revoked token is detected; rotation of a never-existed hash
 * returns "not-found"; and `revokeUserRefreshChain` only touches the
 * target user's rows.
 */
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../src/db/client";
import { refreshTokens } from "../../src/db/schema";
import {
  findRefreshTokenByHash,
  insertRefreshToken,
  revokeRefreshToken,
  revokeUserRefreshChain,
  rotateRefreshToken,
} from "../../src/dao/refresh-token-dao";
import { generateUlid } from "../../src/utils/id";

async function truncateAll(db: ReturnType<typeof getDb>): Promise<void> {
  await db.delete(refreshTokens);
}

describe("refresh-token-dao: rotateRefreshToken CAS", () => {
  beforeEach(async () => {
    await truncateAll(getDb(env));
  });

  it("happy-path rotation: old row revoked + replaced_by_hash set, new row exists", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const oldHash = "happy-old-1";
    const newHash = "happy-new-1";

    await insertRefreshToken(db, { tokenHash: oldHash, userId, expiresAt: now + 604800, createdAt: now });

    const outcome = await rotateRefreshToken(db, oldHash, newHash, now);
    expect(outcome).toEqual({ kind: "ok", userId, expiresAt: now + 604800 });

    const oldRow = await findRefreshTokenByHash(db, oldHash);
    expect(oldRow?.revokedAt).toBe(now);
    expect(oldRow?.replacedByHash).toBe(newHash);

    // rotateRefreshToken itself doesn't insert the new row — that's the
    // caller's (auth-service) job after receiving "ok". Confirm the new
    // hash is absent until inserted, then insert and confirm.
    expect(await findRefreshTokenByHash(db, newHash)).toBeNull();
    await insertRefreshToken(db, { tokenHash: newHash, userId, expiresAt: now + 604800, createdAt: now });
    expect(await findRefreshTokenByHash(db, newHash)).not.toBeNull();
  });

  it("concurrent rotation: exactly one outcome is ok", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const oldHash = "concurrent-old-1";

    await insertRefreshToken(db, { tokenHash: oldHash, userId, expiresAt: now + 604800, createdAt: now });

    const [a, b] = await Promise.all([
      rotateRefreshToken(db, oldHash, "concurrent-new-a", now),
      rotateRefreshToken(db, oldHash, "concurrent-new-b", now),
    ]);

    const okCount = [a, b].filter((o) => o.kind === "ok").length;
    const otherKinds = [a, b].filter((o) => o.kind !== "ok").map((o) => o.kind);

    expect(okCount).toBe(1);
    // Losing branch should be not-found under the honest-race guard: the
    // revocation is fresh (< SELF_RACE_WINDOW_SECONDS) and replaced_by_hash
    // is set. `reuse-detected` here would incorrectly nuke the winner's
    // new chain.
    expect(otherKinds.length).toBe(1);
    expect(otherKinds[0]).toBe("not-found");
  });

  it("sequential rotate-then-rotate-same-hash: first ok, second reuse-detected", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const oldHash = "sequential-old-1";

    await insertRefreshToken(db, { tokenHash: oldHash, userId, expiresAt: now + 604800, createdAt: now });

    const first = await rotateRefreshToken(db, oldHash, "sequential-new-1", now);
    expect(first.kind).toBe("ok");

    // Advance past the honest-race window (3s) so the second rotate is
    // classified as attacker replay, not concurrent self-race.
    const second = await rotateRefreshToken(db, oldHash, "sequential-new-2", now + 10);
    expect(second).toEqual({ kind: "reuse-detected", userId, chainRoot: "sequential-new-1" });
  });

  it("rotate on already-revoked token: reuse-detected", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const hash = "prerevoked-1";

    await insertRefreshToken(db, { tokenHash: hash, userId, expiresAt: now + 604800, createdAt: now });
    await revokeRefreshToken(db, hash, now);

    const outcome = await rotateRefreshToken(db, hash, "prerevoked-new-1", now + 1);
    expect(outcome).toEqual({ kind: "reuse-detected", userId, chainRoot: hash });
  });

  it("rotate on never-existed hash: not-found", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);

    const outcome = await rotateRefreshToken(db, "never-existed-1", "new-hash-1", now);
    expect(outcome).toEqual({ kind: "not-found" });
  });

  it("revokeUserRefreshChain only revokes the target user's tokens", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userX = generateUlid();
    const userY = generateUlid();

    await db.batch([
      db.insert(refreshTokens).values({
        tokenHash: "x-1",
        userId: userX,
        expiresAt: now + 604800,
        revokedAt: null,
        replacedByHash: null,
        createdAt: now,
      }),
      db.insert(refreshTokens).values({
        tokenHash: "x-2",
        userId: userX,
        expiresAt: now + 604800,
        revokedAt: null,
        replacedByHash: null,
        createdAt: now,
      }),
      db.insert(refreshTokens).values({
        tokenHash: "x-3",
        userId: userX,
        expiresAt: now + 604800,
        revokedAt: null,
        replacedByHash: null,
        createdAt: now,
      }),
      db.insert(refreshTokens).values({
        tokenHash: "y-1",
        userId: userY,
        expiresAt: now + 604800,
        revokedAt: null,
        replacedByHash: null,
        createdAt: now,
      }),
    ]);

    const count = await revokeUserRefreshChain(db, userX, now);
    expect(count).toBe(3);

    const xRows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userX));
    expect(xRows.every((r) => r.revokedAt === now)).toBe(true);

    const yRows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userY));
    expect(yRows.every((r) => r.revokedAt === null)).toBe(true);
  });
});
