/**
 * SPEC-04b desktop e2e — the ONE desktop spec of row 4b (PLAN-04b §1, e2e-kit UI proof budget). Runs once at PROOF
 * (C-04b-007), on the real build via wrangler (:8791), after the API suite. Written before the UI: it FIXES the UI contract
 * cards 002-006 must honour (labels Vietnamese + exact; testids below). Needs C-04b-007's global-setup seed (`seedContracts()`).
 *
 * UI contract:
 *   sidebar `data-testid="sidebar"` links "Hợp đồng" · "Mẫu hợp đồng" · "Chờ tôi duyệt" · "Khách hàng" (hidden without permission);
 *   nav pill `data-testid="nav-badge-approvals"` (text = count, absent at 0);
 *   h1 = screen name; "/mau-hop-dong" cards `data-testid="template-card"`, "Tạo hợp đồng từ mẫu này →" in the template drawer;
 *   button "+ Tạo hợp đồng" → dialog "Tạo hợp đồng": fields "Khách hàng" (combobox, search + "+ Thêm khách mới"), "Gói dịch vụ" (select, value G6),
 *     "Số cửa hàng", "Giảm giá (%)", "Chức vụ người ký", button "Tạo & xem văn bản"; error `role=alert` (missing fields → names the label);
 *   drawer role=dialog name "Chi tiết hợp đồng" (header shows number or "Nháp · chưa có số", status pill text) with action buttons
 *     `data-testid="action-<edit|submit|approve|reject|issue|void|copy|withdraw|delete>"`; a locked action is aria-disabled, shows 🔒 and its reason
 *     as text in the drawer footer;
 *   confirm dialog role=dialog name "Xác nhận": optional field "Lý do" (required for reject/void), button "Xác nhận";
 *   paper overlay role=dialog name "Văn bản hợp đồng" with `<iframe title="Văn bản hợp đồng">`, buttons "Đóng" · "In" · link "Mở ở tab mới";
 *   drawer button "Xem văn bản hợp đồng"; list rows `data-testid="contract-row"`; audit rows `data-testid="audit-row"`.
 * Roles: global-setup USERS — staff (Nhân viên) · manager (Quản lý) · director (Giám đốc).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pageAs, test, expect } from "./fixtures";
import { BASE } from "../playwright.config";

const SHOTS = process.env["PROOF_SHOTS"] === "1";
const NUMBER = /HD-\d{4}-001/;
const CUSTOMER = { name: "Tạp hóa Cô Ba", contact: "Trần Thị Ba", phone: "0912 345 678", email: "coba@example.com" };

test("4b lifecycle: logged out → /login; Nhân viên creates (missing field, then fill) and submits, self-approve is 🔒; Quản lý approves + issues; void; paper", async ({ browser }) => {
  test.setTimeout(240_000); // SPEC-05: waits for the queued PDF (local Chrome, first launch can take ~90s)
  // ---- logged out: every 4b URL lands on /login?next= (gap left by the 4a smoke) ----
  const anon = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const anonPage = await anon.newPage();
  for (const path of ["/hop-dong", "/hop-dong/01ARZ3NDEKTSV4RRFFQ69G5FAV", "/hop-dong/01ARZ3NDEKTSV4RRFFQ69G5FAV/van-ban", "/mau-hop-dong", "/cho-toi-duyet"]) {
    await anonPage.goto(`${BASE}${path}`);
    await expect(anonPage, path).toHaveURL(/\/login\?next=/);
  }
  await anon.close();

  // ---- Nhân viên ----
  const nv = await pageAs(browser, "staff");
  const consoleLines: string[] = [];
  nv.on("console", (m) => consoleLines.push(m.text()));
  const approvalCalls: string[] = [];
  nv.on("request", (r) => {
    if (new URL(r.url()).pathname === "/approvals/mine") approvalCalls.push(r.url());
  });
  await nv.goto("/hop-dong");
  await expect(nv.getByRole("heading", { level: 1, name: "Hợp đồng" })).toBeVisible();
  await expect(nv.getByRole("heading", { level: 1 })).toHaveCount(1); // one title per screen (FR-13)
  const sidebar = nv.getByTestId("sidebar");
  for (const l of ["Hợp đồng", "Mẫu hợp đồng", "Khách hàng"]) await expect(sidebar.getByRole("link", { name: l, exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Chờ tôi duyệt", exact: true })).toHaveCount(0);
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/hop-dong.png" });

  // Mẫu hợp đồng → open the template → create from it (template preselected)
  await sidebar.getByRole("link", { name: "Mẫu hợp đồng", exact: true }).click();
  await expect(nv.getByTestId("template-card").first()).toBeVisible();
  await nv.getByTestId("template-card").first().click();
  await expect(nv.getByRole("button", { name: /Sửa mẫu/ })).toHaveCount(0); // read-only (Q-1)
  await nv.getByRole("button", { name: "Tạo hợp đồng từ mẫu này →" }).click();
  const create = nv.getByRole("dialog", { name: "Tạo hợp đồng" });
  await expect(create).toBeVisible();

  // add the customer inside the contract modal (FR-17)
  await create.getByRole("combobox", { name: "Khách hàng" }).click();
  await create.getByRole("button", { name: "+ Thêm khách mới" }).click();
  const cust = nv.getByRole("dialog", { name: "Thêm khách" });
  await cust.getByLabel("Tên khách hàng").fill(CUSTOMER.name);
  await cust.getByLabel("Người đại diện").fill(CUSTOMER.contact);
  await cust.getByLabel("Số điện thoại").fill(CUSTOMER.phone);
  await cust.getByLabel("Email").fill(CUSTOMER.email);
  await cust.getByRole("button", { name: "Lưu" }).click();
  await expect(cust).toBeHidden();
  await expect(create).toBeVisible(); // the contract modal survived
  await expect(create.getByRole("combobox", { name: "Khách hàng" })).toContainText(CUSTOMER.name);

  // required field left empty → Vietnamese message names it, nothing created
  await create.getByLabel("Gói dịch vụ").selectOption({ value: "G6" });
  await create.getByLabel("Số cửa hàng").fill("1");
  await create.getByLabel("Giảm giá (%)").fill("5");
  await create.getByRole("button", { name: "Tạo & xem văn bản" }).click();
  await expect(create.getByRole("alert")).toContainText("Chức vụ người ký");
  await expect(create.getByRole("alert")).not.toContainText(/missing|422|Unprocessable/i);
  await expect(create).toBeVisible();

  // fill → created: drawer "Nháp · chưa có số", paper with NHÁP
  await create.getByLabel("Chức vụ người ký").fill("Chủ hộ kinh doanh");
  await create.getByRole("button", { name: "Tạo & xem văn bản" }).click();
  const paper = nv.getByRole("dialog", { name: "Văn bản hợp đồng" });
  await expect(paper).toBeVisible();
  const frame = paper.frameLocator("iframe[title='Văn bản hợp đồng']");
  await expect(frame.getByText("NHÁP").first()).toBeVisible();
  await expect(frame.getByText("Chủ hộ kinh doanh").first()).toBeVisible();
  await expect(paper.locator("iframe")).toHaveAttribute("sandbox", "allow-same-origin allow-modals");
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/ban-in.png" });
  await paper.getByRole("button", { name: "Đóng" }).click();
  const drawer = nv.getByRole("dialog", { name: "Chi tiết hợp đồng" });
  await expect(drawer).toContainText("Nháp · chưa có số");
  await expect(drawer).toContainText("2.565.000 ₫"); // G6 · 1 · 5% (server snapshot)
  const contractId = new URL(nv.url()).pathname.split("/")[2] ?? "";
  expect(contractId).toMatch(/^[0-9A-Z]{26}$/);
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/ngan-chi-tiet.png" });

  // submit → pending; approving one's own contract is 🔒 with a reason (and sends nothing)
  await drawer.getByTestId("action-submit").click();
  await expect(drawer).toContainText("Chờ duyệt");
  await expect(drawer.getByTestId("action-approve")).toHaveAttribute("aria-disabled", "true");
  await expect(drawer).toContainText("Bạn là người tạo nên không tự duyệt được.");
  // forced API call → 403 (this is what leaves a permission.denied row for the Giám đốc)
  const forced = await nv.evaluate(async (id) => {
    const r = await fetch(`/contracts/${id}/approve`, { method: "POST", headers: { "X-Requested-With": "fetch", "content-type": "application/json" }, body: "{}" });
    return r.status;
  }, contractId);
  expect(forced).toBe(403);

  // withdraw to draft (confirm), then submit again
  await drawer.getByTestId("action-withdraw").click();
  await nv.getByRole("dialog", { name: "Xác nhận" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(drawer).toContainText("Nháp · chưa có số");
  await drawer.getByTestId("action-submit").click();
  await expect(drawer).toContainText("Chờ duyệt");
  await nv.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // a second draft, deleted (confirm) — the list goes back to /hop-dong
  await nv.getByRole("button", { name: "+ Tạo hợp đồng" }).click();
  const create2 = nv.getByRole("dialog", { name: "Tạo hợp đồng" });
  await create2.getByRole("combobox", { name: "Khách hàng" }).click();
  await create2.getByRole("combobox", { name: "Khách hàng" }).fill("Cô Ba");
  await create2.getByRole("option", { name: new RegExp(CUSTOMER.name) }).click();
  await create2.getByLabel("Gói dịch vụ").selectOption({ value: "G6" });
  await create2.getByLabel("Số cửa hàng").fill("1");
  await create2.getByLabel("Chức vụ người ký").fill("Chủ hộ kinh doanh");
  await create2.getByRole("button", { name: "Tạo & xem văn bản" }).click();
  await nv.getByRole("dialog", { name: "Văn bản hợp đồng" }).getByRole("button", { name: "Đóng" }).click();
  const drawer2 = nv.getByRole("dialog", { name: "Chi tiết hợp đồng" });
  await drawer2.getByTestId("action-delete").click();
  await nv.getByRole("dialog", { name: "Xác nhận" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(nv).toHaveURL(/\/hop-dong$/);
  await expect(nv.getByText("Đã xóa nháp")).toBeVisible();

  expect(approvalCalls).toEqual([]); // Nhân viên has no contract:approve → no GET /approvals/mine
  expect(consoleLines.join("\n")).not.toMatch(/0912|Cô Ba|coba@/i);
  await nv.context().close();

  // ---- Quản lý: pill → Chờ tôi duyệt → approve → issue → number ----
  const ql = await pageAs(browser, "manager");
  await ql.goto("/hop-dong");
  const pill = ql.getByTestId("nav-badge-approvals");
  await expect(pill).toHaveText("1");
  await ql.getByTestId("sidebar").getByRole("link", { name: /^Chờ tôi duyệt/ }).click();
  await expect(ql.getByRole("heading", { level: 1, name: "Chờ tôi duyệt" })).toBeVisible();
  await ql.getByText(CUSTOMER.name).first().click();
  const qDrawer = ql.getByRole("dialog", { name: "Chi tiết hợp đồng" });
  await qDrawer.getByTestId("action-approve").click();
  await expect(qDrawer).toContainText("Đã duyệt");
  await expect(pill).toHaveCount(0); // no F5 needed (FR-16)
  await qDrawer.getByTestId("action-issue").click();
  await ql.getByRole("dialog", { name: "Xác nhận" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(qDrawer).toContainText(NUMBER);
  await expect(qDrawer).toContainText("Đã phát hành");

  // SPEC-05 AC-6/AC-7: the PDF is made by the queue + local Chrome after issue; F5 until "Tải PDF" is a link, then download
  await expect
    .poll(
      async () => {
        await ql.reload();
        await expect(qDrawer).toContainText("Đã phát hành");
        return qDrawer.getByRole("link", { name: "Tải PDF" }).count();
      },
      { timeout: 150_000, intervals: [3_000] },
    )
    .toBe(1);
  const downloading = ql.waitForEvent("download");
  await qDrawer.getByRole("link", { name: "Tải PDF" }).click();
  const pdf = await downloading;
  expect(pdf.suggestedFilename()).toMatch(/^HD-\d{4}-001\.pdf$/);
  const pdfBytes = readFileSync((await pdf.path())!);
  expect(pdfBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  if (SHOTS) writeFileSync(`e2e/shots/${pdf.suggestedFilename()}`, pdfBytes);

  // the paper now carries the number and no NHÁP
  await qDrawer.getByRole("button", { name: "Xem văn bản hợp đồng" }).click();
  const qPaper = ql.getByRole("dialog", { name: "Văn bản hợp đồng" });
  await expect(qPaper.frameLocator("iframe[title='Văn bản hợp đồng']").getByText(NUMBER).first()).toBeVisible();
  await qPaper.getByRole("button", { name: "Đóng" }).click();

  // void needs a reason: empty is refused, then confirmed → Đã hủy, the paper opens with the band
  await qDrawer.getByTestId("action-void").click();
  const confirm = ql.getByRole("dialog", { name: "Xác nhận" });
  await confirm.getByRole("button", { name: "Xác nhận" }).click();
  await expect(confirm).toBeVisible(); // blocked: reason required
  await confirm.getByLabel("Lý do").fill("Khách đổi sang gói G12");
  await confirm.getByRole("button", { name: "Xác nhận" }).click();
  await expect(qDrawer).toContainText("Đã hủy");
  await expect(qDrawer).toContainText("Khách đổi sang gói G12");
  await qDrawer.getByRole("button", { name: "Xem văn bản hợp đồng" }).click();
  await expect(ql.getByRole("dialog", { name: "Văn bản hợp đồng" }).frameLocator("iframe").getByText("ĐÃ HỦY").first()).toBeVisible();
  await ql.keyboard.press("Escape");

  // customer card: the only issued contract was voided → not counted (Q-2)
  await ql.getByTestId("sidebar").getByRole("link", { name: "Khách hàng", exact: true }).click();
  await expect(ql.getByText("Chưa có hợp đồng đã phát hành").first()).toBeVisible();
  await ql.context().close();

  // ---- Giám đốc: Nhật ký shows the denied attempt and the contract.* rows ----
  const gd = await pageAs(browser, "director");
  await gd.goto("/nhat-ky");
  await expect(gd.getByRole("heading", { level: 1, name: "Nhật ký" })).toBeVisible();
  await expect(gd.getByTestId("audit-row").filter({ hasText: "permission.denied" }).first()).toBeVisible();
  for (const a of ["contract.created", "contract.withdrawn", "contract.deleted", "contract.issued", "contract.voided"]) {
    await expect(gd.getByTestId("audit-row").filter({ hasText: a }).first(), a).toBeVisible();
  }
  await gd.context().close();
});
