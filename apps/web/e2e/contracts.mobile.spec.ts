/**
 * SPEC-04b mobile e2e (390px) — the ONE mobile spec of row 4b (PLAN-04b §1). Runs once at PROOF (C-04b-007).
 * Relies on C-04b-007's global-setup `seedContracts()`: customer "Cửa hàng Seed" with ONE draft contract (drafts only, so the
 * desktop spec still issues HD-YYYY-001 and sees exactly one item in Chờ tôi duyệt). Projects run desktop THEN mobile
 * (playwright.config order), so the desktop flow's contracts also exist: the card is picked by its customer, the seed draft is untouched.
 * UI contract (same testids as the desktop spec): top bar button "Menu" opens the sidebar; contracts as cards
 * `data-testid="contract-card"` (no `<table>` on screen); drawer `role=dialog` "Chi tiết hợp đồng" full-screen; paper overlay
 * "Văn bản hợp đồng"; touch targets >= 44px.
 */
import { pageAs, test, expect } from "./fixtures";

const SHOTS = process.env["PROOF_SHOTS"] === "1";

test("4b mobile: menu opens, contracts are cards, drawer is full-screen, paper opens, no horizontal scroll", async ({ browser }) => {
  const nv = await pageAs(browser, "staff");
  await nv.setViewportSize({ width: 390, height: 844 });
  const noHScroll = async (): Promise<void> => {
    const overflow = await nv.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  };

  await nv.goto("/hop-dong");
  await expect(nv.getByRole("heading", { level: 1, name: "Tài liệu" })).toBeVisible();
  await expect(nv.getByRole("heading", { level: 1 })).toHaveCount(1);

  // menu (top bar exists on mobile only)
  await nv.getByRole("button", { name: "Menu" }).click();
  await expect(nv.getByTestId("sidebar").getByRole("link", { name: "Mẫu hợp đồng", exact: true })).toBeVisible();
  await nv.keyboard.press("Escape");

  // list = cards, not a table
  // .first(): desktop specs (products.spec) leave more "Cửa hàng Seed" drafts in the shared e2e D1 — any card proves the layout
  const card = nv.getByTestId("contract-card").filter({ hasText: "Cửa hàng Seed" }).filter({ hasText: "Hợp đồng cung cấp dịch vụ phần mềm" }).first(); // row 4: other types for the same customer exist too
  await expect(card).toBeVisible();
  await expect(card).toContainText("Cửa hàng Seed");
  await expect(nv.getByRole("table")).toHaveCount(0);
  const box = await card.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await noHScroll();
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/hop-dong-mobile.png" });

  // drawer full-screen
  await card.click();
  const drawer = nv.getByRole("dialog", { name: "Chi tiết hợp đồng" });
  await expect(drawer).toBeVisible();
  const d = await drawer.boundingBox();
  expect(Math.round(d?.width ?? 0)).toBe(390);
  await noHScroll();

  // paper opens and scrolls inside itself
  await drawer.getByRole("button", { name: "Xem văn bản", exact: true }).click();
  const paper = nv.getByRole("dialog", { name: "Văn bản hợp đồng" });
  await expect(paper.frameLocator("iframe[title='Văn bản hợp đồng']").getByText("NHÁP").first()).toBeVisible();
  await noHScroll();
  await paper.getByRole("button", { name: "Đóng" }).click();
  await expect(paper).toBeHidden(); // Escape below must reach the drawer, not the closing paper
  await nv.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await nv.context().close();
});
