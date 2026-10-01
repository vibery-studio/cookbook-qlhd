/**
 * SPEC-07 desktop e2e — the ONE spec of ROADMAP-02 row 2b (PLAN-07 §1, e2e-kit UI proof budget): AC-12.
 * Runs once at PROOF (C-07-009), after the API suite, on the real build via wrangler (:8791). Written before the UI: it FIXES
 * the UI contract cards C-07-007 / C-07-008 must honour. Races, expiry, cron, SoD 409s stay in the API suite
 * (`apps/api/test/integration/rbac-advanced-acceptance.test.ts`). 390 px (drawer/modal full screen) = human checklist.
 *
 * UI contract:
 * /phan-quyen — tabs (role=tab): "Ma trận" · "Yêu cầu đổi quyền" (pending count in its name when > 0) · "Cặp xung đột".
 *   Role drawer (dialog "Vai trò · <label>", SPEC-06): permission edits are SENT, not saved — submit button "Gửi yêu cầu (−1)" /
 *   "Gửi yêu cầu (+2 · −1)" (U+2212); label/description keep "Lưu". After sending, the drawer shows the band
 *   `data-testid="pending-band"`: "Đang chờ duyệt: −1 — do «<name>» gửi, hết hạn dd/mm"; permission checkboxes disabled with
 *   🔒 "Đang có yêu cầu chờ duyệt"; for the requester: 🔒 "Bạn gửi yêu cầu này — cần người khác duyệt" + button "Rút yêu cầu";
 *   for another roles:write holder: buttons "Duyệt" · "Từ chối" (Từ chối asks a reason).
 *   Tab "Yêu cầu đổi quyền": table `data-testid="change-requests"` (Vai trò · Thay đổi · Người gửi · Gửi lúc · Hết hạn · Trạng thái);
 *   a pending row has "Duyệt" · "Từ chối" for others; status pill "Chờ duyệt" / "Đã duyệt"; empty → "Không có yêu cầu nào đang chờ.".
 *   Nav "Phân quyền" badge `nav-badge-roles` = pending requests the caller may approve.
 * /nguoi-dung — Giám đốc (jit:grant): row button "Cấp quản trị tạm thời" → dialog "Cấp quản trị tạm thời · <name>": field "Lý do",
 *   select "Thời hạn" (options "15 phút" … "8 giờ", incl. "1 giờ"), text "Tự thu hồi lúc HH:MM", hint "Không ghi thông tin cá nhân",
 *   submit "Cấp quyền". Then the row shows a chip "Quản trị tạm · còn …" + button "Thu hồi ngay". Own row: 🔒 "Không tự cấp cho mình".
 * JIT recipient — banner `data-testid="jit-banner"`: "Bạn đang có quyền quản trị tạm thời — hết hạn lúc HH:MM" + button "Kết thúc sớm";
 *   the sidebar follows the admin permissions (Người dùng shown, Hợp đồng gone) and comes back after "Kết thúc sớm".
 * /ra-soat-quyen — nav "Rà soát quyền" (HỆ THỐNG; reviews:write or roles:write); h1 "Rà soát quyền"; no review →
 *   "Chưa có đợt rà soát quý này" + button "Bắt đầu rà soát"; header "Đợt Qn/YYYY · hạn dd/mm · x/y dòng";
 *   table `data-testid="review-table"`, per row "Giữ" · "Gỡ"; own row 🔒 "Không tự rà soát chính mình".
 * Accounts: global-setup USERS director · staff · manager (Quản lý role edited), plus the seeded admin (logged in here through
 * the API: global-setup saves no admin state). State is restored at the end: Quản lý gets "Xem nhật ký" back (request + approve),
 * the JIT grant is ended by its recipient — roles.spec.ts and shell.smoke.spec.ts run after this file.
 */
import type { Browser, Page } from "@playwright/test";
import { pageAs, test, expect, openScreen } from "./fixtures";
import { PASSWORD, USERS } from "./global-setup";
import { BASE } from "../playwright.config";

const SHOTS = process.env["PROOF_SHOTS"] === "1";
const ADMIN_EMAIL = "admin@e2e.vn"; // global-setup ADMIN
const API_HEADERS = { "X-Requested-With": "fetch", "content-type": "application/json" };

async function adminPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const login = await ctx.request.post(`${BASE}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: PASSWORD },
    headers: { origin: BASE, "x-requested-with": "fetch" },
  });
  expect(login.status()).toBe(200);
  return ctx.newPage();
}

test("SPEC-07: Giám đốc sends a permission change, admin approves it from the Yêu cầu tab; Giám đốc grants temporary admin, the recipient sees the banner and ends it; review starts", async ({
  browser,
}) => {
  test.setTimeout(150_000);

  // ---- Giám đốc: drop "Xem nhật ký" from Quản lý → a REQUEST, nothing changes yet ----
  const gd = await pageAs(browser, "director");
  await gd.goto("/phan-quyen");
  await expect(gd.getByRole("heading", { level: 1, name: "Phân quyền" })).toBeVisible();
  await expect(gd.getByRole("tab", { name: /^Ma trận/ })).toBeVisible();
  await expect(gd.getByRole("tab", { name: /^Cặp xung đột/ })).toBeVisible();
  const col = (label: string) => gd.getByTestId("roles-matrix").getByTestId("role-col").filter({ hasText: new RegExp(`^${label}`) });

  await col("Quản lý").click();
  const qlDrawer = gd.getByRole("dialog", { name: "Vai trò · Quản lý" });
  await expect(qlDrawer).toBeVisible();
  await qlDrawer.getByRole("checkbox", { name: /Xem nhật ký/ }).uncheck();
  await expect(qlDrawer.getByRole("button", { name: /^Lưu \(/ })).toHaveCount(0); // permissions are never saved directly (DEC-1)
  await qlDrawer.getByRole("button", { name: "Gửi yêu cầu (−1)" }).click();

  const band = qlDrawer.getByTestId("pending-band");
  await expect(band).toContainText("Đang chờ duyệt: −1");
  await expect(band).toContainText(`do «${USERS.director.name}» gửi`);
  await expect(qlDrawer).toContainText("Bạn gửi yêu cầu này — cần người khác duyệt");
  await expect(qlDrawer.getByRole("button", { name: "Rút yêu cầu" })).toBeVisible();
  await expect(qlDrawer.getByRole("button", { name: "Duyệt" })).toHaveCount(0);
  await expect(qlDrawer.getByRole("checkbox", { name: /Phát hành & hủy/ })).toBeDisabled();
  if (SHOTS) await gd.screenshot({ path: "e2e/shots/phan-quyen-yeu-cau.png" });
  // not applied yet
  const before = await gd.evaluate(async () => {
    const body = (await (await fetch("/roles")).json()) as { items: Array<{ name: string; permissions: string[] }> };
    return body.items.find((x) => x.name === "quan_ly")?.permissions ?? [];
  });
  expect(before).toContain("audit:read");
  await gd.keyboard.press("Escape");

  // ---- admin: nav badge, Yêu cầu tab → Duyệt ----
  const ad = await adminPage(browser);
  await ad.goto("/phan-quyen");
  await expect(ad.getByTestId("nav-badge-roles")).toHaveText("1");
  await ad.getByRole("tab", { name: /^Yêu cầu đổi quyền/ }).click();
  const reqRow = ad.getByTestId("change-requests").getByRole("row").filter({ hasText: "Quản lý" });
  await expect(reqRow).toContainText("Chờ duyệt");
  await expect(reqRow).toContainText(USERS.director.name);
  if (SHOTS) await ad.screenshot({ path: "e2e/shots/yeu-cau-doi-quyen.png" });
  await reqRow.getByRole("button", { name: "Duyệt" }).click();
  await expect(reqRow).toContainText("Đã duyệt");
  await expect(ad.getByTestId("nav-badge-roles")).toHaveCount(0);
  const after = await ad.evaluate(async () => {
    const body = (await (await fetch("/roles")).json()) as { items: Array<{ name: string; permissions: string[] }> };
    return body.items.find((x) => x.name === "quan_ly")?.permissions ?? [];
  });
  expect(after).not.toContain("audit:read");
  expect(after).toContain("contract:issue");

  // ---- Giám đốc: temporary admin for the Nhân viên ----
  await openScreen(gd, "Người dùng");
  const own = gd.getByTestId("users-table").getByRole("row").filter({ hasText: USERS.director.email });
  await expect(own).toContainText("Không tự cấp cho mình");
  const staffRow = gd.getByTestId("users-table").getByRole("row").filter({ hasText: USERS.staff.email });
  await staffRow.getByRole("button", { name: "Cấp quản trị tạm thời" }).click();
  const grant = gd.getByRole("dialog", { name: `Cấp quản trị tạm thời · ${USERS.staff.name}` });
  await expect(grant).toContainText("Không ghi thông tin cá nhân");
  await grant.getByLabel("Lý do").fill("Sửa cấu hình email khi quản trị nghỉ phép");
  await grant.getByLabel("Thời hạn").selectOption({ label: "1 giờ" });
  await expect(grant).toContainText(/Tự thu hồi lúc \d{2}:\d{2}/);
  if (SHOTS) await gd.screenshot({ path: "e2e/shots/cap-quan-tri-tam.png" });
  await grant.getByRole("button", { name: "Cấp quyền" }).click();
  await expect(grant).toBeHidden();
  await expect(staffRow).toContainText("Quản trị tạm · còn");
  await expect(staffRow.getByRole("button", { name: "Thu hồi ngay" })).toBeVisible();

  // ---- the recipient: banner, admin menu, then "Kết thúc sớm" ----
  const nv = await pageAs(browser, "staff");
  await nv.goto("/");
  const banner = nv.getByTestId("jit-banner");
  await expect(banner).toContainText(/Bạn đang có quyền quản trị tạm thời — hết hạn lúc \d{2}:\d{2}/);
  const sidebar = nv.getByTestId("sidebar");
  await expect(sidebar.getByRole("link", { name: "Người dùng", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Tài liệu", exact: true })).toHaveCount(0); // DEC-6: only admin, not admin + own role
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/jit-banner.png" });
  await banner.getByRole("button", { name: "Kết thúc sớm" }).click();
  await expect(banner).toBeHidden();
  await expect(sidebar.getByRole("link", { name: "Tài liệu", exact: true })).toBeVisible();
  await nv.context().close();

  // ---- Giám đốc: start this quarter's review; own row is 🔒 ----
  await gd.getByTestId("sidebar").getByRole("link", { name: "Rà soát quyền", exact: true }).click();
  await expect(gd.getByRole("heading", { level: 1, name: "Rà soát quyền" })).toBeVisible();
  await expect(gd.getByText("Chưa có đợt rà soát quý này")).toBeVisible();
  await gd.getByRole("button", { name: "Bắt đầu rà soát" }).click();
  await expect(gd.getByText(/Đợt Q[1-4]\/\d{4}/)).toBeVisible();
  const table = gd.getByTestId("review-table");
  await expect(table.getByRole("row").filter({ hasText: USERS.director.name })).toContainText("Không tự rà soát chính mình");
  const mgrRow = table.getByRole("row").filter({ hasText: USERS.manager.name });
  await mgrRow.getByRole("button", { name: "Giữ" }).click();
  await expect(mgrRow).toContainText("Giữ");
  if (SHOTS) await gd.screenshot({ path: "e2e/shots/ra-soat-quyen.png" });

  // ---- restore Quản lý (later specs edit it): request + approve through the API ----
  const reqId = await gd.evaluate(async (headers) => {
    const body = (await (await fetch("/roles")).json()) as { items: Array<{ id: string; name: string; version: number; permissions: string[] }> };
    const ql = body.items.find((x) => x.name === "quan_ly");
    if (ql === undefined) return "";
    const r = await fetch(`/roles/${ql.id}/change-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expected_version: ql.version, permissions: [...ql.permissions, "audit:read"] }),
    });
    return ((await r.json()) as { id?: string }).id ?? "";
  }, API_HEADERS);
  expect(reqId).not.toBe("");
  const approved = await ad.evaluate(
    async ({ id, headers }) => (await fetch(`/role-change-requests/${id}/approve`, { method: "POST", headers, body: "{}" })).status,
    { id: reqId, headers: API_HEADERS },
  );
  expect(approved).toBe(200);
  await ad.context().close();
  await gd.context().close();
});
