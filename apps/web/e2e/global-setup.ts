/**
 * Seeds the e2e world with signup OFF: the admin goes straight into the isolated e2e D1 (same way `pnpm dev:seed-admin`
 * does: hash + `wrangler d1 execute --local`), then Giám đốc / Quản lý / Nhân viên are created through the REAL API
 * (admin invite -> POST /auth/activate). One saved login per role so specs never burn the login rate limit.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "@playwright/test";
import { hashPassword } from "../../../packages/auth/src/index.ts";
import { generateUlid } from "../../api/src/utils/id.ts";
import { BASE } from "../playwright.config";

export const PASSWORD = "correct-horse-battery-staple";
const ADMIN = { email: "admin@e2e.vn", name: "Quản trị hệ thống", roleId: "01ROLE0000000000000ADMIN00" };
export const USERS = {
  director: { email: "giamdoc@e2e.vn", name: "Trần Giám Đốc", role: "giam_doc" },
  manager: { email: "quanly@e2e.vn", name: "Lê Quản Lý", role: "quan_ly" },
  staff: { email: "nhanvien@e2e.vn", name: "Phạm Nhân Viên", role: "nhan_vien" },
} as const;
export type RoleKey = keyof typeof USERS;
export const stateFile = (r: RoleKey | "admin") => `e2e/.auth/${r}.json`;

const HEADERS = { "content-type": "application/json", origin: BASE, "x-requested-with": "fetch" };
const q = (v: string): string => `'${v.replace(/'/g, "''")}'`;

export function sql(command: string): void {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "runway_dev", "--local", "--persist-to", ".wrangler/e2e", "--command", command], {
    cwd: "../api",
    stdio: "pipe",
  });
}

export default async function globalSetup(): Promise<void> {
  mkdirSync("e2e/.auth", { recursive: true });
  const hash = await hashPassword(PASSWORD);
  sql(
    `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, status, verified_at, created_at, updated_at) ` +
      `VALUES (${q(generateUlid())}, ${q(ADMIN.email)}, ${q(hash)}, ${q(ADMIN.name)}, 'active', unixepoch(), unixepoch(), unixepoch()); ` +
      `INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT id, '${ADMIN.roleId}' FROM users WHERE email = ${q(ADMIN.email)};`,
  );

  const admin = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS });
  const l = await admin.post("/auth/login", { data: { email: ADMIN.email, password: PASSWORD } });
  if (l.status() !== 200) throw new Error(`admin login: ${l.status()} ${await l.text()}`);

  const anon = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS });
  for (const u of Object.values(USERS)) {
    const inv = await admin.post("/admin/users", { data: { email: u.email, display_name: u.name, role: u.role } });
    if (inv.status() !== 201) throw new Error(`invite ${u.email}: ${inv.status()} ${await inv.text()}`);
    const url = new URL(((await inv.json()) as { activation_url: string }).activation_url);
    const act = await anon.post("/auth/activate", { data: { token: url.searchParams.get("token"), password: PASSWORD } });
    if (act.status() !== 204) throw new Error(`activate ${u.email}: ${act.status()} ${await act.text()}`);
  }
  for (const [role, u] of Object.entries(USERS) as Array<[RoleKey, (typeof USERS)[RoleKey]]>) {
    const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS });
    const r = await ctx.post("/auth/login", { data: { email: u.email, password: PASSWORD } });
    if (r.status() !== 200) throw new Error(`login ${u.email}: ${r.status()} ${await r.text()}`);
    await ctx.storageState({ path: stateFile(role) });
    await ctx.dispose();
  }
  await Promise.all([admin.dispose(), anon.dispose()]);
  await seedContracts();
  writeFileSync("e2e/.auth/ready", new Date().toISOString());
}

/** One customer + exactly ONE draft contract (G6 · 1 · 5%), created by the Nhân viên through the real API. Never issued/submitted. */
async function seedContracts(): Promise<void> {
  const nv = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS, storageState: stateFile("staff") });
  const tpls = await nv.get("/templates");
  if (tpls.status() !== 200) throw new Error(`templates: ${tpls.status()} ${await tpls.text()}`);
  const tpl = ((await tpls.json()) as { items: Array<{ id: string; name: string }> }).items.find((t) => t.name === "Hợp đồng cung cấp dịch vụ phần mềm");
  if (!tpl) throw new Error("seed: template not found");
  const cu = await nv.post("/customers", {
    data: { name: "Cửa hàng Seed", contact_person: "Nguyễn Văn Seed", phone: "0901 000 001", email: "seed@example.com", address: "1 Lê Lợi, Q.1, TP.HCM" },
  });
  if (cu.status() !== 201) throw new Error(`seed customer: ${cu.status()} ${await cu.text()}`);
  const customerId = ((await cu.json()) as { id: string }).id;
  const pr = await nv.get("/products?active=true");
  if (pr.status() !== 200) throw new Error(`products: ${pr.status()} ${await pr.text()}`);
  const g6 = ((await pr.json()) as { items: Array<{ id: string; code: string }> }).items.find((p) => p.code === "G6");
  if (!g6) throw new Error("seed: product G6 not found");
  const c = await nv.post("/contracts", {
    headers: { "Idempotency-Key": generateUlid() },
    data: { template_id: tpl.id, customer_id: customerId, lines: [{ product_id: g6.id, qty: 1 }], values: { giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" } },
  });
  if (c.status() !== 201) throw new Error(`seed contract: ${c.status()} ${await c.text()}`);
  await nv.dispose();
}
