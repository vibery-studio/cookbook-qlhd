/**
 * Seeds the e2e world through the real API (signup → login) plus the two
 * things only an operator can do locally (mark verified, grant a role) via
 * `wrangler d1 execute` on the e2e persist dir. Saves one storageState per
 * role so specs never burn the login rate limit.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "@playwright/test";
import { BASE } from "../playwright.config";

export const PASSWORD = "correct-horse-battery-staple";
export const USERS = {
  director: { email: "giamdoc@e2e.vn", roleId: "01ROLE0000000000000ADMIN00" },
  manager: { email: "quanly@e2e.vn", roleId: "01ROLE00000000000MANAGER00" },
  staff: { email: "nhanvien@e2e.vn", roleId: "01ROLE0000000000000STAFF00" },
} as const;
export type RoleKey = keyof typeof USERS;
export const stateFile = (r: RoleKey) => `e2e/.auth/${r}.json`;

const HEADERS = { "content-type": "application/json", origin: BASE, "x-requested-with": "fetch" };

export function sql(command: string): void {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "runway_dev", "--local", "--persist-to", ".wrangler/e2e", "--command", command], {
    cwd: "../api",
    stdio: "pipe",
  });
}

export default async function globalSetup(): Promise<void> {
  mkdirSync("e2e/.auth", { recursive: true });
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "runway_dev", "--local", "--persist-to", ".wrangler/e2e", "--file", "../../scripts/seed-demo.sql"], {
    cwd: "../api",
    stdio: "pipe",
  });
  const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS });
  for (const u of Object.values(USERS)) {
    const r = await api.post("/auth/signup", { data: { email: u.email, password: PASSWORD } });
    if (r.status() !== 201) throw new Error(`signup ${u.email}: ${r.status()} ${await r.text()}`);
    sql(`UPDATE users SET verified_at = unixepoch(), status = 'active' WHERE email = '${u.email}'`);
    sql(`INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT id, '${u.roleId}' FROM users WHERE email = '${u.email}'`);
  }
  for (const [role, u] of Object.entries(USERS) as Array<[RoleKey, (typeof USERS)[RoleKey]]>) {
    const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS });
    const r = await ctx.post("/auth/login", { data: { email: u.email, password: PASSWORD } });
    if (r.status() !== 200) throw new Error(`login ${u.email}: ${r.status()}`);
    if (role === "director") {
      for (const [key, value] of [
        ["company.name", "Công ty TNHH Nhật Minh"],
        ["company.representative", "Trần Nhật Minh"],
        ["company.representative_title", "Giám đốc"],
      ]) {
        const s = await ctx.put(`/admin/settings/${key}`, { data: { value } });
        if (s.status() !== 200) throw new Error(`setting ${key}: ${s.status()}`);
      }
    }
    await ctx.storageState({ path: stateFile(role) });
    await ctx.dispose();
  }
  await seedContracts();
  await api.dispose();
  writeFileSync("e2e/.auth/ready", new Date().toISOString());
}

/** One contract per status (draft · pending · approved · issued) for "Khách sạn Biển Xanh" — never the checklist's customer. */
async function seedContracts(): Promise<void> {
  const as = (r: RoleKey) => request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS, storageState: stateFile(r) });
  const staff = await as("staff");
  const manager = await as("manager");
  const director = await as("director");
  const templates = (await (await staff.get("/templates")).json()) as { items: Array<{ id: string; name: string }> };
  const customers = (await (await staff.get("/customers")).json()) as { items: Array<{ id: string; name: string }> };
  const tpl = templates.items.find((t) => t.name === "Dịch vụ tư vấn")!.id;
  const cus = customers.items.find((c) => c.name === "Khách sạn Biển Xanh")!.id;
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await staff.post("/contracts", {
      data: {
        template_id: tpl,
        customer_id: cus,
        // #1 is deliberately long (real titles are): the list must truncate, never wrap past --row-h.
        title: i === 0 ? "Hợp đồng dịch vụ tư vấn vận hành hệ thống đặt phòng và quản lý kho — Khách sạn Biển Xanh 1" : `Hợp đồng tư vấn Biển Xanh ${i + 1}`,
        values: { chuc_vu_nguoi_ky: "Giám đốc", thoi_han_thang: 6, pham_vi_cong_viec: "Tư vấn vận hành" },
        line_items: [{ description: "Phí tư vấn", qty: 1, unit_price: 72_000_000 + i * 1_000_000, discount_bps: 0 }],
      },
    });
    if (r.status() !== 201) throw new Error(`seed contract: ${r.status()} ${await r.text()}`);
    ids.push(((await r.json()) as { id: string }).id);
  }
  const post = async (ctx: typeof staff, path: string, data: unknown = {}) => {
    const r = await ctx.post(path, { data });
    if (r.status() >= 300) throw new Error(`${path}: ${r.status()} ${await r.text()}`);
  };
  for (const id of ids.slice(1)) await post(staff, `/contracts/${id}/submit`);
  for (const id of ids.slice(2)) await post(manager, `/contracts/${id}/approve`);
  await post(director, `/contracts/${ids[3]}/issue`);
  await Promise.all([staff.dispose(), manager.dispose(), director.dispose()]);
}
