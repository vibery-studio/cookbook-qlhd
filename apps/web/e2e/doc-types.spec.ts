/**
 * SPEC-09 desktop e2e — the ONE spec of ROADMAP-02 row 4 (PLAN-09 §1, e2e-kit UI proof budget): AC-12 + the human path of AC-4/6/10.
 * Runs once at PROOF (C-09-010), after the API suite, on the real build via wrangler (:8791). Written before the UI: it FIXES the UI
 * contract cards C-09-008 / C-09-009 must honour. Money, races, guards stay in the API suite
 * (`apps/api/test/integration/doc-types-acceptance.test.ts`). 390 px = human checklist.
 *
 * UI contract:
 * Sidebar link "Tài liệu" (was "Hợp đồng"; route stays /hop-dong); h1 "Tài liệu".
 *   Type tabs role=tablist name "Loại tài liệu": role=tab "Tất cả" · "Báo giá" · "Hợp đồng" · "Đề nghị TT" · "Phiếu xuất kho" (URL `?loai=`
 *   quote|contract|payment_request|delivery_note); the existing status tabs ("Trạng thái hợp đồng") stay below.
 *   Rows `data-testid="contract-row"` gain a type pill `data-testid="type-pill"` (text "Báo giá" · "Hợp đồng" · "Đề nghị TT" · "Phiếu xuất kho")
 *   and the number cell ("Nháp · chưa có số" when null). Empty type tab: "Chưa có báo giá nào" + button "Tạo báo giá".
 * Button "+ Tạo" → role=menu with role=menuitem "Báo giá" · "Hợp đồng" · "Phiếu xuất kho" (no DNTT; hint text in the menu
 *   "Đề nghị thanh toán: lập từ hợp đồng đã phát hành"). Each opens dialog "Tạo báo giá" · "Tạo hợp đồng" · "Tạo phiếu xuất kho"
 *   (template picked by type; same fields as today: "Khách hàng", `line-items`, "Giảm giá (%)", `totals`, button "Tạo & xem văn bản").
 *   "Tạo phiếu xuất kho": combobox options = goods only; no "Giảm giá (%)", no `totals`; fields "Lý do xuất kho", "Xuất tại kho", "Địa điểm".
 *   "Tạo báo giá": no "Chức vụ người ký"; note "Hiệu lực 15 ngày kể từ ngày lập".
 * Drawer URL /hop-dong/<id> (as today). Drawer role=dialog name "Chi tiết <loại>" ("Chi tiết báo giá" · "Chi tiết hợp đồng" · "Chi tiết đề nghị thanh toán" · "Chi tiết phiếu xuất kho");
 *   paper role=dialog "Văn bản <loại>" with `<iframe title="Văn bản <loại>">`; drawer button "Xem văn bản".
 *   BG drawer shows "Hiệu lực đến dd/mm/yyyy" (+ pill "Hết hạn" when past).
 *   Section `data-testid="related-docs"` titled "Tài liệu liên quan": one `data-testid="related-doc"` per parent (↑) / child (↓), text
 *   "<loại> · <số | Nháp · chưa có số> · <trạng thái> · <tổng>"; click → that document's drawer.
 *   Create-child button `data-testid="action-create-child"`: "Lập hợp đồng" (issued BG) · "Lập đề nghị thanh toán" (issued HĐ); locked =
 *   aria-disabled + 🔒 + reason in the footer: "Báo giá đã hết hạn ngày dd/mm/yyyy" · "Đã có <loại> <số|nháp> (<trạng thái>)" ·
 *   "Chỉ lập từ tài liệu đã phát hành" · "Bạn không có quyền lập <loại>".
 *   → dialog "Lập hợp đồng từ báo giá <số>": read-only line table with 🔒 "Giữ giá báo giá <số>", totals, field "Chức vụ người ký",
 *     button "Tạo & xem văn bản" · dialog "Lập đề nghị thanh toán": "Số tiền đề nghị" (= HĐ total), "Hạn thanh toán" (dd/mm/yyyy), same button.
 *   Child draft drawer: edit form shows lines locked (🔒 "Giữ giá báo giá <số>"), no "Giảm giá (%)" input.
 * Accounts: global-setup USERS — staff (Nhân viên) creates · manager (Quản lý) approves + issues. Leaves 1 BG, 1 HĐ, 1 DNTT, 1 PXK issued
 * — runs after contracts.spec / products.spec, before rbac-advanced / roles / shell (none of them count documents by type).
 */
import type { Page } from "@playwright/test";
import { pageAs, test, expect } from "./fixtures";

const SHOTS = process.env["PROOF_SHOTS"] === "1";
const YEAR = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(new Date());

async function openCreate(page: Page, kind: "Báo giá" | "Hợp đồng" | "Phiếu xuất kho") {
  await page.getByRole("button", { name: "+ Tạo", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: kind, exact: true }).click();
}

async function pickCustomer(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByRole("combobox", { name: "Khách hàng" }).click();
  await dialog.getByRole("combobox", { name: "Khách hàng" }).fill("Seed");
  await dialog.getByRole("option", { name: /Cửa hàng Seed/ }).click();
}

/** Staff submits from the open drawer (URL /hop-dong/<id>); the manager opens the same URL, approves + issues; returns the manager's drawer. */
async function approveAndIssue(nv: Page, nvDrawer: ReturnType<Page["getByRole"]>, ql: Page, drawerName: string) {
  await expect(nv).toHaveURL(/\/hop-dong\/[0-9A-Z]{26}/);
  const id = new URL(nv.url()).pathname.split("/")[2]!;
  await nvDrawer.getByTestId("action-submit").click();
  await expect(nvDrawer).toContainText("Chờ duyệt");
  await ql.goto(`/hop-dong/${id}`);
  const qDrawer = ql.getByRole("dialog", { name: drawerName });
  await qDrawer.getByTestId("action-approve").click();
  await expect(qDrawer).toContainText("Đã duyệt");
  await qDrawer.getByTestId("action-issue").click();
  await ql.getByRole("dialog", { name: "Xác nhận" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(qDrawer).toContainText("Đã phát hành");
  return qDrawer;
}

test("SPEC-09: BG → HĐ (giữ giá) → DNTT, plus a PXK; each type numbers itself; drawers link parent ↔ child; type tabs filter", async ({ browser }) => {
  test.setTimeout(240_000);
  const nv = await pageAs(browser, "staff");
  const ql = await pageAs(browser, "manager");

  // ---- Nhân viên: "Tài liệu" → + Tạo → Báo giá (G6 × 1, −5%) ----
  await nv.goto("/hop-dong");
  await nv.getByTestId("sidebar").getByRole("link", { name: "Tài liệu", exact: true }).click();
  await expect(nv.getByRole("heading", { level: 1, name: "Tài liệu" })).toBeVisible();
  const typeTabs = nv.getByRole("tablist", { name: "Loại tài liệu" });
  for (const tab of ["Tất cả", "Báo giá", "Hợp đồng", "Đề nghị TT", "Phiếu xuất kho"]) await expect(typeTabs.getByRole("tab", { name: tab })).toBeVisible();
  await nv.getByRole("button", { name: "+ Tạo", exact: true }).click();
  await expect(nv.getByRole("menu")).toContainText("Đề nghị thanh toán: lập từ hợp đồng đã phát hành");
  await expect(nv.getByRole("menu").getByRole("menuitem", { name: /Đề nghị/ })).toHaveCount(0);
  await nv.keyboard.press("Escape");

  await openCreate(nv, "Báo giá");
  const bgForm = nv.getByRole("dialog", { name: "Tạo báo giá" });
  await pickCustomer(bgForm);
  await bgForm.getByTestId("line-items").getByRole("combobox", { name: "Sản phẩm dòng 1" }).fill("G6");
  await bgForm.getByRole("option", { name: /G6/ }).first().click();
  await bgForm.getByTestId("line-items").getByLabel("Số lượng dòng 1").fill("1");
  await bgForm.getByLabel("Giảm giá (%)").fill("5");
  await expect(bgForm.getByTestId("totals")).toContainText("2.565.000");
  await expect(bgForm).toContainText("Hiệu lực 15 ngày kể từ ngày lập");
  await expect(bgForm.getByLabel("Chức vụ người ký")).toHaveCount(0);
  await bgForm.getByRole("button", { name: "Tạo & xem văn bản" }).click();
  await nv.getByRole("dialog", { name: "Văn bản báo giá" }).getByRole("button", { name: "Đóng" }).click();
  const bgDrawer = nv.getByRole("dialog", { name: "Chi tiết báo giá" });
  await expect(bgDrawer).toContainText("Nháp · chưa có số");
  await expect(bgDrawer).toContainText(/Hiệu lực đến \d{2}\/\d{2}\/\d{4}/);
  await expect(bgDrawer.getByTestId("action-create-child")).toHaveAttribute("aria-disabled", "true");
  await expect(bgDrawer).toContainText("Chỉ lập từ tài liệu đã phát hành");

  // ---- Quản lý approves + issues BG ----
  const qBg = await approveAndIssue(nv, bgDrawer, ql, "Chi tiết báo giá");
  const bgNumber = new RegExp(`BG-${YEAR}-\\d{3}`);
  await expect(qBg).toContainText(bgNumber);
  const bgNo = (await qBg.textContent())!.match(bgNumber)![0];

  // ---- Nhân viên: BG drawer → Lập hợp đồng (lines + price locked) ----
  await nv.goto("/hop-dong?loai=quote");
  await expect(nv.getByTestId("contract-row").getByTestId("type-pill").first()).toHaveText("Báo giá");
  for (const pill of await nv.getByTestId("contract-row").getByTestId("type-pill").allTextContents()) expect(pill).toBe("Báo giá");
  await nv.getByTestId("contract-row").filter({ hasText: bgNo }).click();
  const bgIssued = nv.getByRole("dialog", { name: "Chi tiết báo giá" });
  await expect(bgIssued.getByTestId("action-create-child")).toHaveText(/Lập hợp đồng/);
  await bgIssued.getByTestId("action-create-child").click();
  const hdForm = nv.getByRole("dialog", { name: `Lập hợp đồng từ báo giá ${bgNo}` });
  await expect(hdForm).toContainText(`Giữ giá báo giá ${bgNo}`);
  await expect(hdForm).toContainText("2.700.000");
  await expect(hdForm).toContainText("2.565.000");
  await expect(hdForm.getByLabel("Giảm giá (%)")).toHaveCount(0);
  await hdForm.getByLabel("Chức vụ người ký").fill("Chủ hộ kinh doanh");
  await hdForm.getByRole("button", { name: "Tạo & xem văn bản" }).click();
  const hdPaper = nv.getByRole("dialog", { name: "Văn bản hợp đồng" });
  await expect(hdPaper.frameLocator("iframe[title='Văn bản hợp đồng']").getByText(`Căn cứ báo giá số ${bgNo}`, { exact: false }).first()).toBeVisible();
  await hdPaper.getByRole("button", { name: "Đóng" }).click();
  const hdDrawer = nv.getByRole("dialog", { name: "Chi tiết hợp đồng" });
  await expect(hdDrawer.getByTestId("related-docs")).toContainText("Tài liệu liên quan");
  await expect(hdDrawer.getByTestId("related-doc").filter({ hasText: bgNo })).toContainText("Báo giá");
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/hd-tu-bao-gia.png" });

  // the BG now shows its child and locks a second HĐ
  await hdDrawer.getByTestId("related-doc").filter({ hasText: bgNo }).click();
  const bgAgain = nv.getByRole("dialog", { name: "Chi tiết báo giá" });
  await expect(bgAgain.getByTestId("related-doc").filter({ hasText: "Hợp đồng" })).toContainText("Nháp · chưa có số");
  await expect(bgAgain.getByTestId("action-create-child")).toHaveAttribute("aria-disabled", "true");
  await expect(bgAgain).toContainText(/Đã có hợp đồng .*\(Nháp\)/);
  await bgAgain.getByTestId("related-doc").filter({ hasText: "Hợp đồng" }).click();

  // ---- Quản lý approves + issues HĐ ----
  const hdOpen = nv.getByRole("dialog", { name: "Chi tiết hợp đồng" });
  const qHd = await approveAndIssue(nv, hdOpen, ql, "Chi tiết hợp đồng");
  const hdNumber = new RegExp(`HD-${YEAR}-\\d{3}`);
  await expect(qHd).toContainText(hdNumber);
  const hdNo = (await qHd.textContent())!.match(hdNumber)![0];

  // ---- Nhân viên: HĐ drawer → Lập đề nghị thanh toán (amount = HĐ total, due = +7) ----
  await nv.goto("/hop-dong?loai=contract");
  await nv.getByTestId("contract-row").filter({ hasText: hdNo }).click();
  const hdIssued = nv.getByRole("dialog", { name: "Chi tiết hợp đồng" });
  await expect(hdIssued.getByTestId("action-create-child")).toHaveText(/Lập đề nghị thanh toán/);
  await hdIssued.getByTestId("action-create-child").click();
  const dnForm = nv.getByRole("dialog", { name: "Lập đề nghị thanh toán" });
  await expect(dnForm).toContainText("Số tiền đề nghị");
  await expect(dnForm).toContainText("2.565.000");
  await expect(dnForm).toContainText(/Hạn thanh toán.*\d{2}\/\d{2}\/\d{4}/);
  await dnForm.getByRole("button", { name: "Tạo & xem văn bản" }).click();
  const dnPaper = nv.getByRole("dialog", { name: "Văn bản đề nghị thanh toán" });
  const dnFrame = dnPaper.frameLocator("iframe[title='Văn bản đề nghị thanh toán']");
  await expect(dnFrame.getByText(`Căn cứ hợp đồng số ${hdNo}`, { exact: false }).first()).toBeVisible();
  await expect(dnFrame.getByText("0071 0004 58213", { exact: false }).first()).toBeVisible();
  await dnPaper.getByRole("button", { name: "Đóng" }).click();
  const dnDrawer = nv.getByRole("dialog", { name: "Chi tiết đề nghị thanh toán" });
  await expect(dnDrawer.getByTestId("related-doc").filter({ hasText: hdNo })).toContainText("Hợp đồng");
  const qDn = await approveAndIssue(nv, dnDrawer, ql, "Chi tiết đề nghị thanh toán");
  await expect(qDn).toContainText(new RegExp(`DNTT-${YEAR}-\\d{3}`));

  // ---- Nhân viên: + Tạo → Phiếu xuất kho (goods only, no discount) ----
  await nv.goto("/hop-dong");
  await openCreate(nv, "Phiếu xuất kho");
  const pxkForm = nv.getByRole("dialog", { name: "Tạo phiếu xuất kho" });
  await pickCustomer(pxkForm);
  await expect(pxkForm.getByLabel("Giảm giá (%)")).toHaveCount(0);
  await expect(pxkForm.getByTestId("totals")).toHaveCount(0);
  await pxkForm.getByTestId("line-items").getByRole("combobox", { name: "Sản phẩm dòng 1" }).fill("G6");
  await expect(pxkForm.getByRole("option", { name: /G6/ })).toHaveCount(0); // services are not offered
  await pxkForm.getByTestId("line-items").getByRole("combobox", { name: "Sản phẩm dòng 1" }).fill("DEMO-MIN");
  await pxkForm.getByRole("option", { name: /DEMO-MIN-01/ }).click();
  await pxkForm.getByTestId("line-items").getByLabel("Số lượng dòng 1").fill("2");
  await pxkForm.getByLabel("Lý do xuất kho").fill("Giao máy in cho cửa hàng");
  await pxkForm.getByLabel("Xuất tại kho").fill("Kho Phú Nhuận (DEMO)");
  await pxkForm.getByRole("button", { name: "Tạo & xem văn bản" }).click();
  const pxkPaper = nv.getByRole("dialog", { name: "Văn bản phiếu xuất kho" });
  await expect(pxkPaper.frameLocator("iframe[title='Văn bản phiếu xuất kho']").getByText("PHIẾU XUẤT KHO").first()).toBeVisible();
  await pxkPaper.getByRole("button", { name: "Đóng" }).click();
  const pxkDrawer = nv.getByRole("dialog", { name: "Chi tiết phiếu xuất kho" });
  const qPxk = await approveAndIssue(nv, pxkDrawer, ql, "Chi tiết phiếu xuất kho");
  await expect(qPxk).toContainText(new RegExp(`PXK-${YEAR}-\\d{3}`));
  if (SHOTS) await ql.screenshot({ path: "e2e/shots/phieu-xuat-kho.png" });

  // ---- type tabs filter ----
  await nv.goto("/hop-dong");
  await nv.getByRole("tablist", { name: "Loại tài liệu" }).getByRole("tab", { name: "Phiếu xuất kho" }).click();
  await expect(nv).toHaveURL(/loai=delivery_note/);
  for (const pill of await nv.getByTestId("contract-row").getByTestId("type-pill").allTextContents()) expect(pill).toBe("Phiếu xuất kho");
  await nv.getByRole("tablist", { name: "Loại tài liệu" }).getByRole("tab", { name: "Tất cả" }).click();
  await expect(nv.getByTestId("contract-row").getByTestId("type-pill").filter({ hasText: "Đề nghị TT" }).first()).toBeVisible();
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/tai-lieu.png" });
});
