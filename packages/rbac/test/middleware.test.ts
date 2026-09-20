import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requirePermission } from "../src";
import type { Permission, Principal } from "../src";

type Env = { Variables: { principal?: Principal } };

function withPrincipal(p: Principal | undefined) {
  return async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    if (p !== undefined) c.set("principal", p);
    await next();
  };
}

function admin(perms: Permission[]): Principal {
  return {
    id: "01ADMIN000000000000000AAAA",
    roles: ["admin"],
    permissions: perms,
  };
}

function member(perms: Permission[], id = "01USER0000000000000000AAAA"): Principal {
  return { id, roles: ["member"], permissions: perms };
}

describe("requirePermission middleware", () => {
  it("allows when principal has permission", async () => {
    const app = new Hono<Env>();
    app.use("*", withPrincipal(admin(["users:read"])));
    app.get("/x", requirePermission("users:read"), (c) => c.text("ok"));

    const res = await app.request("/x");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("denies with 403 when principal lacks permission", async () => {
    const app = new Hono<Env>();
    app.use("*", withPrincipal(member([])));
    app.get("/x", requirePermission("users:read"), (c) => c.text("ok"));

    const res = await app.request("/x");
    expect(res.status).toBe(403);
  });

  it("denies with 403 when principal is missing (auth middleware skipped)", async () => {
    const app = new Hono<Env>();
    app.get("/x", requirePermission("users:read"), (c) => c.text("ok"));

    const res = await app.request("/x");
    expect(res.status).toBe(403);
  });

  it("ownership: owner passes", async () => {
    const OWNER_ID = "01USER0000000000000000AAAA";
    const app = new Hono<Env>();
    app.use("*", withPrincipal(member(["notes:write"], OWNER_ID)));
    app.post(
      "/note/:id",
      requirePermission("notes:write", { resource: () => ({ ownerId: OWNER_ID }) }),
      (c) => c.text("ok"),
    );

    const res = await app.request("/note/1", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("ownership: non-owner denied", async () => {
    const app = new Hono<Env>();
    app.use("*", withPrincipal(member(["notes:write"], "01USER0000000000000000AAAA")));
    app.post(
      "/note/:id",
      requirePermission("notes:write", {
        resource: () => ({ ownerId: "01USER0000000000000000BBBB" }),
      }),
      (c) => c.text("ok"),
    );

    const res = await app.request("/note/1", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("ownership: admin bypasses owner check", async () => {
    const app = new Hono<Env>();
    app.use("*", withPrincipal(admin(["notes:write"])));
    app.post(
      "/note/:id",
      requirePermission("notes:write", {
        resource: () => ({ ownerId: "01USER0000000000000000BBBB" }),
      }),
      (c) => c.text("ok"),
    );

    const res = await app.request("/note/1", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("onDeny lets the app emit Problem+JSON", async () => {
    const app = new Hono<Env>();
    app.use("*", withPrincipal(member([])));
    app.get(
      "/x",
      requirePermission("users:read", {
        onDeny: (c, deny) =>
          c.json(
            {
              type: `https://runway.dev/errors/${deny.typeSlug}`,
              title: deny.title,
              status: deny.status,
              detail: deny.detail,
            },
            403,
            { "content-type": "application/problem+json" },
          ),
      }),
      (c) => c.text("ok"),
    );

    const res = await app.request("/x");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as { title: string; type: string };
    expect(body.title).toBe("Forbidden");
    expect(body.type).toContain("/forbidden");
  });

  it("resource resolver may be async (e.g. DB lookup)", async () => {
    const OWNER = "01USER0000000000000000AAAA";
    const app = new Hono<Env>();
    app.use("*", withPrincipal(member(["notes:write"], OWNER)));
    app.post(
      "/note/:id",
      requirePermission("notes:write", {
        resource: async () => {
          await Promise.resolve();
          return { ownerId: OWNER };
        },
      }),
      (c) => c.text("ok"),
    );

    const res = await app.request("/note/1", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
