/**
 * SPEC-08 desktop e2e — the ONE spec of ROADMAP-02 row 3 (PLAN-08 §1, e2e-kit UI proof budget): AC-10.
 * Runs once at PROOF (C-08-009), after the API suite, on the real build via wrangler (:8791). Written before the UI: it FIXES the
 * UI contract cards C-08-007 / C-08-008 must honour. Money rules, races, triggers stay in the API suite
 * (`apps/api/test/integration/products-acceptance.test.ts`, `test/domain/line-pricing.test.ts`). 390 px = human checklist.
 *
 * UI contract:
 * /san-pham — sidebar link "Sản phẩm & giá" (after "Khách hàng"; everyone with contract:read); h1 "Sản phẩm & giá";
 *   tabs (role=tab) "Tất cả" · "Dịch vụ" · "Hàng hóa" · "Ngừng bán"; search box label "Tìm sản phẩm" (mã/tên);
 *   rows `data-testid="product-row"` (cells Mã · Tên · Loại · ĐVT · Thời hạn · Giá chưa VAT · Thuế suất · Giá gồm VAT · Sắp áp dụng);
 *   the "Sắp áp dụng" cell reads "<price> từ dd/mm/yyyy"; money = "2.700.000" (mono, right); KCT shown as "KCT".
 *   Button "+ Thêm sản phẩm" only with product:write → dialog "Thêm sản phẩm": radios "Dịch vụ" / "Hàng hóa"; fields "Mã",
 *   "Tên sản phẩm", "Đơn vị tính", "Thời hạn" (service only), "Giá chưa VAT", select "Thuế suất" (options "0%" "5%" "8%" "10%" "KCT"),
 *   date "Áp dụng từ ngày" (default today); live text "Giá gồm VAT: 55.000 ₫"; button "Lưu".
 *   Click a row → drawer role=dialog name "Sản phẩm · <MÃ>": section `data-testid="price-history"`, one `data-testid="price-level"`
 *   per level with a status pill "Sắp áp dụng" · "Đang áp dụng" · "Đã hết"; button "+ Thêm mức giá" (price:write) → dialog
 *   "Thêm mức giá": "Giá chưa VAT", "Thuế suất", "Áp dụng từ ngày" (min = tomorrow), hint "Tài liệu lập trước ngày này giữ giá cũ",
 *   button "Lưu"; a scheduled level has button "Hủy". Without the permission: no "+ Thêm sản phẩm", no "+ Thêm mức giá", no "Lưu";
 *   🔒 "Chỉ Quản lý, Giám đốc sửa sản phẩm/đặt giá".
 * Contract form (dialog "Tạo hợp đồng") — block `data-testid="line-items"` replaces "Gói dịch vụ" + "Số cửa hàng": one
 *   `data-testid="line-row"` per line with combobox "Sản phẩm dòng N" (options = active products priced today; option name
 *   contains code + name; a product without today's price is aria-disabled with 🔒 "Chưa có giá hôm nay"), input "Số lượng dòng N",
 *   read-only unit price, button "Xóa dòng N"; button "+ Thêm dòng"; field "Giảm giá (%)"; box `data-testid="totals"` from
 *   POST /pricing/preview: "Tiền trước thuế" · "Giảm giá" · one line per VAT group ("KCT", "Thuế GTGT 10%") · "Tổng thanh toán",
 *   note "Máy chủ tính lại khi lưu". Drawer "Chi tiết hợp đồng": line table + the same totals, "Tổng thanh toán".
 * Accounts: global-setup USERS — manager (Quản lý) · staff (Nhân viên); seed customer "Cửa hàng Seed". Leaves behind a goods product
 * KEP-E2E-01 and a G6 level from tomorrow — neither changes today's prices, so rbac-advanced / roles / shell specs are unaffected.
 */
import { pageAs, test, expect } from "./fixtures";

const SHOTS = process.env["PROOF_SHOTS"] === "1";
const VN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });

function tomorrowIso(): string {
  const d = new Date(`${VN_DAY.format(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const vnDate = (iso: string) => iso.split("-").reverse().join("/");

test("SPEC-08: Quản lý adds a goods product and a G6 level from tomorrow; Nhân viên reads only, then builds a contract from lines with VAT per group", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const tomorrow = tomorrowIso();

  // ---- Quản lý: Sản phẩm & giá → + Thêm sản phẩm (goods, 10%) ----
  const ql = await pageAs(browser, "manager");
  await ql.goto("/hop-dong");
  await ql.getByTestId("sidebar").getByRole("link", { name: "Sản phẩm & giá", exact: true }).click();
  await expect(ql).toHaveURL(/\/san-pham$/);
  await expect(ql.getByRole("heading", { level: 1, name: "Sản phẩm & giá" })).toBeVisible();
  for (const tab of ["Tất cả", "Dịch vụ", "Hàng hóa", "Ngừng bán"]) await expect(ql.getByRole("tab", { name: tab })).toBeVisible();
  const g6Row = ql.getByTestId("product-row").filter({ hasText: "G6" }).first();
  await expect(g6Row).toContainText("Gói 6 tháng");
  await expect(g6Row).toContainText("2.700.000");
  await expect(g6Row).toContainText("KCT");

  await ql.getByRole("button", { name: "+ Thêm sản phẩm" }).click();
  const add = ql.getByRole("dialog", { name: "Thêm sản phẩm" });
  await add.getByRole("radio", { name: "Hàng hóa" }).check();
  await expect(add.getByLabel("Thời hạn")).toHaveCount(0); // goods have no duration
  await add.getByLabel("Mã").fill("kep-e2e-01");
  await add.getByLabel("Tên sản phẩm").fill("Kẹp giấy E2E");
  await add.getByLabel("Đơn vị tính").fill("hộp");
  await add.getByLabel("Giá chưa VAT").fill("50000");
  await add.getByLabel("Thuế suất").selectOption({ label: "10%" });
  await expect(add).toContainText("Giá gồm VAT: 55.000 ₫");
  await add.getByRole("button", { name: "Lưu" }).click();
  await expect(add).toBeHidden();
  await ql.getByRole("tab", { name: "Hàng hóa" }).click();
  const kepRow = ql.getByTestId("product-row").filter({ hasText: "KEP-E2E-01" });
  await expect(kepRow).toContainText("Kẹp giấy E2E");
  await expect(kepRow).toContainText("50.000");
  await expect(kepRow).toContainText("55.000");
  await expect(ql.getByTestId("product-row").filter({ hasText: "G6" })).toHaveCount(0); // tab = goods only
  if (SHOTS) await ql.screenshot({ path: "e2e/shots/san-pham.png" });

  // ---- Quản lý: G6 → + Thêm mức giá from tomorrow → "Sắp áp dụng" ----
  await ql.getByRole("tab", { name: "Tất cả" }).click();
  await ql.getByLabel("Tìm sản phẩm").fill("G6");
  await ql.getByTestId("product-row").filter({ hasText: "G6" }).first().click();
  const drawer = ql.getByRole("dialog", { name: "Sản phẩm · G6" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("price-level").filter({ hasText: "Đang áp dụng" })).toContainText("2.700.000");
  await drawer.getByRole("button", { name: "+ Thêm mức giá" }).click();
  const level = ql.getByRole("dialog", { name: "Thêm mức giá" });
  await expect(level).toContainText("Tài liệu lập trước ngày này giữ giá cũ");
  await level.getByLabel("Giá chưa VAT").fill("2900000");
  await level.getByLabel("Thuế suất").selectOption({ label: "KCT" });
  await level.getByLabel("Áp dụng từ ngày").fill(tomorrow);
  await level.getByRole("button", { name: "Lưu" }).click();
  await expect(level).toBeHidden();
  const scheduled = drawer.getByTestId("price-level").filter({ hasText: "Sắp áp dụng" });
  await expect(scheduled).toContainText("2.900.000");
  await expect(scheduled).toContainText(vnDate(tomorrow));
  await expect(scheduled.getByRole("button", { name: "Hủy" })).toBeVisible();
  await expect(drawer.getByTestId("price-level").filter({ hasText: "Đang áp dụng" })).toContainText("2.700.000"); // today unchanged
  if (SHOTS) await ql.screenshot({ path: "e2e/shots/ngan-san-pham.png" });
  await ql.keyboard.press("Escape");
  await expect(ql.getByTestId("product-row").filter({ hasText: "G6" }).first()).toContainText(`2.900.000 từ ${vnDate(tomorrow)}`);

  // ---- Nhân viên: /san-pham is read-only ----
  const nv = await pageAs(browser, "staff");
  await nv.goto("/san-pham");
  await expect(nv.getByRole("heading", { level: 1, name: "Sản phẩm & giá" })).toBeVisible();
  await expect(nv.getByRole("button", { name: "+ Thêm sản phẩm" })).toHaveCount(0);
  await nv.getByTestId("product-row").filter({ hasText: "G6" }).first().click();
  const nvDrawer = nv.getByRole("dialog", { name: "Sản phẩm · G6" });
  await expect(nvDrawer).toContainText("Chỉ Quản lý, Giám đốc sửa sản phẩm/đặt giá");
  await expect(nvDrawer.getByRole("button", { name: "+ Thêm mức giá" })).toHaveCount(0);
  await expect(nvDrawer.getByRole("button", { name: "Lưu" })).toHaveCount(0);
  await expect(nvDrawer.getByRole("button", { name: "Hủy" })).toHaveCount(0);
  await nv.keyboard.press("Escape");

  // ---- Nhân viên: a contract from lines — G6 (KCT) + 2 × KEP-E2E-01 (10%), −5% ----
  // G6 2.700.000 − 135.000 = 2.565.000 (KCT, VAT 0) · KEP 100.000 − 5.000 = 95.000 → VAT 10% 9.500 · total 2.669.500
  await nv.getByTestId("sidebar").getByRole("link", { name: "Hợp đồng", exact: true }).click();
  await nv.getByRole("button", { name: "+ Tạo hợp đồng" }).click();
  const create = nv.getByRole("dialog", { name: "Tạo hợp đồng" });
  await create.getByRole("combobox", { name: "Khách hàng" }).click();
  await create.getByRole("combobox", { name: "Khách hàng" }).fill("Seed");
  await create.getByRole("option", { name: /Cửa hàng Seed/ }).click();
  await expect(create.getByLabel("Gói dịch vụ")).toHaveCount(0); // replaced by the line block
  const lines = create.getByTestId("line-items");
  await lines.getByRole("combobox", { name: "Sản phẩm dòng 1" }).fill("G6");
  await create.getByRole("option", { name: /G6/ }).first().click();
  await lines.getByLabel("Số lượng dòng 1").fill("1");
  await lines.getByRole("button", { name: "+ Thêm dòng" }).click();
  await lines.getByRole("combobox", { name: "Sản phẩm dòng 2" }).fill("KEP");
  await create.getByRole("option", { name: /KEP-E2E-01/ }).click();
  await lines.getByLabel("Số lượng dòng 2").fill("2");
  await expect(lines.getByTestId("line-row")).toHaveCount(2);
  await create.getByLabel("Giảm giá (%)").fill("5");
  const totals = create.getByTestId("totals");
  await expect(totals).toContainText("Tiền trước thuế");
  await expect(totals).toContainText("KCT");
  await expect(totals).toContainText("Thuế GTGT 10%");
  await expect(totals).toContainText("9.500");
  await expect(totals).toContainText("Tổng thanh toán");
  await expect(totals).toContainText("2.669.500");
  await expect(totals).toContainText("Máy chủ tính lại khi lưu");
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/dong-hang.png" });
  await create.getByLabel("Chức vụ người ký").fill("Chủ hộ kinh doanh");
  await create.getByRole("button", { name: "Tạo & xem văn bản" }).click();

  const paper = nv.getByRole("dialog", { name: "Văn bản hợp đồng" });
  await expect(paper).toBeVisible();
  const frame = paper.frameLocator("iframe[title='Văn bản hợp đồng']");
  await expect(frame.getByText("Kẹp giấy E2E").first()).toBeVisible();
  await expect(frame.getByText(/KCT, 10%/).first()).toBeVisible();
  await expect(frame.getByText(/đã gồm VAT/)).toHaveCount(0);
  await paper.getByRole("button", { name: "Đóng" }).click();
  const cDrawer = nv.getByRole("dialog", { name: "Chi tiết hợp đồng" });
  await expect(cDrawer).toContainText("Kẹp giấy E2E");
  await expect(cDrawer).toContainText("9.500");
  await expect(cDrawer).toContainText("Tổng thanh toán");
  await expect(cDrawer).toContainText("2.669.500 ₫"); // server snapshot = the preview
  await expect(cDrawer).not.toContainText("đã gồm VAT");
});
