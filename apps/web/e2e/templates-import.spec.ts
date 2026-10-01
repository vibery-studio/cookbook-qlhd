/**
 * SPEC-10 desktop e2e — the ONE spec of ROADMAP-02 row 5 (PLAN-10 §1, e2e-kit UI proof budget): AC-8 (done-check).
 * Runs once at PROOF (C-10-006), after the API suite, on the real build via wrangler (:8791). Written before the UI: it FIXES
 * the UI contract C-10-004 must honour. Converter rules, rejections, races, permissions stay in the API suite
 * (`apps/api/test/integration/templates-import-acceptance.test.ts`, `apps/api/test/domain/docx-convert.test.ts`).
 * The type select offers the four row-4 types; the spec imports as "Báo giá" and ends with Quản lý issuing BG-YYYY-NNN (C-10-005).
 *
 * UI contract:
 * /mau-hop-dong — button "Nhập từ Word" next to the h1, only with template:write; without it a LockedNote
 *   "Chỉ Giám đốc nhập mẫu (cần quyền template:write)" and no button. Template drawer "Chi tiết mẫu hợp đồng" has button
 *   "Nhập phiên bản mới từ Word" (template:write only).
 * Import dialog role=dialog name "Nhập mẫu từ Word" (full-screen sheet on mobile):
 *   Step 1 — radios "Mẫu mới" (default from the list button) / "Phiên bản mới của mẫu" (+ select "Mẫu"; preset from the drawer);
 *     file input label "File Word (.docx)" (accept=".docx"); for a new template: input "Tên mẫu" (prefilled from the file name,
 *     "_" → space) and select "Loại" (options = DOC_TYPE_LABEL in DOC_TYPES order: Báo giá · Hợp đồng · Đề nghị thanh toán · Phiếu xuất kho); button "Đọc file" → skeleton while loading;
 *     413/415/422 docx-invalid → role=alert with the Vietnamese sentence for `reason` (problem-messages.ts).
 *   Step 2 — left: `<iframe title="Xem trước mẫu">` with `sandbox` WITHOUT allow-scripts, placeholders highlighted;
 *     right: table `data-testid="import-fields"`, one row `data-testid="import-field-row"` + `data-key="<key>"` per field:
 *     cells key · "×N" count · input "Nhãn <key>" · select "Kiểu <key>" · checkbox "Bắt buộc <key>" · select "Nguồn <key>"
 *     (options = response `sources`) · input "Lựa chọn <key>" (only when Kiểu = choice) · badge "gợi ý từ: phiên bản hiện tại" |
 *     "gợi ý từ: mẫu khác" | "mới" · badge "Người lập nhập tay" when Nguồn = manual · badge "Tiền nhập tay" when a money field is manual.
 *     Above: header "Đã có N trường" · box `data-testid="import-removed"` ("Đã bỏ" — internal notes) · box
 *     `data-testid="import-warnings"` ("Cảnh báo", one line per warning with ×count). Per table holding a field: block
 *     `data-testid="import-table"` with button "Đây là bảng dòng hàng" (re-reads the file with lines_table). check_errors →
 *     role=alert next to the field row (or on top if no key); while any remains "Lưu" is disabled.
 *     Empty: "File không có trường nào" (Lưu still enabled if no check error).
 *   Step 3 — button "Lưu" → POST /templates (new) or /templates/{id}/versions (with Idempotency-Key). 201 → dialog closes,
 *     drawer of that template opens at the new version, toast "Đã lưu phiên bản N". 409 duplicate → "Tên mẫu đã có" + link
 *     "Mở mẫu đó"; 409 stale → "Mẫu vừa có phiên bản mới, đọc lại" (keeps edits, re-previews); 422 template-check-failed →
 *     errors on the rows. The saved version's note = "Nhập từ <file name>".
 * Accounts: global-setup USERS director (Giám đốc) · staff (Nhân viên); seed customer "Cửa hàng Seed". Leaves behind one
 * template "Báo giá E2E" (contract:read sees it in the list; other specs look templates up by name, so they are unaffected).
 */
import path from "node:path";
import { pageAs, test, expect } from "./fixtures";

const SHOTS = process.env["PROOF_SHOTS"] === "1";
const BAO_GIA = path.resolve(process.cwd(), "../api/test/fixtures/docx/Bao_Gia.docx");
const TEMPLATE_NAME = "Báo giá E2E";
const YEAR = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(new Date());
const BAO_GIA_KEYS = [
  "so_bao_gia", "ngay_bao_gia", "ten_khach", "ten_cua_hang", "sdt", "email", "ten_goi", "so_cua_hang", "don_gia",
  "giam_gia", "thanh_tien", "tong_tien", "tong_tien_bang_chu", "hieu_luc_den", "nv_phu_trach",
];

test("SPEC-10: Giám đốc imports Bao_Gia.docx (15 fields → line table → sources) and saves; Nhân viên builds a draft from it; Nhân viên sees 🔒", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  // ---- Giám đốc: Mẫu hợp đồng → Nhập từ Word → Bao_Gia.docx ----
  const gd = await pageAs(browser, "director");
  await gd.goto("/mau-hop-dong");
  await expect(gd.getByRole("heading", { level: 1, name: "Mẫu hợp đồng" })).toBeVisible();
  await gd.getByRole("button", { name: "Nhập từ Word" }).click();
  const dlg = gd.getByRole("dialog", { name: "Nhập mẫu từ Word" });
  await expect(dlg.getByRole("radio", { name: "Mẫu mới" })).toBeChecked();
  await dlg.getByLabel("File Word (.docx)").setInputFiles(BAO_GIA);
  await expect(dlg.getByLabel("Tên mẫu")).toHaveValue("Bao Gia"); // from the file name
  await dlg.getByLabel("Tên mẫu").fill(TEMPLATE_NAME);
  // C-10-005: the four row-4 types (DOC_TYPES order); this template is a quote
  await expect(dlg.getByLabel("Loại").locator("option")).toHaveText(["Báo giá", "Hợp đồng", "Đề nghị thanh toán", "Phiếu xuất kho"]);
  await dlg.getByLabel("Loại").selectOption({ label: "Báo giá" });
  await dlg.getByRole("button", { name: "Đọc file" }).click();

  // ---- Step 2: 15 fields, preview sandboxed ----
  const rows = dlg.getByTestId("import-field-row");
  await expect(rows).toHaveCount(15);
  await expect(dlg).toContainText("Đã có 15 trường");
  for (const k of BAO_GIA_KEYS) await expect(dlg.locator(`[data-testid="import-field-row"][data-key="${k}"]`), k).toHaveCount(1);
  const frame = dlg.locator("iframe[title='Xem trước mẫu']");
  await expect(frame).toBeVisible();
  expect(await frame.getAttribute("sandbox")).not.toContain("allow-scripts");
  await expect(dlg.frameLocator("iframe[title='Xem trước mẫu']").getByText("BÁO GIÁ")).toBeVisible();
  const row = (k: string) => dlg.locator(`[data-testid="import-field-row"][data-key="${k}"]`);
  await expect(row("ten_khach")).toContainText("gợi ý từ: mẫu khác"); // seed v2 → subject:contact_person
  await expect(row("hieu_luc_den")).toContainText("mới");
  await expect(row("hieu_luc_den")).toContainText("Người lập nhập tay");

  // ---- "Đây là bảng dòng hàng" → 12 fields (giam_gia kept, P-7), bang_hang = lines ----
  await dlg.getByTestId("import-table").getByRole("button", { name: "Đây là bảng dòng hàng" }).click();
  await expect(rows).toHaveCount(12);
  await expect(row("bang_hang")).toHaveCount(1);
  await expect(row("bang_hang").getByLabel("Kiểu bang_hang")).toHaveValue("lines");
  await expect(row("bang_hang").getByLabel("Nguồn bang_hang")).toHaveValue("derived:lines_table");
  await expect(row("don_gia")).toHaveCount(0);

  // ---- set sources + readable labels for the two free-text fields ----
  await row("tong_tien").getByLabel("Nguồn tong_tien").selectOption("derived:total");
  await row("tong_tien_bang_chu").getByLabel("Nguồn tong_tien_bang_chu").selectOption("derived:total_in_words");
  await row("so_bao_gia").getByLabel("Nguồn so_bao_gia").selectOption("issue:number");
  await row("hieu_luc_den").getByLabel("Nhãn hieu_luc_den").fill("Hiệu lực đến");
  await row("nv_phu_trach").getByLabel("Nhãn nv_phu_trach").fill("Nhân viên phụ trách");
  await expect(dlg.getByRole("alert")).toHaveCount(0);
  if (SHOTS) await gd.screenshot({ path: "e2e/shots/nhap-mau-buoc-2.png" });

  // ---- Lưu → drawer of the new template at v1 ----
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toBeHidden();
  await expect(gd.getByText("Đã lưu phiên bản 1")).toBeVisible();
  const drawer = gd.getByRole("dialog", { name: "Chi tiết mẫu hợp đồng" });
  await expect(drawer).toContainText(TEMPLATE_NAME);
  await expect(drawer).toContainText("v1");
  await gd.goto("/mau-hop-dong");
  await expect(gd.getByTestId("template-card").filter({ hasText: TEMPLATE_NAME })).toHaveCount(1);
  await gd.context().close();

  // ---- Nhân viên: no import, 🔒 ----
  const nv = await pageAs(browser, "staff");
  await nv.goto("/mau-hop-dong");
  await expect(nv.getByRole("button", { name: "Nhập từ Word" })).toHaveCount(0);
  await expect(nv.getByText("Chỉ Giám đốc nhập mẫu (cần quyền template:write)")).toBeVisible();

  // ---- Nhân viên: create a draft from the imported template (customer + 1 line G6) → paper has the line table ----
  await nv.getByTestId("template-card").filter({ hasText: TEMPLATE_NAME }).click();
  await nv.getByRole("button", { name: "Tạo báo giá từ mẫu này →" }).click();
  const create = nv.getByRole("dialog", { name: "Tạo báo giá" });
  await create.getByRole("combobox", { name: "Khách hàng" }).click();
  await create.getByRole("combobox", { name: "Khách hàng" }).fill("Seed");
  await create.getByRole("option", { name: /Cửa hàng Seed/ }).first().click();
  await create.getByRole("combobox", { name: "Sản phẩm dòng 1" }).fill("G6");
  await create.getByRole("option", { name: /G6/ }).first().click();
  await create.getByLabel("Số lượng dòng 1").fill("1");
  await create.getByLabel("Hiệu lực đến").fill("16/10/2026");
  await create.getByLabel("Nhân viên phụ trách").fill("Phạm Nhân Viên");
  await create.getByRole("button", { name: "Tạo & xem văn bản" }).click();
  const paper = nv.getByRole("dialog", { name: "Văn bản báo giá" });
  await expect(paper).toBeVisible();
  const doc = paper.frameLocator("iframe[title='Văn bản báo giá']");
  await expect(doc.getByText("BÁO GIÁ")).toBeVisible();
  await expect(doc.locator("table.lines")).toHaveCount(1); // server-built line table (SPEC-08 DEC-7)
  await expect(doc.locator("table.lines")).toContainText("Gói 6 tháng");
  if (SHOTS) await nv.screenshot({ path: "e2e/shots/nhap-mau-nhap-tai-lieu.png" });

  // ---- Nhân viên submits; Quản lý approves + issues → BG-YYYY-NNN (the imported quote template numbers on the BG series) ----
  await paper.getByRole("button", { name: "Đóng" }).click();
  const nvDrawer = nv.getByRole("dialog", { name: "Chi tiết báo giá" });
  await expect(nvDrawer).toContainText("Nháp · chưa có số");
  await expect(nv).toHaveURL(/\/hop-dong\/[0-9A-Z]{26}/);
  const id = new URL(nv.url()).pathname.split("/")[2]!;
  await nvDrawer.getByTestId("action-submit").click();
  await expect(nvDrawer).toContainText("Chờ duyệt");
  const ql = await pageAs(browser, "manager");
  await ql.goto(`/hop-dong/${id}`);
  const qDrawer = ql.getByRole("dialog", { name: "Chi tiết báo giá" });
  await qDrawer.getByTestId("action-approve").click();
  await expect(qDrawer).toContainText("Đã duyệt");
  await qDrawer.getByTestId("action-issue").click();
  await ql.getByRole("dialog", { name: "Xác nhận" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(qDrawer).toContainText("Đã phát hành");
  await expect(qDrawer).toContainText(new RegExp(`BG-${YEAR}-\\d{3}`));
  await ql.context().close();
  await nv.context().close();
});
