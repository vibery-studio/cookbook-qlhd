/**
 * SPEC-06 desktop e2e — the ONE spec of ROADMAP-02 row 2 (PLAN-06 §1, e2e-kit UI proof budget): AC-8 + the clone flow
 * (DEC-6). Runs once at PROOF (C-06-006), after the API suite, on the real build via wrangler (:8791). Written before the
 * UI: it FIXES the UI contract cards C-06-004 / C-06-005 must honour. Races (AC-3, AC-6) stay in the API suite. The four-eyes flow (SPEC-07) is proven in rbac-advanced.spec.ts.
 *
 * UI contract (/phan-quyen):
 *   h1 "Phân quyền"; intro contains "Bấm tên vai trò để sửa." with roles:write, "Bảng chỉ để xem." without;
 *   matrix `data-testid="roles-matrix"`: rows = the full catalog (GET /roles `catalog`), one column per role;
 *   with roles:write each column header is a button `data-testid="role-col"` whose text starts with the role label
 *     (no such buttons without roles:write); page button "+ Thêm vai trò" (absent without roles:write);
 *   role drawer role=dialog, accessible name "Vai trò · <label>": checkbox per permission, accessible name contains its
 *     Vietnamese label (permission-labels.ts); holders "n người đang mang"; footer buttons "Lưu" · "Clone" · "Xóa";
 *     permission edits are SENT (SPEC-07 DEC-1): the submit button's name carries the diff, "Gửi yêu cầu (−1)" /
 *     "Gửi yêu cầu (+2 · −1)" (U+2212 minus); a pending request shows `pending-band` and "Rút yêu cầu"; label/description keep "Lưu";
 *     a locked drawer shows 🔒 + reason text ("Bạn đang mang vai trò này", "Vai trò hệ thống — không xóa/đổi tên",
 *     "Bạn không có quyền này nên không cấp được", "Quản trị hệ thống: không đổi tên hay xóa được…" (FIX-05)); locked controls are disabled;
 *   add / clone modal role=dialog name "Thêm vai trò": field "Tên vai trò" (clone prefill "Bản sao của <label>"),
 *     field "Mô tả", permission checkboxes as in the drawer, submit button "Tạo vai trò";
 *   delete: confirm dialog "Xác nhận" → button "Xác nhận"; 409 role-in-use → text "Còn n người mang vai trò này"
 *     + link "Người dùng" (href /nguoi-dung).
 * /nguoi-dung: row "Đổi vai trò" → dialog "Đổi vai trò · <name>" → select "Vai trò mới" lists every role from GET /roles
 *   by label (custom ones too) → "Xác nhận".
 * Nhật ký: rows `data-testid="audit-row"` contain the action code.
 * Roles: global-setup USERS — director (Giám đốc) · staff (Nhân viên). The staff account is moved to "Kế toán" during the
 * spec and moved BACK to nhan_vien at the end (shell.smoke.spec.ts runs after this file and needs a Nhân viên).
 */
import { pageAs, test, expect, openScreen } from "./fixtures";
import { USERS } from "./global-setup";

const SHOTS = process.env["PROOF_SHOTS"] === "1";
const API_HEADERS = { "X-Requested-With": "fetch", "content-type": "application/json" };

test("SPEC-06: Giám đốc edits Quản lý in the drawer, own role is 🔒, clones Nhân viên → Kế toán, assigns it; the logged-in user follows on reload; delete blocked while held; Nhật ký", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  // ---- Nhân viên: logged in BEFORE any change; /phan-quyen is read-only ----
  const nv = await pageAs(browser, "staff");
  await nv.goto("/phan-quyen");
  await expect(nv.getByRole("heading", { level: 1, name: "Phân quyền" })).toBeVisible();
  await expect(nv.getByText("Bảng chỉ để xem.")).toBeVisible();
  await expect(nv.getByRole("button", { name: "+ Thêm vai trò" })).toHaveCount(0);
  await expect(nv.getByTestId("role-col")).toHaveCount(0);
  await nv.goto("/hop-dong");
  await expect(nv.getByRole("button", { name: "+ Tạo", exact: true })).toBeVisible();

  // ---- Giám đốc: /phan-quyen is editable ----
  const gd = await pageAs(browser, "director");
  await gd.goto("/phan-quyen");
  await expect(gd.getByRole("heading", { level: 1, name: "Phân quyền" })).toBeVisible();
  await expect(gd.getByText("Bấm tên vai trò để sửa.")).toBeVisible();
  await expect(gd.getByRole("button", { name: "+ Thêm vai trò" })).toBeVisible();
  const matrix = gd.getByTestId("roles-matrix");
  // the full catalog is listed, even a code no role holds yet
  await expect(matrix.getByText("roles:write")).toBeVisible();
  const col = (label: string) => matrix.getByTestId("role-col").filter({ hasText: new RegExp(`^${label}`) });

  // AC-8 + SPEC-07 DEC-1: Quản lý → drawer → drop one permission → "Gửi yêu cầu (−1)" (a REQUEST, never a direct save)
  await col("Quản lý").click();
  const qlDrawer = gd.getByRole("dialog", { name: "Vai trò · Quản lý" });
  await expect(qlDrawer).toBeVisible();
  await expect(qlDrawer).toContainText("1 người đang mang");
  await qlDrawer.getByRole("checkbox", { name: /Xem nhật ký/ }).uncheck();
  await expect(qlDrawer.getByRole("button", { name: /^Lưu \(/ })).toHaveCount(0);
  const send = qlDrawer.getByRole("button", { name: "Gửi yêu cầu (−1)" });
  await expect(send).toBeEnabled();
  if (SHOTS) await gd.screenshot({ path: "e2e/shots/phan-quyen-ngan.png" });
  await send.click();
  await expect(qlDrawer.getByTestId("pending-band")).toContainText("Đang chờ duyệt: −1");
  // the request waits: nothing changed; withdraw it so no pending request is left behind (rbac-advanced.spec.ts sends its own)
  await qlDrawer.getByRole("button", { name: "Rút yêu cầu" }).click();
  await expect(qlDrawer.getByTestId("pending-band")).toHaveCount(0);
  const qlPerms = await gd.evaluate(async () => {
    const r = await fetch("/roles");
    const body = (await r.json()) as { items: Array<{ name: string; permissions: string[] }> };
    return body.items.find((x) => x.name === "quan_ly")?.permissions ?? [];
  });
  expect(qlPerms).toContain("audit:read");
  expect(qlPerms).toContain("contract:issue");
  await gd.keyboard.press("Escape");
  await expect(qlDrawer).toBeHidden();

  // AC-8: own role (Giám đốc) is 🔒 with its reason, nothing to save
  await col("Giám đốc").click();
  const gdDrawer = gd.getByRole("dialog", { name: "Vai trò · Giám đốc" });
  await expect(gdDrawer.getByText("🔒").first()).toBeVisible();
  await expect(gdDrawer).toContainText("Bạn đang mang vai trò này");
  await expect(gdDrawer.getByRole("checkbox").first()).toBeDisabled();
  await expect(gdDrawer.getByRole("button", { name: /^Lưu/ })).toHaveCount(0);
  await gd.keyboard.press("Escape");

  // DEC-6 clone: Nhân viên → "Kế toán" with contract:read only
  await col("Nhân viên").click();
  const nvDrawer = gd.getByRole("dialog", { name: "Vai trò · Nhân viên" });
  await expect(nvDrawer).toContainText("Vai trò hệ thống — không xóa/đổi tên");
  await nvDrawer.getByRole("button", { name: "Clone" }).click();
  const add = gd.getByRole("dialog", { name: "Thêm vai trò" });
  await expect(add).toBeVisible();
  await expect(add.getByLabel("Tên vai trò")).toHaveValue("Bản sao của Nhân viên");
  await expect(add.getByRole("checkbox", { name: /Xem hợp đồng/ })).toBeChecked();
  await add.getByLabel("Tên vai trò").fill("Kế toán");
  await add.getByRole("checkbox", { name: /Tạo & sửa nháp/ }).uncheck();
  await add.getByRole("checkbox", { name: /Gửi duyệt/ }).uncheck();
  await add.getByRole("button", { name: "Tạo vai trò" }).click();
  await expect(add).toBeHidden();
  await expect(col("Kế toán")).toBeVisible();

  // Người dùng: assign "Kế toán" to the Nhân viên
  await openScreen(gd, "Người dùng");
  const row = gd.getByTestId("users-table").getByRole("row").filter({ hasText: USERS.staff.email });
  await row.getByRole("button", { name: "Đổi vai trò" }).click();
  const change = gd.getByRole("dialog", { name: `Đổi vai trò · ${USERS.staff.name}` });
  await change.getByLabel("Vai trò mới").selectOption({ label: "Kế toán" });
  await change.getByRole("button", { name: "Xác nhận" }).click();
  await expect(change).toBeHidden();
  await expect(row).toContainText("Kế toán"); // label from GET /roles, not the r_… code
  await expect(row).not.toContainText(/r_[0-9a-z]{26}/);

  // the SAME Nhân viên session, reloaded: still logged in, sees Hợp đồng, no create button
  await nv.reload();
  await expect(nv).toHaveURL(/\/hop-dong$/);
  await expect(nv.getByRole("heading", { level: 1, name: "Tài liệu" })).toBeVisible();
  // SPEC-09 DEC-10 B: "+ Tạo" lists only the types the user may create — no contract:write → no "Hợp đồng" item
  const createMenu = nv.getByRole("button", { name: "+ Tạo", exact: true });
  if ((await createMenu.count()) > 0) {
    await createMenu.click();
    await expect(nv.getByRole("menuitem", { name: "Hợp đồng", exact: true })).toHaveCount(0);
    await nv.keyboard.press("Escape");
  }
  await nv.context().close();

  // delete "Kế toán" while 1 person holds it → blocked, with the way out
  await openScreen(gd, "Phân quyền");
  await col("Kế toán").click();
  const keDrawer = gd.getByRole("dialog", { name: "Vai trò · Kế toán" });
  await keDrawer.getByRole("button", { name: "Xóa" }).click();
  await gd.getByRole("dialog", { name: "Xác nhận" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(keDrawer).toContainText("Còn 1 người mang vai trò này");
  await expect(keDrawer.getByRole("link", { name: /Người dùng/ })).toHaveAttribute("href", "/nguoi-dung");
  await expect(col("Kế toán")).toBeVisible();
  await gd.keyboard.press("Escape");

  // Nhật ký
  await openScreen(gd, "Nhật ký");
  for (const a of ["role.created", "role.change_requested", "role.change_withdrawn", "user.role_changed"]) {
    await expect(gd.getByTestId("audit-row").filter({ hasText: a }).first(), a).toBeVisible();
  }
  if (SHOTS) await gd.screenshot({ path: "e2e/shots/nhat-ky-vai-tro.png" });

  // put the shared Nhân viên account back (later specs rely on it)
  const restored = await gd.evaluate(
    async ({ email, headers }) => {
      const list = (await (await fetch("/admin/users?limit=50")).json()) as { items: Array<{ id: string; email: string }> };
      const id = list.items.find((u) => u.email === email)?.id ?? "";
      const r = await fetch(`/admin/users/${id}`, { method: "PATCH", headers, body: JSON.stringify({ role: "nhan_vien" }) });
      return r.status;
    },
    { email: USERS.staff.email, headers: API_HEADERS },
  );
  expect(restored).toBe(200);
  await gd.context().close();
});
