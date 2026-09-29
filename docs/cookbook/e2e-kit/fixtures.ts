/** Role-scoped pages + small helpers shared by the e2e specs. */
import { test as base, expect, type Browser, type Page } from "@playwright/test";
import { stateFile, type RoleKey } from "./global-setup";

export async function pageAs(browser: Browser, role: RoleKey): Promise<Page> {
  const ctx = await browser.newContext({ storageState: stateFile(role), locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  return ctx.newPage();
}

export const test = base;
export { expect };

/** Open a sidebar screen by its Vietnamese label. */
export async function openScreen(page: Page, label: "Hợp đồng" | "Mẫu hợp đồng" | "Chờ tôi duyệt" | "Khách hàng" | "Phân quyền" | "Nhật ký"): Promise<void> {
  await page.getByTestId("sidebar").getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
}
