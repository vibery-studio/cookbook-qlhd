/**
 * Application-level cascade proof for `deleteUser`.
 *
 * D1 does NOT reliably enforce `PRAGMA foreign_keys` across HTTP-fronted
 * statements (Red Team F11 / plan.md Locked Decision). Cascade is a DAO
 * responsibility — `deleteUser` MUST remove every dependent row before the
 * `users` row itself, all inside one atomic `db.batch([...])`.
 *
 * This test seeds a user plus one row in every dependent table, calls
 * `deleteUser`, and asserts (a) the user is gone AND (b) every dependent
 * row is gone. If a dev renames a table or forgets to add a new
 * dependent table to the cascade, this test fails loudly — that's the
 * whole point.
 */
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../src/db/client";
import {
  jwtRevocations,
  refreshTokens,
  roles,
  userRoles,
  users,
  verificationTokens,
} from "../../src/db/schema";
import { createUser, deleteUser, findUserById } from "../../src/dao/user-dao";
import { generateUlid } from "../../src/utils/id";

// Test envs share the same D1 instance via vitest-pool-workers; each test
// wipes touched tables to keep them independent.
async function truncateAll(db: ReturnType<typeof getDb>): Promise<void> {
  await db.batch([
    db.delete(userRoles),
    db.delete(verificationTokens),
    db.delete(refreshTokens),
    db.delete(jwtRevocations),
    db.delete(users),
    db.delete(roles),
  ]);
}

describe("user-dao: deleteUser cascade", () => {
  beforeEach(async () => {
    const db = getDb(env);
    await truncateAll(db);
  });

  it("removes user + all dependent rows in one atomic batch", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const userId = generateUlid();
    const roleId = generateUlid();

    // Seed: create the user via the DAO (exercises the public entrypoint).
    await createUser(db, {
      id: userId,
      email: "cascade-target@example.com",
      passwordHash: "scrypt$test",
      createdAt: now,
      updatedAt: now,
    });

    // Seed dependents in every table `deleteUser` promises to clean.
    await db.insert(roles).values({ id: roleId, name: "member", description: null });
    await db.batch([
      db.insert(userRoles).values({ userId, roleId }),
      db.insert(verificationTokens).values({
        tokenHash: "hash-verify-1",
        userId,
        purpose: "verify_email",
        expiresAt: now + 3600,
        usedAt: null,
        createdAt: now,
      }),
      db.insert(refreshTokens).values({
        tokenHash: "hash-refresh-1",
        userId,
        expiresAt: now + 604800,
        revokedAt: null,
        replacedByHash: null,
        createdAt: now,
      }),
      db.insert(jwtRevocations).values({
        jti: "jti-1",
        userId,
        reason: "logout",
        revokedAt: now,
        expiresAt: now + 900,
      }),
    ]);

    // Sanity: everything's in place.
    expect(await findUserById(db, userId)).not.toBeNull();
    const preDeps = await Promise.all([
      db.select().from(userRoles).where(eq(userRoles.userId, userId)),
      db.select().from(verificationTokens).where(eq(verificationTokens.userId, userId)),
      db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId)),
      db.select().from(jwtRevocations).where(eq(jwtRevocations.userId, userId)),
    ]);
    expect(preDeps.every((rows) => rows.length === 1)).toBe(true);

    // Act.
    await deleteUser(db, userId);

    // Assert cascade.
    expect(await findUserById(db, userId)).toBeNull();
    const postDeps = await Promise.all([
      db.select().from(userRoles).where(eq(userRoles.userId, userId)),
      db.select().from(verificationTokens).where(eq(verificationTokens.userId, userId)),
      db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId)),
      db.select().from(jwtRevocations).where(eq(jwtRevocations.userId, userId)),
    ]);
    expect(postDeps.every((rows) => rows.length === 0)).toBe(true);
  });

  it("only touches the target user's rows", async () => {
    const db = getDb(env);
    const now = Math.floor(Date.now() / 1000);
    const targetId = generateUlid();
    const bystanderId = generateUlid();

    await createUser(db, {
      id: targetId,
      email: "target@example.com",
      passwordHash: "scrypt$test",
      createdAt: now,
      updatedAt: now,
    });
    await createUser(db, {
      id: bystanderId,
      email: "bystander@example.com",
      passwordHash: "scrypt$test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(refreshTokens).values({
      tokenHash: "hash-refresh-bystander",
      userId: bystanderId,
      expiresAt: now + 604800,
      revokedAt: null,
      replacedByHash: null,
      createdAt: now,
    });

    await deleteUser(db, targetId);

    // Bystander is unharmed.
    expect(await findUserById(db, bystanderId)).not.toBeNull();
    const bystanderTokens = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, bystanderId));
    expect(bystanderTokens.length).toBe(1);
  });
});
