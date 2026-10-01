/**
 * SPEC-06 §3.3 `grant_not_held` race: the service checks the caller's codes before the batch, and the batch
 * repeats the check in SQL. If the caller loses a code between the two (here: revoked by raw SQL), the grant
 * INSERT and the role's CAS write must both land 0 rows — never a role holding a code its editor no longer has.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../src/db/client";
import { editGuard, grantPermissionsStmt, updateRoleCasStmt } from "../../src/dao/role-write-dao";
import { generateUlid } from "../../src/utils/id";

// Set per test (no random values at module scope in workerd).
let ACTOR = "";
let ACTOR_ROLE = "";
let TARGET = "";

async function cleanup(): Promise<void> {
  await env.DB.prepare("DELETE FROM role_permissions WHERE role_id IN (?, ?)").bind(ACTOR_ROLE, TARGET).run();
  await env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(ACTOR).run();
  await env.DB.prepare("DELETE FROM roles WHERE id IN (?, ?)").bind(ACTOR_ROLE, TARGET).run();
}

async function seed(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const insertRole = (id: string, label: string) =>
    env.DB.prepare(
      "INSERT INTO roles (id, name, description, label, label_key, is_system, version, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 0, 1, ?, ?)",
    ).bind(id, `r_${id.toLowerCase()}`, label, label.toLowerCase(), now, now);
  await env.DB.batch([
    insertRole(ACTOR_ROLE, "Actor role"),
    insertRole(TARGET, "Target role"),
    env.DB.prepare(
      "INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE key = 'contract:read'",
    ).bind(ACTOR_ROLE),
    env.DB.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(ACTOR, ACTOR_ROLE),
  ]);
}

function grantBatch() {
  const db = getDb(env);
  const added = ["contract:read"];
  const when = editGuard({ roleId: TARGET, expectedVersion: 1, actorId: ACTOR, added });
  return db.batch([
    grantPermissionsStmt(db, { roleId: TARGET, keys: added, actorId: ACTOR, when }),
    updateRoleCasStmt(db, { roleId: TARGET, expectedVersion: 1, actorId: ACTOR, added, now: Math.floor(Date.now() / 1000) }),
  ]);
}

const targetKeys = async () =>
  (
    await env.DB.prepare(
      "SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?",
    )
      .bind(TARGET)
      .all<{ key: string }>()
  ).results.map((r) => r.key);

const targetVersion = async () =>
  (await env.DB.prepare("SELECT version FROM roles WHERE id = ?").bind(TARGET).first<{ version: number }>())?.version;

describe("role-write-dao: grant_not_held is re-checked inside the batch", () => {
  beforeEach(async () => {
    ACTOR = generateUlid();
    ACTOR_ROLE = generateUlid();
    TARGET = generateUlid();
    await seed();
  });
  afterEach(cleanup);

  it("control: the actor holds the code → granted, version + 1", async () => {
    const [granted, cas] = await grantBatch();
    expect(granted).toHaveLength(1);
    expect(cas).toEqual([{ version: 2 }]);
    expect(await targetKeys()).toEqual(["contract:read"]);
  });

  it("the actor lost the code after the service's check → 0 rows inserted, CAS refused, role unchanged", async () => {
    await env.DB.prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(ACTOR_ROLE).run();
    const [granted, cas] = await grantBatch();
    expect(granted).toHaveLength(0);
    expect(cas).toHaveLength(0);
    expect(await targetKeys()).toEqual([]);
    expect(await targetVersion()).toBe(1);
  });
});
