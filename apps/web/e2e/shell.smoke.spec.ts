/**
 * SPEC-04a smoke — the ONE UI spec of row 4a (PLAN-04a §1, e2e-kit UI proof budget). Runs once at PROOF (C-04a-006),
 * on the real build served by wrangler (:8791), after the API suite.
 * NOT compilable yet: needs the scaffold (C-04a-001: apps/web/package.json, @playwright/test, tsconfig) and
 * `./fixtures` + `./global-setup` + `../playwright.config` copied from docs/cookbook/e2e-kit (C-04a-006).
 * UI contract this spec fixes for cards 002-005 (labels are Vietnamese, exact):
 *   sidebar `data-testid="sidebar"` with links "Khách hàng" · "Phân quyền" · "Nhật ký" · "Người dùng" (hidden without permission);
 *   h1 = screen name; button "+ Thêm khách"; modal role=dialog "Thêm khách" with fields "Tên khách hàng" · "Số điện thoại" ·
 *   button "Lưu"; duplicate warning role=alert containing "Đã có khách dùng SĐT/MST này" + button "Xem khách đó";
 *   403 screen: role=alert/region containing 🔒 and "Bạn không có quyền"; audit rows `data-testid="audit-row"`.
 * Roles come from global-setup `USERS`: director (Giám đốc) · staff (Nhân viên).
 */
import { pageAs, test, expect, openScreen } from "./fixtures";

const SHOTS = process.env["PROOF_SHOTS"] === "1";
const DUP_TEXT = "Đã có khách dùng SĐT/MST này";

test("4a smoke: Giám đốc adds a customer, sees the duplicate warning, finds it in Nhật ký; Nhân viên gets 403 on /nhat-ky", async ({ browser }) => {
  // ---- Giám đốc (has contract:write + audit:read) ----
  const gd = await pageAs(browser, "director");
  const consoleLines: string[] = [];
  gd.on("console", (m) => consoleLines.push(m.text()));

  await gd.goto("/khach-hang");
  await expect(gd.getByRole("heading", { level: 1, name: "Khách hàng" })).toBeVisible();
  if (SHOTS) await gd.screenshot({ path: "e2e/shots/khach-hang.png" });

  // 1st customer
  await gd.getByRole("button", { name: "+ Thêm khách" }).click();
  const dialog = gd.getByRole("dialog", { name: "Thêm khách" });
  await dialog.getByLabel("Tên khách hàng").fill("Cửa hàng Hoa Mai");
  await dialog.getByLabel("Số điện thoại").fill("0901 234 567");
  await dialog.getByRole("button", { name: "Lưu" }).click();
  await expect(dialog).toBeHidden();
  await expect(gd.getByText("Cửa hàng Hoa Mai")).toBeVisible();

  // 2nd customer, same phone in another shape -> Vietnamese duplicate warning, modal stays open with typed content
  await gd.getByRole("button", { name: "+ Thêm khách" }).click();
  const dialog2 = gd.getByRole("dialog", { name: "Thêm khách" });
  await dialog2.getByLabel("Tên khách hàng").fill("Hoa Mai chi nhánh 2");
  await dialog2.getByLabel("Số điện thoại").fill("+84901234567");
  await dialog2.getByRole("button", { name: "Lưu" }).click();
  await expect(dialog2.getByRole("alert")).toContainText(DUP_TEXT);
  await expect(dialog2.getByRole("alert")).toContainText("Cửa hàng Hoa Mai");
  await expect(dialog2.getByLabel("Tên khách hàng")).toHaveValue("Hoa Mai chi nhánh 2");
  await expect(dialog2.getByRole("alert")).not.toContainText(/duplicate|Conflict|409/i);
  await dialog2.getByRole("button", { name: "Xem khách đó" }).click();
  // the name is in the alert AND the loaded card: assert the loaded card, not an ambiguous text
  await expect(gd.getByRole("dialog").getByRole("heading", { name: "Cửa hàng Hoa Mai" })).toBeVisible();
  await gd.keyboard.press("Escape");

  // Phân quyền (readable by every role) — screenshot only
  if (SHOTS) {
    await openScreen(gd, "Phân quyền");
    await gd.screenshot({ path: "e2e/shots/phan-quyen.png" });
  }

  // Nhật ký: the creation is there, and it is a Vietnamese sentence, not a raw code alone
  await openScreen(gd, "Nhật ký");
  const created = gd.getByTestId("audit-row").filter({ hasText: "customer.created" }).first();
  await expect(created).toBeVisible();
  await expect(created).toContainText(/Giám đốc|Nguyễn|giamdoc/i); // actor shown
  if (SHOTS) await gd.screenshot({ path: "e2e/shots/nhat-ky.png" });

  // token / customer data never reach the console or web storage (AC-4)
  expect(consoleLines.join("\n")).not.toMatch(/0901|Hoa Mai|token/i);
  const stored = await gd.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toMatch(/token|runway_|eyJ/i);
  await gd.context().close();

  // ---- Nhân viên (no audit:read): nav hidden, direct URL -> 403 screen, no GET /audit ----
  const nv = await pageAs(browser, "staff");
  const auditCalls: string[] = [];
  nv.on("request", (r) => {
    if (new URL(r.url()).pathname === "/audit") auditCalls.push(r.url());
  });
  await nv.goto("/khach-hang");
  await expect(nv.getByRole("heading", { level: 1, name: "Khách hàng" })).toBeVisible();
  await expect(nv.getByTestId("sidebar").getByRole("link", { name: "Nhật ký", exact: true })).toHaveCount(0);
  await expect(nv.getByTestId("sidebar").getByRole("link", { name: "Người dùng", exact: true })).toHaveCount(0);

  await nv.goto("/nhat-ky");
  await expect(nv.getByText("🔒")).toBeVisible();
  await expect(nv.getByText(/Bạn không có quyền/)).toBeVisible();
  expect(auditCalls).toEqual([]);
  await nv.context().close();
});
